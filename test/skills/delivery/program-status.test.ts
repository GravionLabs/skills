import path from 'node:path';
import { describe, expect, it } from 'vitest';

const mod = path.resolve(__dirname, '../../../skills/delivery/deliver/scripts/program-status.mts');
const { encodeStatus, programStatus } = (await import(
  mod
)) as typeof import('../../../skills/delivery/deliver/scripts/program-status.mts');

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
const decode = (value: string) => Buffer.from(value, 'base64').toString('utf8');
const pairs = (sequence: string) => {
  const match = /^\x1b\]7501;(.*)\x1b\\$/.exec(sequence);
  expect(match).not.toBeNull();
  return Object.fromEntries(match![1].split(':').map((pair) => pair.split(/=(.*)/s).slice(0, 2)));
};

describe('encodeStatus', () => {
  it('encodes the run start as working with the title in base64', () => {
    const sequence = encodeStatus({ state: 'working', title: 'M016 Größe' });
    expect(sequence).toBe(`\x1b]7501;state=working:app=deliver:title=${b64('M016 Größe')}\x1b\\`);
  });

  it('encodes an attention as blocked with kind and msg', () => {
    const fields = pairs(
      encodeStatus({ state: 'blocked', kind: 'question', title: 'M1', msg: '#5 set aside: red' }),
    );
    expect(fields).toMatchObject({ state: 'blocked', app: 'deliver', kind: 'question' });
    expect(decode(fields.msg)).toBe('#5 set aside: red');
  });

  it.each(['done', 'error', 'idle'] as const)('encodes %s', (state) => {
    expect(pairs(encodeStatus({ state, title: 'M1' })).state).toBe(state);
  });

  it('keeps kind only with blocked', () => {
    expect(pairs(encodeStatus({ state: 'done', kind: 'question' }))).not.toHaveProperty('kind');
  });

  it('cuts title at 192 and msg at 2048 bytes on a character boundary', () => {
    const fields = pairs(
      encodeStatus({ state: 'error', title: 'ä'.repeat(300), msg: 'x'.repeat(5000) }),
    );
    expect(Buffer.byteLength(decode(fields.title))).toBe(192);
    expect(decode(fields.msg)).toHaveLength(2048);
  });

  it('removes control and invisible characters and stays within the value alphabet', () => {
    const sequence = encodeStatus({ state: 'blocked', msg: 'a\x1b[31m\nb‮c​d' });
    expect(decode(pairs(sequence).msg)).toBe('a [31m b c d');
    expect(sequence.length).toBeLessThan(4096);
  });
});

describe('programStatus', () => {
  it('writes the encoded sequence to the terminal', () => {
    const written: string[] = [];
    programStatus({}, () => (data) => written.push(data))({ state: 'done' });
    expect(written).toEqual([encodeStatus({ state: 'done' })]);
  });

  it('writes nothing without a terminal and does not fail', () => {
    expect(() => programStatus({}, () => undefined)({ state: 'working' })).not.toThrow();
  });

  it('writes nothing with DELIVER_PROGRAM_STATUS=0', () => {
    const written: string[] = [];
    programStatus(
      { DELIVER_PROGRAM_STATUS: '0' },
      () => (data) => written.push(data),
    )({
      state: 'working',
    });
    expect(written).toEqual([]);
  });
});
