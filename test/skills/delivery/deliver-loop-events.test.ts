import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkRunFile, validateCoreState, validateDeliverState } from '../../helpers/agent-events';
import { REPORT_PROGRESS } from '../../helpers/report-progress';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

// #372: Invoke-DeliverLoop.ps1 opens a run (run.started), emits the events it knows, ends it with exactly one run.finished
// (also on error) and writes no status.json (#376); the state is the projection of the event file (ConvertFrom-ProgressEvents.ps1).
// gh and claude are stubs on PATH; the claude stub snapshots the event file at the start of each iteration.
const ROOT = path.resolve(__dirname, '../../..');
const SCRIPTS = path.join(ROOT, 'skills/delivery/deliver/scripts');
const valid = (doc: { deliver: unknown }) => {
  expect(validateCoreState(doc), JSON.stringify(validateCoreState.errors)).toBe(true);
  expect(validateDeliverState(doc.deliver), JSON.stringify(validateDeliverState.errors)).toBe(true);
};
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
const BASE = 'https://github.com/acme/app';

describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'Invoke-DeliverLoop.ps1 run events without status.json',
  () => {
    let dir: string;
    let cwd: string;
    let seq = 0;
    let loop: PwshWorker;
    let reducer: PwshWorker;

    beforeAll(() => {
      dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'loop-events-')));
      loop = new PwshWorker(path.join(SCRIPTS, 'Invoke-DeliverLoop.ps1'));
      reducer = new PwshWorker(path.join(SCRIPTS, 'ConvertFrom-ProgressEvents.ps1'));
    });
    afterAll(() => {
      loop.close();
      reducer.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    // milestone M4: #5 closed, #10 and #11 open, #12 open with needs-decision. Iteration 1 tries a nested run.started (not
    // written: the harness is nested), reports step pr 'opened #55' of #10 and closes #10; iteration 2 labels #11 needs-refinement.
    const setup = (opts: { failOpenRead?: boolean } = {}) => {
      cwd = path.join(dir, `case-${++seq}`);
      fs.mkdirSync(cwd, { recursive: true });
      const state = path.join(cwd, 'state.json');
      const issues: Record<string, any> = {
        5: { state: 'closed', title: 'done before' },
        10: { state: 'open', title: 'first' },
        11: { state: 'open', title: 'second' },
        12: { state: 'open', title: 'decide', labels: ['needs-decision', 'pbi'] },
      };
      fs.writeFileSync(state, JSON.stringify({ issues }));
      const gh = createFakeGh(
        cwd,
        `(call) => {
        const fs = require('fs');
        const s = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
        const a = call.args[1] || '';
        const row = (n) => ({ number: Number(n), title: s.issues[n].title, state: s.issues[n].state, closed_at: null, body: '',
          labels: (s.issues[n].labels || ['pbi']).map((name) => ({ name })), assignees: [], issue_dependencies_summary: { blocked_by: s.issues[n].blocker ? 1 : 0 } });
        if (/\\/milestones\\?/.test(a)) return { rest: [[{ number: 4, title: 'M4 Status', state: 'open', html_url: '${BASE}/milestone/4' }]] };
        if (${opts.failOpenRead ? 'true' : 'false'} && /state=open/.test(a)) throw new Error('rate limited');
        let m = /issues\\?milestone=4&state=(open|closed|all)/.exec(a);
        if (m) return { rest: [Object.keys(s.issues).filter((n) => m[1] === 'all' || s.issues[n].state === m[1]).map(row)] };
        m = /issues\\/(\\d+)\\/dependencies\\/blocked_by/.exec(a);
        if (m) { const b = s.issues[m[1]].blocker; return { rest: [b ? [{ number: b, state: 'open', repository_url: 'x' }] : []] }; }
        throw new Error('unexpected gh ' + call.args.join(' '));
      }`,
      );
      fs.writeFileSync(
        path.join(cwd, 'harness.js'),
        `const fs = require('fs'); const path = require('path'); const cwd = ${JSON.stringify(cwd)};
const nFile = path.join(cwd, 'iteration'); const n = (fs.existsSync(nFile) ? Number(fs.readFileSync(nFile, 'utf8')) : 0) + 1;
fs.writeFileSync(nFile, String(n));
const env = process.env; const ev = path.join(env.AGENT_EVENTS_DIR, env.AGENT_EVENTS_RUN + '.jsonl');
fs.appendFileSync(path.join(cwd, 'harness-env.jsonl'), JSON.stringify({ run: env.AGENT_EVENTS_RUN, owner: env.AGENT_EVENTS_OWNER || '', dir: env.AGENT_EVENTS_DIR }) + '\\n');
fs.copyFileSync(ev, path.join(cwd, 'snap' + n + '-events.jsonl'));
const f = ${JSON.stringify(state)}; const s = JSON.parse(fs.readFileSync(f, 'utf8'));
// the harness reports its steps itself (deliver SKILL.md): Report-Progress.ps1, nested in the loop's run
const report = (nr, step, result, pr) => require('child_process').execFileSync('pwsh', ['-NoProfile', '-File', ${JSON.stringify(REPORT_PROGRESS)}, '-Type', 'step.finished', '-Issue', String(nr), '-Step', step, '-Result', result, ...(pr ? ['-Pr', pr] : [])]);
if (n === 1) {
  require('child_process').execFileSync('pwsh', ['-NoProfile', '-File', ${JSON.stringify(REPORT_PROGRESS)}, '-Type', 'run.started', '-Source', 'session']);
  report(10, 'pr', 'opened #55', '${BASE}/pull/55');
  require('child_process').execFileSync('pwsh', ['-NoProfile', '-File', ${JSON.stringify(REPORT_PROGRESS)}, '-Type', 'attention', '-Issue', '10', '-Kind', 'pr_opened', '-Reason', 'opened #55', '-Pr', '${BASE}/pull/55']);
  s.issues[10].state = 'closed';
} else {
  report(11, 'review', 'clean', '');
  s.issues[11].labels = ['pbi', 'needs-refinement'];
}
fs.writeFileSync(f, JSON.stringify(s));`,
      );
      fs.writeFileSync(path.join(gh.bin, 'claude'), `#!/bin/sh\nnode ${cwd}/harness.js\n`, {
        mode: 0o755,
      });
      fs.writeFileSync(path.join(gh.bin, 'osascript'), '#!/bin/sh\ntrue\n', { mode: 0o755 });
      return gh;
    };
    const run = (gh: ReturnType<typeof createFakeGh>) =>
      loop.run(['-Milestone', 'M4', '-Model', 'sonnet'], {
        cwd,
        env: {
          ...gh.env(),
          HERDR_ENV: '',
          POIMEN_SOCKET: '',
          DELIVER_TERMINAL_BACKEND: '',
          NO_COLOR: '1',
          AGENT_EVENTS_RUN: 'stale-run-of-the-shell',
          AGENT_EVENTS_OWNER: '1',
        },
      });
    const eventFile = () => {
      const files = fs.readdirSync(path.join(cwd, '.agents/events'));
      expect(files).toHaveLength(1);
      return path.join(cwd, '.agents/events', files[0]);
    };
    const events = (file: string) =>
      fs
        .readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
    const project = async (file: string, pidCheck = false) => {
      const r = await reducer.run(['-Path', file, ...(pidCheck ? [] : ['-NoPidCheck'])], { cwd });
      expect(r.status).toBe(0);
      return JSON.parse(r.stdout);
    };

    // #517: a control session writes no run.started; the loop started from it (no inherited run) leaves exactly one run file
    it('leaves exactly one run file when started from a control session', async () => {
      const gh = setup();
      const r = await loop.run(['-Milestone', 'M4', '-Model', 'sonnet'], {
        cwd,
        env: {
          ...gh.env(),
          HERDR_ENV: '',
          POIMEN_SOCKET: '',
          DELIVER_TERMINAL_BACKEND: '',
          NO_COLOR: '1',
          AGENT_EVENTS_RUN: '',
          AGENT_EVENTS_OWNER: '',
        },
      });
      expect(r.status).toBe(2);
      const files = fs
        .readdirSync(path.join(cwd, '.agents/events'))
        .filter((f) => f.endsWith('.jsonl'));
      expect(files).toHaveLength(1);
      expect(events(path.join(cwd, '.agents/events', files[0]))[0]).toMatchObject({
        type: 'run.started',
        deliver: { source: 'loop' },
      });
    });

    it('emits the run events, hands the run to the harness as nested and writes no status.json', async () => {
      const r = await run(setup());
      expect(r.status).toBe(2);
      const file = eventFile();
      const id = path.basename(file, '.jsonl');
      expect(id).not.toBe('stale-run-of-the-shell');
      expect(fs.existsSync(path.join(cwd, '.agents/deliver-loop', id, 'progress.jsonl'))).toBe(
        true,
      );
      // #452: every event of the run is a core event or a deliver profile type, valid against both schemas
      expect(checkRunFile(fs.readFileSync(file, 'utf8'), { known: true, deliver: true })).toEqual(
        [],
      );
      const all = events(file);
      expect(all.map((e) => e.type)).toEqual([
        'run.started',
        'progress',
        'attention', // #12 needs-decision
        'deliver.iteration',
        'task.started',
        'step.finished', // the nested run.started of the harness is not written
        'attention', // pr_opened
        'task.finished', // #10 delivered
        'progress',
        'deliver.iteration',
        'task.started',
        'step.finished',
        'task.finished', // #11 blocked, from the GitHub state; the status block lists it with the same reason
        'progress',
        'run.finished',
      ]);
      expect(all[0]).toMatchObject({
        profiles: ['deliver@1'],
        agent: { harness: 'claude', model: 'sonnet' },
        host: { 'jsonl-file.pid': expect.stringMatching(/^\d+$/) },
        subject: {
          kind: 'github.milestone',
          id: 'M4 Status',
          title: 'M4 Status',
          url: `${BASE}/milestone/4`,
        },
        deliver: { source: 'loop', repository: 'acme/app', milestone: { key: 'M4' } },
      });
      expect(all.filter((e) => e.type === 'progress')).toMatchObject([
        { done: 1, total: 4, label: 'PBIs' },
        { done: 2, total: 4 },
        { done: 2, total: 4 },
      ]);
      expect(all.filter((e) => e.type === 'deliver.iteration').map((e) => e.deliver)).toEqual([
        { n: 1, max: 2, issue: 10 },
        { n: 2, max: 2, issue: 11 },
      ]);
      expect(all.filter((e) => e.type === 'task.started')[0]).toMatchObject({
        task: 'issue-10',
        subject: {
          kind: 'github.issue',
          id: 'acme/app#10',
          title: 'first',
          url: `${BASE}/issues/10`,
        },
      });
      expect(all.filter((e) => e.type === 'task.finished')).toMatchObject([
        {
          task: 'issue-10',
          outcome: 'succeeded',
          links: [{ rel: 'pull-request', url: `${BASE}/pull/55` }],
        },
        {
          task: 'issue-11',
          outcome: 'skipped',
          reason: 'deliver.blocked',
          text: 'needs refinement',
        },
      ]);
      expect(all.filter((e) => e.type === 'run.finished')).toEqual([
        expect.objectContaining({ outcome: 'failed', deliver: { result: 'blocked' } }),
      ]);
      // the harness gets the run and the events directory, but not the owner marker (nested: its events skip the sink)
      const envs = fs
        .readFileSync(path.join(cwd, 'harness-env.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      expect(envs).toEqual([
        { run: id, owner: '', dir: path.dirname(file) },
        { run: id, owner: '', dir: path.dirname(file) },
      ]);

      // the loop writes no status.json; the state is the projection of the event file
      expect(fs.existsSync(path.join(cwd, '.agents/deliver-loop/status.json'))).toBe(false);
      // iteration 1 start: the projection of the events at that time is running, #10 is the open task (displays read
      // the core: subject of the run, open task, progress)
      const snap1 = await project(path.join(cwd, 'snap1-events.jsonl'));
      valid(snap1);
      expect(snap1).toMatchObject({
        status: 'running',
        subject: { title: 'M4 Status' },
        progress: { done: 1, total: 4 },
        tasks: [{ task: 'issue-10', subject: { title: 'first' } }],
        needsYou: true,
        deliver: { result: 'running', iteration: { n: 1, max: 2 } },
      });
      // the end
      const doc = await project(file, true);
      valid(doc);
      expect(doc).toMatchObject({
        run: id,
        status: 'finished',
        outcome: 'failed',
        tasks: [],
        deliver: {
          result: 'blocked',
          delivered: [{ pbi: 10, url: `${BASE}/issues/10`, prUrl: `${BASE}/pull/55` }],
          blocked: [{ number: 11, url: `${BASE}/issues/11`, reason: 'needs refinement' }],
          needsYou: [
            { number: 12, url: `${BASE}/issues/12`, reason: expect.stringContaining('decision') },
          ],
        },
      });
    });

    it('an error after run.started still ends the run with exactly one run.finished', async () => {
      const r = await run(setup({ failOpenRead: true }));
      expect(r.status).not.toBe(0);
      const all = events(eventFile());
      expect(all[0].type).toBe('run.started');
      expect(all.filter((e) => e.type === 'run.finished')).toHaveLength(1);
      expect(all.at(-1)).toMatchObject({
        type: 'run.finished',
        deliver: { result: 'no progress' },
      });
      expect(
        checkRunFile(fs.readFileSync(eventFile(), 'utf8'), { known: true, deliver: true }),
      ).toEqual([]);
      const doc = await project(eventFile(), true);
      valid(doc);
      expect(doc.deliver.result).toBe('no progress');
    });
  },
);
