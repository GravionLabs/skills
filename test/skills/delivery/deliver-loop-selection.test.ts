import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DeliverLoopFixture, pbi } from '../../helpers/deliver-loop-fixture';

const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Invoke-DeliverLoop.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

// #377, #103, #127, #327: release-test targets, bugs and features of Invoke-DeliverLoop.ps1.
describe.skipIf(!hasPwsh || process.platform === 'win32')('Invoke-DeliverLoop.ps1', () => {
  const fx = new DeliverLoopFixture(SCRIPT);
  beforeAll(() => fx.start());
  afterAll(() => fx.stop());

  it('-Milestone: an open release-test issue as the last item is not delivered and ends the loop done, not blocked (#377)', async () => {
    const gh = fx.setup({
      issues: {
        10: { labels: ['bug'] },
        11: { labels: ['pbi', 'interactive', 'release-test'] },
      },
      milestones: { M4: [10, 11] },
      effect: 'close-first',
    });
    const r = await fx.run(gh, ['-Milestone', 'M4']);
    expect(r.stdout + r.stderr).toContain('loop result: done');
    expect(r.status).toBe(0);
    const st = JSON.parse(fx.read('state.json')).issues;
    expect(st[10].state).toBe('CLOSED');
    expect(st[11].state ?? 'OPEN').toBe('OPEN');
  });

  it('-Milestone selects a bug like a PBI, delivers it in one fresh process, ends done when no open and no paused issue is left, reads the milestone M4 with one batched REST call (#103, #127, #235)', async () => {
    const gh = fx.setup({
      issues: {
        10: {
          labels: ['bug'],
          blockers: [{ number: 5, state: 'closed' }],
          body: '## Summary\n\nTier: fast — one-line fix\n', // #325: the model of the tier (haiku)
        },
      },
      milestones: { 'M4 (0.2.0)': [10] }, // a closed milestone renamed 'M<n> (x.y.z)' is still found by M4
      effect: 'close-first',
    });
    const r = await fx.run(gh, ['-Milestone', 'M4'], { HERDR_PANE_ID: 'w1:p5' });
    expect(r.status).toBe(0);
    // outside herdr (#12): no pane is attempted, no display is set and no error is printed; no queue file
    expect(r.stderr).toBe('');
    expect(fx.read('herdr-calls.txt')).toBe('');
    expect(
      fs
        .readdirSync(fx.cwd, { recursive: true })
        .map(String)
        .filter((f) => /queue/i.test(f)),
    ).toEqual([]);
    expect(fx.harnessCalls()).toEqual([
      '-p /deliver 10 --unattended --max 1 --model haiku --permission-mode auto --output-format stream-json --verbose',
    ]);
    expect(JSON.parse(fx.read('state.json')).issues[10].state).toBe('CLOSED');
    expect(r.stdout).toContain('loop result: done');
    // redirected stdout stays plain text
    expect(r.stdout).not.toContain(String.fromCharCode(27));
    const paths = gh.calls().map((c) => c.args.join(' '));
    expect(paths.filter((c) => c.includes('/issues?milestone='))).toHaveLength(5); // the state read before and after the one iteration; the closed list is read once for the done check; the status block (state=all) before and after (#329)
    expect(
      paths.filter((c) => c.includes('issues?milestone=1&state=open&per_page=100 --paginate')),
    ).toHaveLength(2);
    expect(paths.filter((c) => /^issue /.test(c))).toEqual([]);
    // one REST read of the picked PBI's body per iteration, for its tier (#325)
    expect(paths.filter((c) => /issues\/\d+$/.test(c))).toEqual([
      'api repos/{owner}/{repo}/issues/10',
    ]);
  });

  it('expands a Feature to its open PBIs, passes -Model on, and stops with "no progress" and the last log lines when a PBI stays open', async () => {
    const gh = fx.setup({
      issues: {
        100: { labels: ['feature'], children: [101, 102, 103] },
        101: pbi(),
        102: pbi(),
        103: pbi({ state: 'CLOSED' }),
      },
      effect: 'none',
      stream: [
        { type: 'assistant', message: { content: [{ type: 'text', text: 'working on it' }] } },
      ],
    });
    const r = await fx.run(gh, ['-Target', '100', '-Model', 'opus']);
    expect(r.status).toBe(1);
    expect(fx.harnessCalls()).toEqual([
      '-p /deliver 101 --unattended --max 1 --model opus --permission-mode auto --output-format stream-json --verbose',
    ]);
    expect(r.stdout).toContain('no progress');
    expect(r.stdout).toMatch(/ {2}\d\d:\d\d:\d\d » working on it/);
  });
});
