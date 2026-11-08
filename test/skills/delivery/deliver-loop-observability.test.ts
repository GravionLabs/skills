import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DeliverLoopFixture, PR, attention, pbi, step } from '../../helpers/deliver-loop-fixture';

const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Invoke-DeliverLoop.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

// #16, #372: observability of Invoke-DeliverLoop.ps1.
describe.skipIf(!hasPwsh || process.platform === 'win32')('Invoke-DeliverLoop.ps1', () => {
  const fx = new DeliverLoopFixture(SCRIPT);
  beforeAll(() => fx.start());
  afterAll(() => fx.stop());

  describe('observability', () => {
    const stream = [
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: '#401 pr: opened #55\nmore' }] },
      },
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'a1',
              name: 'Agent',
              input: { description: 'Review PBI #401 diff' },
            },
          ],
        },
      },
      {
        type: 'assistant',
        parent_tool_use_id: 'a1',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 't1',
              name: 'Bash',
              input: { description: 'git diff', command: 'git diff' },
            },
          ],
        },
      },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'src/a.ts' } }],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'boom\nsecond' },
          ],
        },
      },
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: `#401 review: ${'x'.repeat(90)}` }] },
      },
      { type: 'assistant', message: { content: [{ type: 'text', text: '#401 ci: red' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: '#401 merged: squash' }] } },
    ];

    it('logs one line per step with the agent prefix, tool errors, writes every record to the jsonl and owns the herdr display: harness runs without HERDR_ENV, pane tokens per progress line through the sink, cleared at the end (#16, #372)', async () => {
      // 401 is paused by the run (needs-decision) and counts as progress; 402 (open blocker), 403 (needs-refinement) and
      // 404 (interactive) stay behind, so the loop ends blocked
      const gh = fx.setup({
        issues: {
          401: pbi(),
          402: pbi({ blockers: [{ number: 5, state: 'open' }] }),
          403: pbi({ labels: ['pbi', 'needs-refinement'] }),
          404: pbi({ labels: ['pbi', 'interactive'] }),
        },
        effect: 'hold-first',
        stream,
        events: [
          step(401, 'pr', 'opened #55', PR),
          attention(401, 'pr_opened', 'opened #55'),
          step(401, 'review', 'x'.repeat(90), PR),
          step(401, 'ci', 'red', PR),
          attention(401, 'ci_red', 'red'),
          step(401, 'merged', 'squash', PR),
        ],
      });
      const r = await fx.run(gh, ['-Target', '401,402,403,404'], {
        HERDR_ENV: '1',
        HERDR_PANE_ID: 'p7',
        DELIVER_LOOP_ASSUME_TTY: '1',
      });
      expect(fx.harnessCalls()).toHaveLength(1);
      expect(r.status).toBe(2);
      expect(r.stdout).toContain('loop result: blocked');
      const lines = fx.read('.agents/deliver-loop.log');
      expect(lines).toMatch(/\d\d:\d\d:\d\d » #401 pr: opened #55/);
      expect(lines).toMatch(/\d\d:\d\d:\d\d Agent Review PBI #401 diff/);
      expect(lines).toMatch(/\d\d:\d\d:\d\d \[Review PBI #401 diff\] Bash git diff/);
      expect(lines).toMatch(/\d\d:\d\d:\d\d Read src\/a\.ts/);
      expect(lines).toMatch(/\d\d:\d\d:\d\d ✗ boom/);
      // stdout is a terminal (DELIVER_LOOP_ASSUME_TTY): the colored line
      const ESC = String.fromCharCode(27);
      expect(r.stdout).toContain(`[Review PBI #401 diff] ${ESC}[36mBash${ESC}[0m git diff`);
      const runDirs = fs
        .readdirSync(path.join(fx.cwd, '.agents/deliver-loop'))
        .filter((d) => d !== 'latest.txt');
      expect(runDirs).toHaveLength(1);
      const jsonl = fs
        .readFileSync(path.join(fx.cwd, '.agents/deliver-loop', runDirs[0], '401.jsonl'), 'utf8')
        .trim()
        .split('\n');
      expect(jsonl.map((l) => JSON.parse(l))).toEqual(stream);
      expect(fx.read('harness-calls.txt')).toContain('herdr_env=[]');
      const calls = fx
        .read('herdr-calls.txt')
        .trim()
        .split('\n')
        .filter((l) => l.includes('report-metadata'));
      // #372: the terminal sink of Report-Progress sets the tokens per step.finished: deliver step n/7 and the tone
      const p =
        'pane report-metadata p7 --source deliver --token deliver=#401 --token deliver_step=';
      const pr = '--token deliver_pr=#55';
      const ttl = '--ttl-ms 3600000';
      expect(calls).toEqual([
        `${p}6/7 pr: opened #55 ${pr} --token deliver_tone=success ${ttl}`,
        // the PR token stays for later steps; the step value is cut at 80 characters
        `${p}4/7 review: ${'x'.repeat(68)} ${pr} --token deliver_tone=neutral ${ttl}`,
        `${p}7/7 ci: red ${pr} --token deliver_tone=danger ${ttl}`,
        `${p}7/7 merged: squash ${pr} --token deliver_tone=success ${ttl}`,
        'pane report-metadata p7 --source deliver --clear-token deliver --clear-token deliver_step --clear-token deliver_pr --clear-token deliver_progress --clear-token deliver_tone',
      ]);
      expect(calls.join('\n')).not.toContain('display-agent');
      // no -LogPane: opens no pane (a TTY and a herdr pane are present); the plain log has no escape codes, stdout is colored and no .ansi.log exists
      expect(fx.read('herdr-calls.txt')).not.toContain('pane list');
      expect(lines).not.toContain(ESC);
      const ansi = r.stdout;
      expect(fs.existsSync(path.join(fx.cwd, '.agents/deliver-loop.ansi.log'))).toBe(false);
      expect(ansi).toMatch(new RegExp(`${ESC}\\[2m\\d\\d:\\d\\d:\\d\\d${ESC}\\[0m `));
      expect(ansi).toContain(`${ESC}[36mRead${ESC}[0m src/a.ts`);
      expect(ansi).toContain(`${ESC}[31m✗ boom${ESC}[0m`);
      // step lines are colored by the tone of the event; assistant text is logged uncolored
      expect(ansi).toContain(`${ESC}[31m#401 ci: red${ESC}[0m`);
      expect(ansi).toContain(`${ESC}[32m#401 merged: squash${ESC}[0m`);
      expect(ansi).toContain(`${ESC}[32m#401 pr: opened #55${ESC}[0m`);
      expect(ansi).toContain(`${ESC}[0m » #401 ci: red`);
      if (process.platform === 'darwin') {
        // osascript stub: attention step and loop result
        const notes = fx.read('notices.txt');
        expect(notes).toContain('#401 PR opened');
        expect(notes).toContain('#401 CI red');
        expect(notes).toContain('loop result: blocked');
      }
    });
  });
});
