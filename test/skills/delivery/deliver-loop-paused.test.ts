import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

// #346: a PBI that only turns needs-decision (unattended pause) stays open: paused, never delivered.
// Own file: deliver-loop.test.ts and deliver-loop-status.test.ts are at their time budget.
const ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(ROOT, 'skills/delivery/deliver/scripts/Invoke-DeliverLoop.ps1');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'Invoke-DeliverLoop.ps1 paused PBI',
  () => {
    let dir: string;
    let worker: PwshWorker;
    beforeAll(() => {
      dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'loop-paused-')));
      worker = new PwshWorker(SCRIPT);
    });
    afterAll(() => {
      worker.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('a PBI that turns needs-decision is in paused[], not in delivered[] or the iteration-end record', async () => {
      const state = path.join(dir, 'state.json');
      fs.writeFileSync(state, JSON.stringify({ labels: ['pbi'] }));
      const gh = createFakeGh(
        dir,
        `(call) => {
        const fs = require('fs');
        const s = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
        const a = call.args[1] || '';
        const row = { number: 10, title: 'the work', state: 'open', closed_at: null, body: '', labels: s.labels.map((name) => ({ name })), assignees: [], issue_dependencies_summary: { blocked_by: 0 } };
        if (/\\/milestones\\?/.test(a)) return { rest: [[{ number: 4, title: 'M4 Status', state: 'open', html_url: 'https://github.com/acme/app/milestone/4' }]] };
        if (/issues\\?milestone=4&state=(open|all)/.test(a)) return { rest: [[row]] };
        if (/issues\\?milestone=4&state=closed/.test(a)) return { rest: [[]] };
        if (/dependencies\\/blocked_by/.test(a)) return { rest: [[]] };
        throw new Error('unexpected gh ' + call.args.join(' '));
      }`,
      );
      fs.writeFileSync(
        path.join(dir, 'effect.js'),
        `const fs = require('fs'); fs.writeFileSync(${JSON.stringify(state)}, JSON.stringify({ labels: ['pbi', 'needs-decision'] }));`,
      );
      fs.writeFileSync(
        path.join(dir, 'stream.jsonl'),
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: '#10 paused: needs a decision' }] },
        }) + '\n',
      );
      const stub = (name: string, body: string) =>
        fs.writeFileSync(path.join(gh.bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
      stub('claude', `cat ${dir}/stream.jsonl\nnode ${dir}/effect.js`);
      stub('herdr', 'true');
      stub('osascript', 'true');

      const r = await worker.run(['-Milestone', 'M4', '-Model', 'sonnet'], {
        cwd: dir,
        env: { ...gh.env(), HERDR_ENV: '', POIMEN_SOCKET: '', NO_COLOR: '1' },
      });
      expect(r.status).toBe(2);
      const logDir = path.join(dir, '.agents/deliver-loop');
      expect(fs.existsSync(path.join(logDir, 'status.json'))).toBe(false);
      // the state is the projection of the run's event file
      const eventsDir = path.join(dir, '.agents/events');
      const [eventFile] = fs.readdirSync(eventsDir);
      const reduced = spawnSync(
        'pwsh',
        [
          '-NoProfile',
          '-File',
          path.join(path.dirname(SCRIPT), 'ConvertFrom-ProgressEvents.ps1'),
          '-Path',
          path.join(eventsDir, eventFile),
          '-NoPidCheck',
        ],
        { encoding: 'utf8' },
      );
      const doc = JSON.parse(reduced.stdout);
      expect(doc.delivered).toEqual([]);
      expect(doc.paused).toMatchObject([{ number: 10 }]);
      expect(r.stdout).not.toContain('loop: delivered');
      const all = fs
        .readdirSync(logDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => fs.readFileSync(path.join(logDir, f), 'utf8'))
        .join('\n');
      expect(all).not.toMatch(/"delivered":"10"/);
    });
  },
);
