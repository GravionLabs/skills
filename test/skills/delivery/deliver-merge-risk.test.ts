// deliver: a pull request above `deliver.mergeRisk` is handed over instead of merged (#1063).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fixture, loop, repo } from './deliver/run-loop';

fixture();

const config = (deliver: object) => {
  mkdirSync(path.join(repo, '.agents'), { recursive: true });
  writeFileSync(path.join(repo, '.agents/config.json'), JSON.stringify({ deliver }));
};
afterEach(() => rmSync(path.join(repo, '.agents'), { recursive: true, force: true }));

const items = (...ids: number[]) => ids.map((id) => ({ id, title: '[PBI] feat: risky' }));

describe('deliver loop: merge risk', () => {
  it('hands a high pull request over by default and goes on with the next issue', async () => {
    const out = await loop({ items: items(901, 902), risks: { 901: 'high', 902: 'low' } });
    expect(out.status).toBe(3);
    expect(out.merges.map((m) => m.pull)).toEqual([1002]);
    expect(out.results[0]).toMatchObject({
      outcome: 'aside',
      risk: 'high',
      reason: 'risk high, merge it yourself',
    });
    expect(out.stages.filter((s) => s.id === 901).at(-1)?.stage).toBe('handover');
    const comment = out.comments.filter((c) => c.id === 901).at(-1);
    expect(comment?.marker).toBe('<!-- deliver-handover: merge-risk abc123 -->');
    expect(comment?.body).toContain('merge it yourself');
    expect(out.stdout).toMatch(/needs you \(1\):\n {2}#901 risk high, https:\S+\n/);
    expect(out.events).toContainEqual(
      expect.objectContaining({ type: 'handover', reason: 'merge-risk' }),
    );
  });

  it('waits for the person and lists a pull request they merged no more', async () => {
    const out = await loop(
      {
        items: items(903),
        risks: { 903: 'high' },
        // the merge gate of the loop, then the wait: merged by a person
        gates: [{ state: 'ready', reported: true, head: 'abc123' }, { state: 'merged' }],
      },
      { args: ['--handover-minutes', '5'] },
    );
    expect(out.status).toBe(0);
    expect(out.merges).toEqual([]);
    expect(out.stdout).toContain('waiting for handed-over pull requests');
    expect(out.stdout).toContain('needs you (0):');
  });

  it.each([
    ['the config', { mergeRisk: 'high' }, []],
    ['the flag over the config', { mergeRisk: 'low' }, ['--merge-risk', 'high']],
  ])('merges a high pull request when %s allows it', async (_name, deliver, args) => {
    config(deliver);
    const out = await loop({ items: items(904), risks: { 904: 'high' } }, { args });
    expect(out.status).toBe(0);
    expect(out.merges).toHaveLength(1);
    expect(out.stdout).toMatch(/needs you \(1\):\n {2}#904 risk high/);
  });

  it('merges medium and a missing level by default', async () => {
    const out = await loop({ items: items(905, 906), risks: { 905: 'medium' } });
    expect(out.status).toBe(0);
    expect(out.merges).toHaveLength(2);
  });

  it('treats a missing level as medium', async () => {
    const out = await loop({ items: items(907) }, { args: ['--merge-risk', 'low'] });
    expect(out.status).toBe(3);
    expect(out.merges).toEqual([]);
    expect(out.results[0]?.reason).toBe('risk medium, merge it yourself');
  });

  it('keeps the level of an earlier run that ended before the verdict', async () => {
    const scenario = { items: items(909), risks: { 909: 'high' } };
    // the first run ends set aside after the implementer: no review mark holds the level
    const first = await loop({ ...scenario, verdicts: ['invalid', 'invalid'] });
    expect(first.results[0]?.reason).toContain('review failed');
    // no session of the next run writes a level
    const out = await loop({ items: items(909), earlierPull: true });
    expect(out.results[0]?.reason).toBe('risk high, merge it yourself');
    expect(out.merges).toEqual([]);
  });

  it.each([
    ['the flag', {}, ['--merge-risk', 'none']],
    ['the config', { mergeRisk: 3 }, []],
  ])('exits 2 with a message on an invalid value of %s', async (_name, deliver, args) => {
    config(deliver);
    const out = await loop({ items: items(908) }, { args });
    expect(out.status).toBe(2);
    expect(out.stderr).toContain('--merge-risk (deliver.mergeRisk) is one of low, medium, high');
    expect(out.sessions).toEqual([]);
  });
});
