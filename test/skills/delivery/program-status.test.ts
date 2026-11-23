import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mod = path.resolve(__dirname, '../../../skills/delivery/deliver/scripts/program-status.mts');
const { encodeStatus, finishReport, programStatus } = (await import(
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

describe('tone', () => {
  it('writes tone=warning with done only', () => {
    expect(pairs(encodeStatus({ state: 'done', tone: 'warning' })).tone).toBe('warning');
    expect(pairs(encodeStatus({ state: 'error', tone: 'warning' }))).not.toHaveProperty('tone');
    expect(pairs(encodeStatus({ state: 'done' }))).not.toHaveProperty('tone');
  });
});

describe('finishReport', () => {
  const text = 'blocked: merged 5, set aside 0, waiting 2';
  it.each(['incomplete'])('an incomplete run is done with a warning and the counts', (reason) => {
    expect(finishReport({ outcome: 'failed', reason, text }, 'M1')).toEqual({
      state: 'done',
      tone: 'warning',
      title: 'M1',
      msg: text,
    });
  });
  it('a failed harness is an error', () => {
    expect(finishReport({ outcome: 'failed', reason: 'harness', text }, 'M1').state).toBe('error');
    expect(finishReport({ outcome: 'failed', text }).state).toBe('error');
  });
  it('a clean run is done without tone', () => {
    expect(finishReport({ outcome: 'succeeded', text: 'done' }, 'M1')).toEqual({
      state: 'done',
      title: 'M1',
      msg: 'done',
    });
  });
  it('a clean run that needs you is done with a warning', () => {
    expect(finishReport({ outcome: 'succeeded', text: 'done' }, 'M1', 2).tone).toBe('warning');
  });
  it('a stopped run is idle', () => {
    expect(finishReport({ outcome: 'cancelled' }, 'M1')).toEqual({ state: 'idle', title: 'M1' });
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

  describe('heartbeat', () => {
    afterEach(() => vi.useRealTimers());
    const start = (env: NodeJS.ProcessEnv = {}) => {
      vi.useFakeTimers();
      const written: string[] = [];
      const report = programStatus(env, () => (data) => written.push(data));
      return { written, report };
    };

    it('repeats working every 5 minutes', () => {
      const { written, report } = start();
      report({ state: 'working', title: 'M1' });
      vi.advanceTimersByTime(299_000);
      expect(written).toHaveLength(1);
      vi.advanceTimersByTime(1000);
      expect(written).toHaveLength(2);
      vi.advanceTimersByTime(300_000);
      expect(written).toHaveLength(3);
      expect(new Set(written).size).toBe(1);
    });

    it('keeps a blocked question visible and repeats the latest report only', () => {
      const { written, report } = start();
      report({ state: 'working' });
      report({ state: 'blocked', kind: 'question', msg: 'ok?' });
      vi.advanceTimersByTime(300_000);
      expect(written.at(-1)).toBe(encodeStatus({ state: 'blocked', kind: 'question', msg: 'ok?' }));
      expect(written).toHaveLength(3);
    });

    it.each(['done', 'error', 'idle', 'clear'] as const)('stops at %s', (state) => {
      const { written, report } = start();
      report({ state: 'working' });
      report({ state });
      vi.advanceTimersByTime(3_600_000);
      expect(written).toHaveLength(2);
    });

    it('can be shortened by DELIVER_HEARTBEAT_SECONDS', () => {
      const { written, report } = start({ DELIVER_HEARTBEAT_SECONDS: '10' });
      report({ state: 'working' });
      vi.advanceTimersByTime(10_000);
      expect(written).toHaveLength(2);
    });

    it('writes nothing with DELIVER_PROGRAM_STATUS=0 or without a terminal', () => {
      vi.useFakeTimers();
      const written: string[] = [];
      programStatus(
        { DELIVER_PROGRAM_STATUS: '0' },
        () => (d) => written.push(d),
      )({
        state: 'working',
      });
      programStatus({}, () => undefined)({ state: 'working' });
      vi.advanceTimersByTime(3_600_000);
      expect(written).toEqual([]);
    });

    it('does not keep the process alive', () => {
      const { report } = start();
      report({ state: 'working' });
      expect(vi.getTimerCount()).toBe(1);
      expect(() => report({ state: 'done' })).not.toThrow();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
