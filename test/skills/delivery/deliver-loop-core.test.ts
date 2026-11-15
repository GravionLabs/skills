import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { checkNodeVersion, parseArgs } from '../../../skills/delivery/deliver/scripts/loop/args.ts';
import {
  evaluateStop,
  exitCodeFor,
  getStopReason,
} from '../../../skills/delivery/deliver/scripts/loop/stop.ts';
import {
  type Gh,
  getHoldReason,
  getState,
  type LoopState,
  updateMerging,
} from '../../../skills/delivery/deliver/scripts/loop/state.ts';
import { getPbiTier } from '../../../skills/delivery/deliver/scripts/loop/tier.ts';

const ENTRY = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/loop/deliver-loop.ts',
);

const st = (over: Partial<LoopState> = {}): LoopState => ({
  open: 2,
  openNrs: [1, 2],
  labels: {},
  skipped: [],
  paused: false,
  waitMerge: {},
  eligible: [1, 2],
  ready: [1, 2],
  ...over,
});

type Issue = {
  labels: string[];
  state?: string;
  milestone?: string;
  children?: number[];
  blockedBy?: { number: number; state: string }[];
};

function fakeGh(
  issues: Record<number, Issue>,
  milestones: Record<string, { open: object[]; closed?: object[] }> = {},
): Gh {
  return {
    async json(args) {
      const m = /issues\/(\d+)(\/sub_issues|\/dependencies\/blocked_by)?/.exec(args[1]);
      const i = issues[Number(m?.[1])];
      if (m?.[2] === '/sub_issues') return (i.children ?? []).map((number) => ({ number }));
      if (m?.[2]) return i.blockedBy ?? [];
      return {
        labels: i.labels.map((name) => ({ name })),
        state: i.state ?? 'open',
        milestone: i.milestone ? { title: i.milestone } : null,
      };
    },
    async pwshJson(args) {
      const name = args[args.indexOf('-Name') + 1];
      const state = args[args.indexOf('-State') + 1] as 'open' | 'closed';
      return { milestone: { title: name }, issues: milestones[name]?.[state] ?? [] };
    },
  };
}
const pbi = (labels: string[] = [], extra: Partial<Issue> = {}): Issue => ({
  labels: ['pbi', ...labels],
  ...extra,
});
const input = (over = {}) => ({ targets: [], milestone: '', milestoneScript: 'x.ps1', ...over });

describe('args', () => {
  it('parses every parameter in the spelling of Invoke-DeliverLoop.ps1', () => {
    const r = parseArgs([
      '-Milestone',
      'M4',
      '-Target',
      '12,14',
      '15',
      '-Max',
      '3',
      '-Harness',
      'claude',
      '-Model',
      'opus',
      '-Context',
      'c.md',
      '-LogPane',
    ]);
    expect(r).toMatchObject({
      ok: true,
      args: {
        milestone: 'M4',
        targets: [12, 14, 15],
        max: 3,
        harness: 'claude',
        model: 'opus',
        context: 'c.md',
        logPane: true,
      },
    });
  });

  it('copilot defaults the model to auto; the parameter names ignore case', () => {
    const r = parseArgs(['-target', '5', '-harness', 'copilot']);
    expect(r).toMatchObject({ ok: true, args: { model: 'auto', targets: [5] } });
  });

  it.each([
    [['-Target', '1', '-Harness', 'gpt'], /Unknown -Harness 'gpt'. Supported: claude, copilot/],
    [[], /Give -Target/],
    [['-Target', 'abc'], /Give -Target/],
    [['-Target', '1', '-Max', '0'], /-Max/],
    [['-Target', '1', '-DryRun'], /need -Objective/],
    [['-Objective', 'o/r#1', '-Milestone', 'M1'], /not combined/],
    [['-Target', '1', '-Bogus'], /Unknown parameter/],
  ])('%j exits 64 with a message', (argv, message) => {
    const r = parseArgs(argv as string[]);
    expect(r).toMatchObject({ ok: false, code: 64 });
    expect(r.ok ? '' : r.message).toMatch(message);
  });

  it('-Objective alone and -DryRun with it are valid', () => {
    expect(parseArgs(['-Objective', 'o/r#1', '-DryRun'])).toMatchObject({
      ok: true,
      args: { objective: 'o/r#1', dryRun: true },
    });
  });

  it('Node below 24 names the minimum', () => {
    expect(checkNodeVersion('v22.18.0')).toContain('24');
    expect(checkNodeVersion('v24.0.0')).toBeNull();
    expect(checkNodeVersion('26.13.0')).toBeNull();
  });
});

