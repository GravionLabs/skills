import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../../helpers/pwsh-worker';

const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Report-Progress.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

// #371: terminal sink of Report-Progress.ps1 with fake herdr and poimen-server.
describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'Report-Progress.ps1 terminal sink',
  () => {
    let root: string;
    let bin: string;
    let calls: string;
    let worker: PwshWorker;

    const stub = (name: string, body = '') =>
      fs.writeFileSync(
        path.join(bin, name),
        `#!/bin/sh\necho "${name} $*" >> "${calls}"\n${body}\n`,
        {
          mode: 0o755,
        },
      );
    const recorded = () =>
      fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n') : [];
    const emit = (args: string[], extra: Record<string, string> = {}) =>
      worker.run(args, {
        cwd: root,
        env: {
          PATH: `${bin}${path.delimiter}${process.env.PATH}`,
          HOME: root,
          AGENT_EVENTS_DIR: path.join(root, 'ev'),
          AGENT_EVENTS_RUN: 'r1',
          AGENT_EVENTS_TERMINAL: 'owner',
          DELIVER_TERMINAL_BACKEND: 'herdr',
          HERDR_PANE_ID: 'w1:p2',
          ...extra,
        },
      });
    const metadata = () => recorded().filter((l) => l.includes('report-metadata'));

    beforeAll(() => {
      root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'progress-sink-')));
      bin = path.join(root, 'bin');
      calls = path.join(root, 'calls.txt');
      fs.mkdirSync(bin);
      worker = new PwshWorker(SCRIPT);
    });
    beforeEach(() => {
      fs.rmSync(calls, { force: true });
      stub('herdr');
      stub('poimen-server');
    });
    afterAll(() => {
      worker?.close();
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('herdr: step.finished sets deliver, deliver_step, deliver_pr and deliver_tone', async () => {
      const r = await emit([
        '-Type',
        'step.finished',
        '-Issue',
        '12',
        '-Step',
        'review',
        '-Result',
        'fix needed',
        '-Pr',
        'https://github.com/o/r/pull/55',
      ]);
      expect(r.status).toBe(0);
      expect(metadata()).toEqual([
        'herdr pane report-metadata w1:p2 --source deliver --token deliver=#12 --token deliver_step=4/7 review: fix needed --token deliver_pr=#55 --token deliver_tone=warning --ttl-ms 3600000',
      ]);
    });

    it('cuts deliver_step at 80 characters and omits deliver_pr without a PR', async () => {
      await emit([
        '-Type',
        'step.finished',
        '-Issue',
        '3',
        '-Step',
        'ci',
        '-Result',
        'x'.repeat(120),
      ]);
      const line = metadata()[0];
      expect(line).toContain(`--token deliver_step=7/7 ci: ${'x'.repeat(80 - 'ci: '.length - 4)}`);
      expect(line).not.toContain('deliver_pr');
      expect(line.match(/deliver_step=([^-]*)--token/)![1].trim().length).toBeLessThanOrEqual(80);
    });

    it('milestone.progress sets deliver_progress', async () => {
      await emit(['-Type', 'milestone.progress', '-Closed', '7', '-Total', '19']);
      expect(metadata()).toEqual([
        'herdr pane report-metadata w1:p2 --source deliver --token deliver_progress=7/19 --ttl-ms 3600000',
      ]);
    });

    it('agent state: issue.started working, attention paused/blocked blocked, other kinds nothing', async () => {
      await emit(['-Type', 'issue.started', '-Issue', '4']);
      await emit(['-Type', 'attention', '-Kind', 'paused']);
      await emit(['-Type', 'attention', '-Kind', 'ci_red']);
      expect(recorded().filter((l) => l.includes('report-agent'))).toEqual([
        'herdr pane report-agent w1:p2 --state working --source deliver-loop --agent deliver',
        'herdr pane report-agent w1:p2 --state blocked --source deliver-loop --agent deliver',
      ]);
    });

    it.each([
      ['done', 'idle'],
      ['blocked', 'blocked'],
    ])('run.finished %s clears the tokens, sets %s and releases', async (result, state) => {
      await emit(['-Type', 'run.finished', '-RunResult', result]);
      expect(recorded().filter((l) => !l.includes('pane get'))).toEqual([
        'herdr pane report-metadata w1:p2 --source deliver --clear-token deliver --clear-token deliver_step --clear-token deliver_pr --clear-token deliver_progress --clear-token deliver_tone',
        `herdr pane report-agent w1:p2 --state ${state} --source deliver-loop --agent deliver`,
        'herdr pane release-agent w1:p2 --source deliver-loop --agent deliver',
      ]);
    });

    it('poimen: tokens including deliver_tone go through poimen-server', async () => {
      await emit(['-Type', 'step.finished', '-Issue', '9', '-Step', 'done'], {
        DELIVER_TERMINAL_BACKEND: 'poimen',
        POIMEN_TERMINAL_ID: 't1',
      });
      expect(recorded()).toEqual([
        'poimen-server report tokens --source deliver --ttl 3600 deliver=#9 deliver_step=done deliver_tone=success',
      ]);
    });

    it('a nested emitter (run without owner) reports nothing but still writes the event', async () => {
      const r = await emit(['-Type', 'step.finished', '-Issue', '12', '-Step', 'pr'], {
        AGENT_EVENTS_TERMINAL: 'nested',
      });
      expect(r.status).toBe(0);
      expect(recorded()).toEqual([]);
      expect(fs.readFileSync(path.join(root, 'ev', 'r1.jsonl'), 'utf8')).toContain('step.finished');
    });

    it('run.started creates the run, prints the owner marker and reports itself', async () => {
      const r = await emit(['-Type', 'run.started'], {
        AGENT_EVENTS_RUN: '',
        AGENT_EVENTS_TERMINAL: '',
      });
      expect(r.stdout).toMatch(/AGENT_EVENTS_RUN=\S+\s+AGENT_EVENTS_TERMINAL=owner/);
    });

    it('-Run carries the run id without AGENT_EVENTS_RUN and reports to the terminal', async () => {
      const none = { AGENT_EVENTS_RUN: '', AGENT_EVENTS_TERMINAL: '' };
      const r = await emit(
        ['-Type', 'step.finished', '-Issue', '1', '-Step', 'pr', '-Run', 'r9'],
        none,
      );
      expect(r.stderr).toBe('');
      expect(fs.readFileSync(path.join(root, 'ev', 'r9.jsonl'), 'utf8')).toContain('step.finished');
    });

    it('no run env: run.started reports itself without stray pane calls; other types write nothing', async () => {
      const none = { AGENT_EVENTS_RUN: '', AGENT_EVENTS_TERMINAL: '' };
      const r = await emit(['-Type', 'run.started'], none);
      expect(r.stdout).toContain('AGENT_EVENTS_TERMINAL=owner');
      expect(recorded()).toEqual([]);
      await emit(['-Type', 'step.finished', '-Issue', '1', '-Step', 'pr'], none);
      expect(recorded()).toEqual([]);
    });

    it('run set without owner: nothing, including run.finished and issue.started', async () => {
      const nested = { AGENT_EVENTS_TERMINAL: '' };
      await emit(['-Type', 'issue.started', '-Issue', '4'], nested);
      await emit(['-Type', 'run.finished', '-RunResult', 'done'], nested);
      expect(recorded()).toEqual([]);
    });

    it('the conflict check runs only when an agent state is set', async () => {
      await emit(['-Type', 'step.finished', '-Issue', '1', '-Step', 'pr']);
      await emit(['-Type', 'milestone.progress', '-Closed', '1', '-Total', '2']);
      expect(recorded().some((l) => l.includes('pane get'))).toBe(false);
      await emit(['-Type', 'issue.started', '-Issue', '4']);
      expect(recorded().some((l) => l.includes('pane get'))).toBe(true);
    });

    it('poimen: run.finished clears the tokens', async () => {
      await emit(['-Type', 'run.finished', '-RunResult', 'done'], {
        DELIVER_TERMINAL_BACKEND: 'poimen',
        POIMEN_TERMINAL_ID: 't1',
      });
      expect(recorded().some((l) => l.startsWith('poimen-server') && l.includes('deliver'))).toBe(
        true,
      );
    });

    it('a herdr pane with another agent gets tokens but no agent state', async () => {
      stub('herdr', `[ "$2" = get ] && echo '{"result":{"pane":{"agent":"claude"}}}'`);
      await emit(['-Type', 'issue.started', '-Issue', '4']);
      await emit(['-Type', 'run.finished', '-RunResult', 'done']);
      const l = recorded();
      expect(l.some((x) => x.includes('report-agent') || x.includes('release-agent'))).toBe(false);
      expect(l.filter((x) => x.includes('--clear-token')).length).toBe(1);
    });

    it('backend none or a failing backend: no call, exit 0, event written', async () => {
      const none = await emit(['-Type', 'step.finished', '-Issue', '1', '-Step', 'pr'], {
        DELIVER_TERMINAL_BACKEND: 'none',
      });
      expect(none.status).toBe(0);
      expect(recorded()).toEqual([]);
      stub('herdr', 'exit 1');
      const bad = await emit(['-Type', 'step.finished', '-Issue', '1', '-Step', 'merge']);
      expect(bad.status).toBe(0);
      expect(fs.readFileSync(path.join(root, 'ev', 'r1.jsonl'), 'utf8')).toContain('"merge"');
    });
  },
);
