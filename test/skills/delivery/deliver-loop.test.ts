import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DeliverLoopFixture, PR, attention, pbi, step } from '../../helpers/deliver-loop-fixture';

const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Invoke-DeliverLoop.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

// #893: arguments, harness, model per tier and progress of Invoke-DeliverLoop.ps1.
describe.skipIf(!hasPwsh || process.platform === 'win32')('Invoke-DeliverLoop.ps1', () => {
  const fx = new DeliverLoopFixture(SCRIPT);
  beforeAll(() => fx.start());
  afterAll(() => fx.stop());

  describe('arguments', () => {
    it('needs a target or a milestone', () => {
      const gh = fx.setup({ issues: {} });
      const r = spawnSync('pwsh', ['-NoProfile', '-File', SCRIPT], {
        cwd: fx.cwd,
        encoding: 'utf8',
        env: gh.env(),
      });
      expect(r.status).toBe(64);
      expect(r.stderr).toContain('-Target');
      // unknown harness: fails before the first iteration with the supported list
      const h = spawnSync(
        'pwsh',
        ['-NoProfile', '-File', SCRIPT, '-Target', '1', '-Harness', 'opencode'],
        { cwd: fx.cwd, encoding: 'utf8', env: gh.env() },
      );
      expect(h.status).toBe(64);
      expect(h.stderr).toContain('Supported: claude, copilot');
      expect(fx.harnessCalls()).toEqual([]);
    });

    it('rejects -Max 0', async () => {
      const r = await fx.run(fx.setup({ issues: { 1: pbi() } }), ['-Target', '1', '-Max', '0']);
      expect(r.status).not.toBe(0);
      expect(fx.harnessCalls()).toEqual([]);
    });
  });

  describe('harness', () => {
    // fixture: real output of copilot 1.0.105 (-p … --output-format json), trimmed to the event types the parser reads
    const live = fs
      .readFileSync(path.resolve(__dirname, 'fixtures/copilot-cli-1.0.105.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const events = [
      { type: 'assistant.message', data: { content: '#7 pr: opened #55\nmore' } },
      {
        type: 'tool.execution_start',
        data: { toolCallId: 'c1', toolName: 'bash', arguments: { command: 'ls -la' } },
      },
      {
        type: 'tool.execution_start',
        data: {
          toolCallId: 'c2',
          toolName: 'view',
          parentToolCallId: 'c0',
          arguments: { path: 'src/a.ts' },
        },
      },
      {
        type: 'tool.execution_complete',
        data: { toolCallId: 'c1', success: false, error: { message: 'boom\nsecond' } },
      },
      { type: 'tool.execution_complete', data: { toolCallId: 'c2', success: true } },
      { type: 'assistant.message', data: { content: '#7 ci: red' } },
      { type: 'session.idle', data: {} },
    ];

    it('starts copilot -p per PBI with the default model auto (#220) and non-interactive permissions, logs steps, notices and herdr tokens; stop rules and exit code as for claude', async () => {
      const gh = fx.setup({
        issues: { 7: pbi() },
        effect: 'close-first',
        stream: [...live, ...events],
        events: [
          step(7, 'pr', 'opened #55', PR),
          attention(7, 'pr_opened', 'opened #55'),
          step(7, 'ci', 'red', PR),
          attention(7, 'ci_red', 'red'),
        ],
      });
      const r = await fx.run(gh, ['-Target', '7', '-Harness', 'copilot'], {
        HERDR_ENV: '1',
        HERDR_PANE_ID: 'p7',
      });
      expect(r.status).toBe(0);
      expect(fx.harnessCalls()).toEqual([
        '-p /deliver 7 --unattended --max 1 --model auto --allow-all-tools --allow-all-paths --allow-all-urls --no-ask-user --output-format json',
      ]);
      expect(fx.read('harness-calls.txt')).toContain('herdr_env=[]');
      const lines = fx.read('.agents/deliver-loop.log');
      // assistant text is logged as it is; the step line comes from the event
      expect(lines).toMatch(/\d\d:\d\d:\d\d » #7 pr: opened #55/);
      expect(lines).toMatch(/\d\d:\d\d:\d\d #7 pr: opened #55\n/);
      expect(lines).toMatch(/\d\d:\d\d:\d\d bash ls -la/);
      expect(lines).toMatch(/\d\d:\d\d:\d\d \[subagent\] view src\/a\.ts/);
      expect(lines).toMatch(/\d\d:\d\d:\d\d ✗ boom/);
      expect(fx.read('herdr-calls.txt')).toContain(
        'deliver_step=7/7 ci: red --token deliver_pr=#55 --token deliver_tone=danger',
      );
      if (process.platform === 'darwin') {
        // osascript stub: notifications exist only on macOS
        expect(fx.read('notices.txt')).toContain('#7 PR opened');
        expect(fx.read('notices.txt')).toContain('#7 CI red');
      }
      expect(r.stdout).toContain('loop result: done');
      expect(fs.existsSync(path.join(fx.cwd, '.agents/deliver-loop.ansi.log'))).toBe(false);
    });
  });

  describe('model per tier (#325)', () => {
    const modelOf = () =>
      fx
        .harnessCalls()
        .find((c) => c.includes('--model'))
        ?.match(/--model (\S+)/)?.[1];
    const body = (line: string) => `## Summary\n\n${line}\n\n## Acceptance criteria\n- [ ] x\n`;

    // the Tier line -> haiku is asserted in the milestone case above; the -Model override in the Feature case
    it('takes the model from the size when there is no Tier line', async () => {
      const size = fx.setup({
        issues: { 61: pbi({ body: body('Size: L') }) },
        effect: 'close-first',
      });
      const s = await fx.run(size, ['-Target', '61']);
      expect(s.status).toBe(0);
      expect(s.stdout).toContain('#61 tier strong (size L) → model opus');
      expect(modelOf()).toBe('opus');
    });
  });

  describe('progress for a control session (#321)', () => {
    it('writes progress.jsonl (start, iteration-start, iteration-end, result) and latest.txt', async () => {
      const gh = fx.setup({
        issues: { 31: pbi(), 32: pbi() },
        effect: 'close-first',
      });
      const r = await fx.run(gh, ['-Target', '31,32']);
      expect(r.status).toBe(0);
      const latest = fx.read('.agents/deliver-loop/latest.txt').trim();
      expect(fs.realpathSync(latest)).toBe(
        fs.realpathSync(path.dirname(path.join(latest, 'progress.jsonl'))),
      );
      const recs = fs
        .readFileSync(path.join(latest, 'progress.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      expect(recs.map((x) => x.event)).toEqual([
        'start',
        'iteration-start',
        'iteration-end',
        'iteration-start',
        'iteration-end',
        'result',
      ]);
      expect(recs[0]).toMatchObject({ targets: [31, 32], open: 2 });
      expect(recs[2]).toMatchObject({ pbi: 31, delivered: '31', open: 1 });
      expect(recs[5]).toMatchObject({ result: 'done', code: 0, iterations: 2, open: 0 });
    });

    it('records a held PBI as result blocked', async () => {
      const gh = fx.setup({ issues: { 41: pbi({ labels: ['pbi', 'needs-decision'] }) } });
      const r = await fx.run(gh, ['-Target', '41']);
      expect(r.status).toBe(2);
      const latest = fx.read('.agents/deliver-loop/latest.txt').trim();
      const last = fs
        .readFileSync(path.join(latest, 'progress.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l))
        .pop();
      expect(last).toMatchObject({ event: 'result', result: 'blocked', code: 2 });
    });
  });
});
