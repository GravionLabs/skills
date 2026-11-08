import { spawnSync } from 'child_process';
import * as path from 'path';
import { DeliverLoopFixture, pbi } from '../../helpers/deliver-loop-fixture';

const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Invoke-DeliverLoop.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

// #235, #327, #377: stop rules of Invoke-DeliverLoop.ps1 with a milestone.
describe.skipIf(!hasPwsh || process.platform === 'win32')('Invoke-DeliverLoop.ps1', () => {
  const fx = new DeliverLoopFixture(SCRIPT);
  beforeAll(() => fx.start());
  afterAll(() => fx.stop());

  it('-Milestone without open issues but a closed PBI labeled needs-decision ends blocked, not done (#235)', async () => {
    const gh = fx.setup({
      issues: { 10: pbi({ state: 'CLOSED', labels: ['pbi', 'needs-decision'] }) },
      milestones: { M4: [10] },
    });
    const r = await fx.run(gh, ['-Milestone', 'M4']);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('loop result: blocked');
    expect(fx.harnessCalls()).toEqual([]);
  });

  it('-Milestone skips a PBI below a Feature of the milestone that has no or another milestone, and counts the same set (#327)', async () => {
    const gh = fx.setup({
      issues: {
        20: { labels: ['feature'], children: [21, 22, 23] },
        21: pbi({ milestone: 'M4' }),
        22: pbi(),
        23: pbi({ milestone: 'M5' }),
      },
      milestones: { M4: [20] },
      effect: 'close-first',
    });
    const r = await fx.run(gh, ['-Milestone', 'M4']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('#22 select: outside M4 (milestone: none), skipped');
    expect(r.stdout).toContain('#23 select: outside M4 (milestone: M5), skipped');
    expect(r.stdout).not.toContain('#21 select: outside');
    // 21 is delivered, then nothing is left: done, not "no progress"
    expect(r.stdout).toContain('loop result: done');
    expect(fx.harnessCalls()).toHaveLength(1);
  });

  it('/deliver <feature> without -Milestone still takes its PBIs without a milestone (#327)', async () => {
    const gh = fx.setup({
      issues: { 20: { labels: ['feature'], children: [22] }, 22: pbi() },
      effect: 'close-first',
    });
    const r = await fx.run(gh, ['20']);
    expect(r.stdout).not.toContain('outside');
    expect(r.stdout).toContain('loop result: done');
  });

  it('an explicitly passed release-test Target is dropped, never delivered, and the loop ends done (#377)', async () => {
    const gh = fx.setup({
      issues: { 11: { labels: ['pbi', 'interactive', 'release-test'] } },
      effect: 'close-first',
    });
    const r = await fx.run(gh, ['11']);
    expect(r.stdout + r.stderr).toContain('loop result: done');
    expect(r.status).toBe(0);
    expect(fx.harnessCalls()).toEqual([]);
    expect(JSON.parse(fx.read('state.json')).issues[11].state ?? 'OPEN').toBe('OPEN');
  });
});
