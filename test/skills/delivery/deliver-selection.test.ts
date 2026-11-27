// The selections of the GitHub tracker (ADR 0010): a milestone with its Features, one Feature, the Bug of a red base.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from '../../../skills/delivery/deliver/scripts/tracker/github.mts';
import type { Selection } from '../../../skills/delivery/deliver/scripts/tracker.mts';
import { createFakeGh } from '../../helpers/fake-gh';

// Milestone M001 holds Feature #10, the closed-out PBI #3 (direct, below #10), the direct Bug #25 and the release
// test #30. #10 has the PBIs #3 and #12 without milestone, a closed one, a Task and one of another repository.
const HANDLER = `(call, ctx) => {
  const issue = (number, label, extra = {}) => ({
    number,
    title: '[' + label + '] x',
    state: 'open',
    html_url: 'https://example.test/' + number,
    body: '',
    author_association: 'OWNER',
    labels: [{ name: label }],
    repository_url: 'https://api.github.com/repos/o/r',
    ...extra,
  });
  const a = call.args;
  if (a[0] === 'repo') return { rest: 'o/r' };
  const route = a.includes('POST') ? a[a.indexOf('POST') + 1] : a[1];
  if (a.includes('POST')) return { rest: issue(900, 'bug', { title: '[Bug] fix: red' }) };
  if (route.includes('/milestones?'))
    return { rest: [[{ number: 1, title: 'M001', html_url: 'm' }]] };
  if (route.includes('issues?milestone=1'))
    return { rest: [[
      issue(30, 'release-test'),
      issue(25, 'bug'),
      issue(10, 'feature'),
      issue(3, 'pbi'),
    ]] };
  if (route.includes('issues/10/sub_issues'))
    return { rest: [[
      issue(12, 'pbi'),
      issue(3, 'pbi'),
      issue(13, 'pbi', { state: 'closed' }),
      issue(14, 'task'),
      issue(15, 'pbi', { repository_url: 'https://api.github.com/repos/o/other' }),
    ]] };
  if (route.includes('issues?labels=bug')) return { rest: [[]] };
  if (route.endsWith('issues/900'))
    return { rest: issue(900, 'bug', { state: ctx.count('bug') > 1 ? 'closed' : 'open' }) };
  if (route.endsWith('issues/10')) return { rest: issue(10, 'feature') };
  throw new Error('unexpected ' + a.join(' '));
}`;

describe('GitHub tracker: selections (fake gh)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'deliver-selection-'));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });
  const tracker = (selection: Selection) => {
    const fake = createFakeGh(dir, HANDLER);
    for (const [k, v] of Object.entries(fake.env())) if (v !== undefined) vi.stubEnv(k, v);
    const made = create({ cwd: dir, base: 'release/next', selection, trustAuthors: false });
    return { made, fake };
  };
  const picked = (items: { id: number; feature?: number }[]) => items.map((i) => [i.id, i.feature]);

  it('takes the PBIs and Bugs of a milestone and below its open Features, each once, by number', () => {
    const { made } = tracker({ milestone: 'M001' });
    expect(picked(made.items())).toEqual([
      [3, 10],
      [12, 10],
      [25, undefined],
    ]);
    expect(made.releaseTests().map((i) => i.id)).toEqual([30]);
  });

  it('takes the open PBIs and Bugs below one Feature', () => {
    const { made, fake } = tracker({ feature: '10' });
    expect(picked(made.items())).toEqual([
      [3, 10],
      [12, 10],
    ]);
    expect(made.subject()).toMatchObject({ kind: 'github.issue', id: 'o/r#10' });
    expect(made.releaseTests()).toEqual([]);
    expect(fake.calls().some((c) => c.args.join(' ').includes('milestone'))).toBe(false);
  });

  it('files the Bug of a red base without milestone and lists it until it is closed', () => {
    const { made, fake } = tracker({ milestone: 'M001' });
    expect(made.reportBaseRed([{ name: 'ci', url: 'u' }], {}).id).toBe(900);
    const filed = fake.calls().find((c) => c.args.includes('POST'));
    expect(filed?.args.join(' ')).toContain('labels[]=bug');
    expect(filed?.args.some((a) => a.startsWith('milestone='))).toBe(false);
    expect(made.items().map((i) => i.id)).toEqual([3, 12, 25, 900]);
    // closed by its merge
    expect(made.items().map((i) => i.id)).toEqual([3, 12, 25]);
  });
});
