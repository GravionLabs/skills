import { spawnSync } from 'child_process';
import * as path from 'path';
import { DeliverLoopFixture, pbi } from '../../helpers/deliver-loop-fixture';

const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Invoke-DeliverLoop.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

// #673: the loop checks the whole set and prints a run plan before the first session (own file: time budget)
describe.skipIf(!hasPwsh || process.platform === 'win32')('Invoke-DeliverLoop.ps1 run plan', () => {
  const fx = new DeliverLoopFixture(SCRIPT);
  beforeAll(() => fx.start());
  afterAll(() => fx.stop());

  const started = () => fx.harnessCalls().map((c) => Number(c.split(' ')[2]));

  it('every check leaves its PBI out with the reason, never starts it and writes nothing', async () => {
    const gh = fx.setup({
      issues: {
        1: pbi(),
        5: pbi({ labels: ['pbi', 'needs-decision'] }),
        6: pbi({ labels: ['pbi', 'needs-refinement'] }),
        7: pbi({ labels: ['pbi', 'interactive'] }),
        8: pbi({ body: '## Summary\n\nx\n' }),
        9: pbi({ body: '## Acceptance Criteria\n\nTBD\n\n## Notes\n- a note\n' }),
        10: { labels: ['bug'], body: '## Acceptance Criteria\n- [ ] fixed\n' },
        11: pbi({
          blockers: [
            { number: 90, state: 'open', repository_url: 'https://api.github.com/repos/o/other' },
          ],
        }),
        12: pbi({ blockers: [{ number: 91, state: 'open' }] }),
        13: pbi({ blockers: [{ number: 5, state: 'open' }] }),
        14: pbi({ blockers: [{ number: 15, state: 'open' }] }),
        15: pbi({ blockers: [{ number: 14, state: 'open' }] }),
      },
      effect: 'close-first',
    });
    const r = await fx.run(gh, ['-Target', '1,5,6,7,8,9,10,11,12,13,14,15']);
    expect(started()).toEqual([1]);
    expect(r.stdout).toContain('run plan: 1 to deliver, 11 not delivered');
    expect(r.stdout).toContain('1. #1 tier standard');
    const left = (nr: number, reason: string) =>
      expect(r.stdout).toContain(`not delivered: #${nr} ${reason}`);
    left(5, 'needs-decision');
    left(6, 'needs-refinement');
    left(7, 'interactive');
    left(8, 'no acceptance criteria');
    left(9, 'no acceptance criteria');
    left(10, 'bug without a reproduction');
    left(11, 'open blocker o/other#90');
    left(12, 'open blocker #91');
    left(13, 'blocker #5 is not deliverable (needs-decision)');
    left(14, 'cycle in blocked-by: #14 ↔ #15');
    left(15, 'cycle in blocked-by: #14 ↔ #15');
    // the last lines list them again, and the run ends blocked
    expect(r.stdout).toMatch(/set aside #15: cycle in blocked-by: #14 ↔ #15 \(no PR\)\s*$/);
    expect(r.status).toBe(2);
    // read only: no write to GitHub, no label or comment on a left-out PBI
    expect(gh.calls().filter((c) => c.args.some((a) => /^-X$|--method/.test(a)))).toEqual([]);
    expect(JSON.parse(fx.read('state.json')).issues[5].labels).toEqual(['pbi', 'needs-decision']);
  });

  it('a deliverable blocker orders the plan; the blocked-by links are read once, later iterations read only issue states', async () => {
    const gh = fx.setup({
      issues: {
        1: pbi({ blockers: [{ number: 2, state: 'open' }] }),
        2: pbi(),
        3: pbi(),
      },
      effect: 'close-first',
    });
    const r = await fx.run(gh, ['-Target', '1,2,3']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(
      /1\. #2 tier standard[\s\S]*2\. #1 tier standard[\s\S]*3\. #3 tier standard/,
    );
    expect(started()).toEqual([2, 1, 3]);
    expect(gh.calls().filter((c) => /blocked_by/.test(c.args[1] ?? ''))).toHaveLength(3);
  });

  it('-DryRun in milestone and target mode prints the plan (also a target of another milestone), exits 0 and starts no session', async () => {
    const gh = fx.setup({
      issues: { 5: pbi({ milestone: 'M9' }), 7: pbi(), 8: pbi() },
      milestones: { M8: [7, 8] },
      effect: 'close-first',
    });
    const m = await fx.run(gh, ['-Milestone', 'M8', '-Target', '5', '-DryRun']);
    expect(m.status).toBe(0);
    expect(m.stdout).toContain('run plan: 2 to deliver, 1 not delivered');
    expect(m.stdout).toMatch(/1\. #7 tier standard[\s\S]*2\. #8 tier standard/);
    expect(m.stdout).toContain('not delivered: #5 outside M8 (milestone: M9)');
    const t = await fx.run(gh, ['-Target', '7', '-DryRun']);
    expect(t.status).toBe(0);
    expect(t.stdout).toContain('run plan: 1 to deliver, 0 not delivered');
    expect(fx.harnessCalls()).toEqual([]);
    expect(JSON.parse(fx.read('state.json')).issues[7].state ?? 'OPEN').toBe('OPEN');
  });

  it('no deliverable PBI: the plan is printed and the run ends blocked (exit 2) without a session', async () => {
    const gh = fx.setup({
      issues: { 3: pbi({ labels: ['pbi', 'needs-decision'] }), 4: pbi({ body: '' }) },
      effect: 'close-first',
    });
    const r = await fx.run(gh, ['-Target', '3,4']);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('run plan: 0 to deliver, 2 not delivered');
    expect(r.stdout).toContain('loop result: blocked');
    expect(fx.harnessCalls()).toEqual([]);
  });
});