describe('entry point', () => {
  it('exits 64 and lists the harnesses for an unknown one', () => {
    const r = spawnSync(process.execPath, [ENTRY, '-Target', '1', '-Harness', 'gpt'], {
      encoding: 'utf8',
    });
    expect(r.status).toBe(64);
    expect(r.stderr).toContain('claude, copilot');
  });
});

describe('launcher', () => {
  it('exits 64 naming the minimum when Node is below 24', () => {
    const r = spawnSync(process.execPath, [ENTRY.replace(/\.ts$/, '.mjs')], {
      encoding: 'utf8',
      env: { ...process.env, DELIVER_LOOP_NODE_VERSION: '20.11.0' },
    });
    expect(r.status).toBe(64);
    expect(r.stderr).toContain('Node.js 24 or newer (found 20.11.0)');
  });

  it('hands over to the TypeScript entry on a supported Node', () => {
    const r = spawnSync(
      process.execPath,
      [ENTRY.replace(/\.ts$/, '.mjs'), '-Target', '1', '-Harness', 'gpt'],
      {
        encoding: 'utf8',
      },
    );
    expect(r.status).toBe(64);
    expect(r.stderr).toContain('claude, copilot');
  });
});

describe('tier', () => {
  it.each([
    ['Tier: fast', 'fast', 'haiku', 'Tier line'],
    ['- **Tier:** strong\nSize: S', 'strong', 'opus', 'Tier line'],
    ['text\nSize: L', 'strong', 'opus', 'size L'],
    ['size: l', 'strong', 'opus', 'size L'],
    ['Size: S', 'fast', 'haiku', 'size S'],
    ['Size: M', 'standard', 'sonnet', 'size M'],
    ['no marker', 'standard', 'sonnet', 'default'],
    ['Tier: huge', 'standard', 'sonnet', 'default'],
  ])('%j -> %s', (body, tier, model, from) => {
    expect(getPbiTier(body)).toEqual({ tier, model, from });
  });

  it('null body is the default', () => {
    expect(getPbiTier(null).tier).toBe('standard');
  });
});

describe('stop rules', () => {
  it('getStopReason: done, paused is blocked, nothing ready is blocked, else continue', () => {
    expect(getStopReason(st({ open: 0, ready: [], eligible: [] }))).toBe('done');
    expect(getStopReason(st({ open: 0, paused: true, ready: [] }))).toBe('blocked');
    expect(getStopReason(st({ ready: [] }))).toBe('blocked');
    expect(getStopReason(st())).toBeNull();
  });

  it('evaluateStop over two states', () => {
    const before = st();
    expect(evaluateStop(before, st(), 1, 0)).toBe('no progress');
    const after = st({ eligible: [2], ready: [2] });
    expect(evaluateStop(before, after, 1, 0)).toBeNull();
    expect(evaluateStop(before, after, 1, 1)).toBe('max reached');
    expect(evaluateStop(before, after, 1, 5)).toBeNull();
    expect(evaluateStop(before, st({ open: 0, eligible: [], ready: [] }), 1, 1)).toBe('done');
    expect(evaluateStop(before, st({ eligible: [2], ready: [] }), 1, 0)).toBe('blocked');
  });

  it('exit codes', () => {
    expect(['done', 'max reached', 'stopped', 'blocked', 'no progress'].map(exitCodeFor)).toEqual([
      0, 0, 0, 2, 1,
    ]);
  });
});

