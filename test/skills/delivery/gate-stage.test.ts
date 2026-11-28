// deliver: the gate script `stage get|set` over the `agent:*` labels (#1160): the exported gate functions with a
// stub tracker, and the CLI with the real GitHub tracker and a fake `gh`.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runGate } from '../../../skills/delivery/deliver/scripts/gates/result.mts';
import {
  getStageGate,
  setStageGate,
} from '../../../skills/delivery/deliver/scripts/gates/stage.mts';
import type { Item, Tracker } from '../../../skills/delivery/deliver/scripts/tracker.mts';
import { createFakeGh } from '../../helpers/fake-gh';

const script = path.resolve(__dirname, '../../../skills/delivery/deliver/scripts/gates/stage.mts');
const item: Item = { id: 7, title: '', url: '', labels: [], body: '' };
const failing = (error: object) => () => {
  throw Object.assign(new Error('Command failed: gh api rate limit'), error);
};

describe('getStageGate', () => {
  const tracker = (labels?: string[]) =>
    ({ repo: 'o/r', issue: () => labels && { labels } }) as unknown as Tracker;

  it.each([
    [['pbi', 'agent:approved', 'Agent:Review'], 'review'],
    [['pbi'], null],
  ])('passes with the stage of %j', (labels, stage) => {
    expect(getStageGate(tracker(labels), 7)).toMatchObject({
      result: 'pass',
      evidence: { issue: 7, stage },
    });
  });

  it('fails on a missing issue', () => {
    expect(getStageGate(tracker(), 7)).toMatchObject({ result: 'fail' });
  });
});

describe('setStageGate', () => {
  const calls: unknown[] = [];
  const tracker = {
    setStage: (_item: Item, stage?: string) => void calls.push(stage),
    syncStageLabels: () => (calls.push('sync'), ['agent:review']),
  };

  it('sets the stage, and creates the labels only on request', () => {
    expect(setStageGate(tracker, item, undefined)).toMatchObject({
      result: 'pass',
      evidence: { stage: null },
    });
    expect(setStageGate(tracker, item, 'review', { createLabels: true })).toMatchObject({
      result: 'pass',
      evidence: { stage: 'review', created: ['agent:review'] },
    });
    expect(calls).toEqual([undefined, 'sync', 'review']);
  });

  it.each([
    ['a rate limit', 'gh: API rate limit exceeded (HTTP 403)\nmore', 'retry'],
    ['another error', 'gh: Not Found (HTTP 404)', 'fail'],
  ])('answers %s with its first line', (_name, stderr, result) => {
    expect(setStageGate({ ...tracker, setStage: failing({ stderr }) }, item, 'review')).toEqual({
      result,
      reason: stderr.split('\n')[0],
      evidence: { issue: 7, stage: 'review' },
    });
  });
});

describe('stage.mts CLI (fake gh)', () => {
  let dir: string;
  let fake: ReturnType<typeof createFakeGh>;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'gate-stage-'));
    // issue 7 is in review; issue 8 does not exist
    fake = createFakeGh(
      dir,
      `(call) => {
        const a = call.args;
        if (a[0] === 'label') return { rest: a[1] === 'list' ? [] : '' };
        const route = a.find((x) => x.startsWith('repos/'));
        if (route.includes('/issues/8')) throw new Error('gh: Not Found (HTTP 404)');
        if (a.includes('POST') || a.includes('DELETE')) return { rest: {} };
        if (route.includes('/labels')) return { rest: [[{ name: 'agent:review' }]] };
        return { rest: { repository_url: 'https://api.test/repos/o/r', number: 7, title: 't', html_url: 'u', state: 'open', labels: [{ name: 'agent:review' }] } };
      }`,
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const run = (...args: string[]) =>
    runGate(script, [...args, '--repo', 'o/r'], { cwd: dir, env: fake.env() });

  it('gets the stage', async () => {
    await expect(run('get', '7')).resolves.toMatchObject({
      result: 'pass',
      evidence: { stage: 'review' },
    });
  });

  it('sets the stage after it created the missing labels', async () => {
    await expect(run('set', '7', 'approved')).resolves.toMatchObject({ result: 'pass' });
    const calls = fake.calls().map((c) => c.args.join(' '));
    const created = calls.findIndex((c) => c.startsWith('label create agent:approved'));
    const added = calls.findIndex((c) => c.includes('labels[]=agent:approved'));
    expect(created).toBeGreaterThanOrEqual(0);
    expect(added).toBeGreaterThan(created);
    expect(calls.some((c) => c.includes('DELETE') && c.includes('agent%3Areview'))).toBe(true);
  });

  it('fails on a tracker error', async () => {
    await expect(run('set', '8', 'review')).resolves.toMatchObject({
      result: 'fail',
      reason: 'gh: Not Found (HTTP 404)',
    });
  });

  it.each([
    ['an unknown stage', ['set', '7', 'done']],
    ['a missing stage', ['set', '7']],
    ['a stage on get', ['get', '7', 'review']],
    ['a bad issue number', ['get', '#7']],
    ['an unknown action', ['drop', '7']],
    ['an unknown flag', ['get', '7', '--nope']],
    ['an invalid tracker name', ['get', '7', '--tracker', '../x']],
  ])('reports usage on %s', async (_name, args) => {
    await expect(run(...args)).resolves.toMatchObject({ result: 'usage' });
  });
});
