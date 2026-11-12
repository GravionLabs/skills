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

    it('parallel 2: both ready repos run at the same time, the round waits for both and reports each; one ends blocked', async () => {
      const c = setup({ ...twoReady(), sleepMs: 1500 }, { deliver: { parallel: 2 } });
      const r = await c.run(['-NoPreflight']);
      expect(r.stdout).toContain(
        'deliver.parallel 2: up to 2 repository loops at a time, one per repository',
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

    it.each([
      [{ deliver: { parallel: 0 } }, "deliver.parallel must be an integer >= 1, got '0': 1"],
      [{ deliver: { parallel: 'two' } }, "deliver.parallel must be an integer >= 1, got 'two': 1"],
    ])('an invalid %j falls back to 1 with a warning', async (config, warning) => {
      const c = setup(twoReady(), config);
      const r = await c.run(['-DryRun']);
      expect(r.stdout).toContain(warning);
      expect(r.stdout).not.toContain('repository loops at a time');
      expect(r.stdout).toContain('round 1: o/b would start deliver-loop -Target 20');
      expect(r.status).toBe(0);
    });
  },
);
