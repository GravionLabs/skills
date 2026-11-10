import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { checkEventsDir } from '../../helpers/agent-events';
import { DeliverLoopFixture, pbi, step } from '../../helpers/deliver-loop-fixture';

const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Invoke-DeliverLoop.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

// #488, #474: the iteration PBI and the stop request of Invoke-DeliverLoop.ps1.
describe.skipIf(!hasPwsh || process.platform === 'win32')('Invoke-DeliverLoop.ps1', () => {
  const fx = new DeliverLoopFixture(SCRIPT);
  beforeAll(() => fx.start());
  afterAll(() => fx.stop());

  describe('iteration PBI (#488)', () => {
    it('hands the session the PBI the iteration is logged under: file, records and tier model agree', async () => {
      const gh = fx.setup({
        issues: {
          81: pbi({ body: 'Tier: fast' }),
          82: pbi({ body: 'Tier: strong' }),
        },
        milestones: { M4: [81, 82] },
        effect: 'close-first',
      });
      const r = await fx.run(gh, ['-Milestone', 'M4']);
      expect(r.status).toBe(0);
      // not "/deliver --milestone M4": the session cannot pick another PBI than the logged one
      expect(fx.harnessCalls()).toEqual([
        '-p /deliver 81 --unattended --max 1 --model haiku --permission-mode auto --output-format stream-json --verbose',
        '-p /deliver 82 --unattended --max 1 --model opus --permission-mode auto --output-format stream-json --verbose',
      ]);
      const dir = fx.read('.agents/deliver-loop/latest.txt').trim();
      const recs = fx
        .read(path.relative(fx.cwd, path.join(dir, 'progress.jsonl')))
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      expect(
        recs
          .filter((x) => x.event === 'iteration-start' || x.event === 'iteration-end')
          .map((x) => `${x.event}:${x.pbi}`),
      ).toEqual([
        'iteration-start:81',
        'iteration-end:81',
        'iteration-start:82',
        'iteration-end:82',
      ]);
      expect(fs.existsSync(path.join(dir, '81.jsonl'))).toBe(true);
      expect(fs.existsSync(path.join(dir, '82.jsonl'))).toBe(true);
    });
  });

  describe('wait ceiling of the harness (#461)', () => {
    const unset = {
      CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: undefined,
      COPILOT_TASK_WAIT_TIMEOUT_SECONDS: undefined,
    };
    const one = () =>
      fx.setup({ issues: { 91: pbi() }, milestones: { M9: [91] }, effect: 'close-first' });

    it.each([
      ['claude', {}, 'ceiling=[0] copilot_wait=[]'],
      [
        'claude',
        { CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '90000' },
        'ceiling=[90000] copilot_wait=[]',
      ],
      ['copilot', {}, 'ceiling=[] copilot_wait=[3600]'],
      ['copilot', { COPILOT_TASK_WAIT_TIMEOUT_SECONDS: '60' }, 'ceiling=[] copilot_wait=[60]'],
    ])('%s with %j: the child sees %s', async (harness, env, seen) => {
      const r = await fx.run(one(), ['-Milestone', 'M9', '-Harness', harness, '-Model', 'm'], {
        ...unset,
        ...env,
      });
      expect(r.status).toBe(0);
      expect(fx.harnessWaits()).toEqual([seen]);
    });

    it('does not leave the default in the loop environment', async () => {
      const r = await fx.run(one(), ['-Milestone', 'M9', '-Harness', 'claude'], unset);
      expect(r.status).toBe(0);
      expect(r.stdout + r.stderr).not.toContain('CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=<');
      expect(fx.harnessWaits()).toEqual(['ceiling=[0] copilot_wait=[]']);
    });
  });

  describe('stop request (#474)', () => {
    const records = () =>
      fs
        .readFileSync(
          path.join(fx.read('.agents/deliver-loop/latest.txt').trim(), 'progress.jsonl'),
          'utf8',
        )
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));

    it('stops before the first iteration when the stop file exists: exit 0, stopped, resume command, file deleted', async () => {
      const gh = fx.setup({
        issues: { 71: pbi(), 72: pbi() },
        effect: 'close-first',
        stopBefore: true,
      });
      const r = await fx.run(gh, ['-Target', '71,72', '-Max', '5', '-Model', 'opus'], {
        AGENT_EVENTS_DIR: path.join(fx.cwd, 'events'),
      });
      expect(r.status).toBe(0);
      expect(fx.harnessCalls()).toEqual([]);
      expect(r.stdout).toContain('loop result: stopped (0 iteration(s)');
      expect(r.stdout.trim().split('\n').pop()).toMatch(
        /resume: deliver-loop -Target 71,72 -Max 5 -Model opus$/,
      );
      expect(records().pop()).toMatchObject({
        event: 'result',
        result: 'stopped',
        code: 0,
        iterations: 0,
      });
      const dir = fx.read('.agents/deliver-loop/latest.txt').trim();
      expect(fs.existsSync(path.join(dir, 'stop'))).toBe(false);
    });

    it('a stop file with now: the harness sees STOP requested, an unchanged PBI set ends stopped, not no progress (#476)', async () => {
      const gh = fx.setup({
        issues: { 81: pbi(), 82: pbi() },
        effect: 'none',
        stopDuring: true,
        events: [step(81, 'implement', 'done')],
        stream: [{ type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } }],
      });
      const r = await fx.run(gh, ['-Target', '81,82', '-Max', '5'], {
        AGENT_EVENTS_DIR: path.join(fx.cwd, 'events'),
      });
      expect(r.status).toBe(0);
      expect(fx.read('stop-out.txt')).toContain('STOP requested');
      expect(fx.harnessCalls()).toHaveLength(1);
      expect(r.stdout).toContain('loop result: stopped');
      expect(r.stdout).not.toContain('no progress');
      expect(records().pop()).toMatchObject({ result: 'stopped', code: 0 });
    });

    it('a stop file created during iteration 1 finishes that PBI, reports stopping, then stops with -Max reduced', async () => {
      const gh = fx.setup({
        issues: { 81: pbi(), 82: pbi() },
        effect: 'close-first',
        stopDuring: true,
        stream: [{ type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } }],
      });
      const r = await fx.run(gh, ['-Target', '81,82', '-Max', '5'], {
        AGENT_EVENTS_DIR: path.join(fx.cwd, 'events'),
      });
      expect(r.status).toBe(0);
      expect(fx.harnessCalls()).toHaveLength(1);
      expect(r.stdout).toContain('stop requested: stops after #81');
      expect(r.stdout).toContain('loop result: stopped (1 iteration(s), 1 PBI(s) open)');
      expect(r.stdout.trim().split('\n').pop()).toMatch(
        /resume: deliver-loop -Target 81,82 -Max 4$/,
      );
      const recs = records();
      expect(recs.map((x) => x.event)).toEqual([
        'start',
        'iteration-start',
        'iteration-end',
        'result',
      ]);
      expect(recs[3]).toMatchObject({ result: 'stopped', code: 0, iterations: 1, open: 1 });
      const dir = fx.read('.agents/deliver-loop/latest.txt').trim();
      expect(fs.existsSync(path.join(dir, 'stop'))).toBe(false);
      const evFile = fs.readdirSync(path.join(fx.cwd, 'events')).find((f) => f.endsWith('.jsonl'));
      const evs = fs
        .readFileSync(path.join(fx.cwd, 'events', evFile ?? ''), 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      const stopping = evs.filter((e) => e.type === 'attention' && e.deliver?.kind === 'stopping');
      expect(stopping).toHaveLength(1);
      expect(stopping[0]).toMatchObject({
        reason: 'deliver.stopping',
        text: 'stops after #81',
        task: 'issue-81',
        tone: 'neutral',
      });
      expect(evs.pop()).toMatchObject({
        type: 'run.finished',
        outcome: 'cancelled',
        deliver: { result: 'stopped' },
      });
      expect(checkEventsDir(path.join(fx.cwd, 'events'))).toEqual({});
    });
  });
});
