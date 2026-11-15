import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { type State, setupObjective } from '../../helpers/objective-loop';
import { PwshWorker } from '../../helpers/pwsh-worker';

// #548: deliver.parallel in .agents/config.json lets a round of Invoke-DeliverLoop.ps1 -Objective run the loops of the
// ready repositories at the same time. Fixture: test/helpers/objective-loop.ts (fake gh over one state file, fake claude
// that closes the PBI of its prompt; with sleepMs it records when it starts and ends).
const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Invoke-DeliverLoop.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

// o/a (PBI 11) and o/b (PBI 21, and 22 blocked by the open o/b#23 outside the objective) are both ready
function bothDone(): Omit<State, 'checkouts'> {
  const st = twoReady();
  // one PBI per repository: the objective is done after round 1 (no blocked PBI, no second round)
  delete st.issues['o/b#22'];
  delete st.issues['o/b#23'];
  st.issues['o/b#20'].children = ['o/b#21'];
  return st;
}

const twoReady = (): Omit<State, 'checkouts'> => ({
  issues: {
    'o/telos#1': {
      title: '[Objective] Two',
      labels: ['objective'],
      body: '## Acceptance Criteria\n- [ ] works',
      children: ['o/a#10', 'o/b#20'],
    },
    'o/a#10': { labels: ['feature'], children: ['o/a#11'] },
    'o/a#11': {},
    'o/b#20': { labels: ['feature'], children: ['o/b#21', 'o/b#22'] },
    'o/b#21': {},
    'o/b#22': { blockers: ['o/b#23'] },
    'o/b#23': {},
  },
  milestones: {},
  rcPosted: false,
});

describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'Invoke-DeliverLoop.ps1 -Objective with deliver.parallel',
  () => {
    let dir = '';
    let worker: PwshWorker;
    let seq = 0;
    beforeAll(() => {
      dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deliver-parallel-')));
      worker = new PwshWorker(SCRIPT);
    });
    afterAll(() => {
      worker.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    const setup = (st: Omit<State, 'checkouts'>, config: unknown) => {
      const c = setupObjective(worker, path.join(dir, `case-${++seq}`), st);
      fs.mkdirSync(path.join(c.root, 'telos/.agents'), { recursive: true });
      fs.writeFileSync(path.join(c.root, 'telos/.agents/config.json'), JSON.stringify(config));
      return c;
    };

    it('without config.json (default 3) both ready repos run at the same time, the round waits for both and reports each; one ends blocked', async () => {
      const c = setupObjective(worker, path.join(dir, `case-${++seq}`), {
        ...twoReady(),
        sleepMs: 500,
      });
      const r = await c.run(['-NoPreflight']);
      expect(r.stdout).toContain(
        'deliver.parallel 3: up to 3 repository loops at a time, one per repository',
      );
      expect(r.stdout).toContain('round 1: o/a start deliver-loop -Target 10');
      expect(r.stdout).toContain('round 1: o/b start deliver-loop -Target 20');
      // concurrent: both harnesses started before the first one ended
      const times = fs
        .readFileSync(path.join(c.root, 'harness-times.txt'), 'utf8')
        .trim()
        .split('\n')
        .map((l) => l.split(' '));
      expect(
        times
          .map(([repo, ev]) => `${repo} ${ev}`)
          .slice(0, 2)
          .sort(),
      ).toEqual(['o/a start', 'o/b start']);
      expect([...c.harness()].sort()).toEqual([
        'o/a /deliver 11 --unattended --max 1',
        'o/b /deliver 21 --unattended --max 1',
      ]);
      // output of both loops is prefixed with its repository; one result line per repo, then the API usage of the round
      expect(r.stdout).toMatch(/ {2}\[o\/a\] /);
      expect(r.stdout).toMatch(/ {2}\[o\/b\] /);
      expect(r.stdout).toContain('[o/a] loop exit 0');
      expect(r.stdout).toContain('[o/b] loop exit 2');
      expect(r.stdout).toMatch(
        /round 1 results: (o\/a done, o\/b blocked|o\/b blocked, o\/a done)/,
      );
      expect(r.stdout).toContain(
        'round 1 api: rest +10, graphql +3 (remaining rest 4980, graphql 4994)',
      );
      expect(
        fs.readFileSync(path.join(c.root, 'telos/.agents/deliver-loop.log'), 'utf8'),
      ).toContain('round 1 api: rest +10, graphql +3');
      expect(r.stdout).toContain('objective result: blocked (1 round(s))');
      expect(r.status).toBe(2);
    });

    it('parallel 1: one repo after the other, streamed (no parallel announcement)', async () => {
      const c = setup({ ...bothDone(), sleepMs: 300 }, { deliver: { parallel: 1 } });
      const r = await c.run(['-NoPreflight']);
      expect(r.stdout).not.toContain('repository loops at a time');
      const times = fs
        .readFileSync(path.join(c.root, 'harness-times.txt'), 'utf8')
        .trim()
        .split('\n')
        .map((l) => l.split(' '));
      expect(times.map(([repo, ev]) => `${repo} ${ev}`)).toEqual([
        'o/a start',
        'o/a end',
        'o/b start',
        'o/b end',
      ]);
    });

    it('an invalid deliver.parallel (0, a string) falls back to 1 with a warning', async () => {
      const c = setup(twoReady(), { deliver: { parallel: 0 } });
      for (const [value, shown] of [
        [0, '0'],
        ['two', 'two'],
      ] as const) {
        fs.writeFileSync(
          path.join(c.root, 'telos/.agents/config.json'),
          JSON.stringify({ deliver: { parallel: value } }),
        );
        const r = await c.run(['-DryRun']);
        expect(r.stdout).toContain(`deliver.parallel must be an integer >= 1, got '${shown}': 1`);
        expect(r.stdout).not.toContain('repository loops at a time');
        expect(r.stdout).toContain('round 1: o/b would start deliver-loop -Target 20');
        expect(r.status).toBe(0);
      }
    });
  },
);