describe('getState', () => {
  it('walks a Feature to its PBIs; holds, blockers and release-test are classified', async () => {
    const gh = fakeGh({
      20: { labels: ['feature'], children: [21, 22, 23, 24, 25, 26] },
      21: pbi(),
      22: pbi(['needs-decision']),
      23: pbi(['release-test']),
      24: pbi([], { blockedBy: [{ number: 21, state: 'open' }] }),
      25: pbi([], { state: 'closed' }),
      26: pbi(['interactive']),
    });
    const s = await getState(gh, input({ targets: [20] }));
    expect(s.openNrs).toEqual([21, 22, 24, 26]);
    expect(s.eligible).toEqual([21, 24]);
    expect(s.ready).toEqual([21]);
    expect(s.open).toBe(4);
  });

  it('a milestone lists PBIs directly; a Feature below it skips PBIs of another milestone', async () => {
    const gh = fakeGh(
      {
        10: pbi(),
        20: { labels: ['feature'], children: [21, 22, 23] },
        21: pbi([], { milestone: 'M4' }),
        22: pbi(),
        23: pbi([], { milestone: 'M5' }),
      },
      {
        M4: {
          open: [
            { number: 10, labels: ['pbi'] },
            { number: 20, labels: ['feature'] },
          ],
        },
      },
    );
    const s = await getState(gh, input({ milestone: 'M4' }));
    expect(s.ready).toEqual([10, 21]);
    expect(s.skipped).toEqual([
      { number: 22, milestone: 'none' },
      { number: 23, milestone: 'M5' },
    ]);
  });

  it('nothing open with a closed needs-decision PBI in the milestone is paused', async () => {
    const closed = [{ number: 10, labels: ['pbi', 'needs-decision'] }];
    const s = await getState(fakeGh({}, { M4: { open: [], closed } }), input({ milestone: 'M4' }));
    expect(s).toMatchObject({ open: 0, paused: true });
    expect(getStopReason(s)).toBe('blocked');
    const none = await getState(
      fakeGh({}, { M4: { open: [], closed: [] } }),
      input({ milestone: 'M4' }),
    );
    expect(getStopReason(none)).toBe('done');
  });

  it('merging PBIs leave the set; a PBI waiting only on merging blockers waits, red-first goes first', async () => {
    const gh = fakeGh({
      1: pbi(),
      2: pbi([], { blockedBy: [{ number: 1, state: 'open' }] }),
      3: pbi(),
      4: pbi(),
    });
    const s = await getState(gh, input({ targets: [1, 2, 3, 4], merging: [1], redFirst: [4] }));
    expect(s.openNrs).toEqual([2, 3, 4]);
    expect(s.waitMerge).toEqual({ '2': 1 });
    expect(s.ready).toEqual([4, 3]);
  });

  it('a failing gh call throws', async () => {
    const gh: Gh = {
      json: async () => {
        throw new Error('gh failed');
      },
      pwshJson: async () => null,
    };
    await expect(getState(gh, input({ targets: [1] }))).rejects.toThrow('gh failed');
  });

  it('hold reasons', () => {
    expect(getHoldReason(['pbi'])).toBeNull();
    expect(getHoldReason(['release-test'])).toBe('release test');
    expect(getHoldReason(['interactive', 'needs-decision'])).toBe('needs-decision');
  });
});

describe('updateMerging', () => {
  it('keeps waiting, drops others, marks red-change first, keeps a merged PR of an open issue', async () => {
    const r = await updateMerging(
      [1, 2, 3, 4, 5],
      [
        { issue: 1, state: 'waiting' },
        { issue: 2, state: 'red-change', reason: 'ci' },
        { issue: 3, state: 'red-elsewhere', reason: 'main' },
      ],
      async (nr) => ({ state: nr === 5 ? 'closed' : 'open' }),
      async (nr) => ({ merged: nr === 4 }),
    );
    expect(r.merging).toEqual([1, 4]);
    expect(r.redFirst).toEqual([2]);
    expect(r.notes).toEqual([
      '#2 select: leaves merging (red-change: ci)',
      '#3 select: leaves merging (red-elsewhere: main)',
    ]);
  });

  it('an open issue whose PR is not merged leaves with a note', async () => {
    const r = await updateMerging(
      [7],
      [],
      async () => ({ state: 'open' }),
      async () => null,
    );
    expect(r.merging).toEqual([]);
    expect(r.notes[0]).toContain('PR not merged');
  });
});
