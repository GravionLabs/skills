import * as fs from 'fs';
import * as path from 'path';
import { createFakeGh } from './fake-gh';
import { PwshWorker } from './pwsh-worker';

// Fixture of the merging loop tests (#481): a fake gh and claude for Invoke-DeliverLoop.ps1 over milestone M4.
export const SCRIPTS = path.resolve(__dirname, '../../skills/delivery/deliver/scripts');
export const PR = 'https://github.com/acme/app/pull/55';

// issues: PBIs of M4; blocked: issue -> open blocker (10: until closed10, else until the harness has run once);
// prs: handler source (n, mark) -> open PR list of the n-th call; the harness (claude stub) reports PBI 10 as merging in iteration 1.
export const setup = (
  root: string,
  name: string,
  issues: number[],
  blocked: Record<number, number>,
  prs: string,
) => {
  const cwd = path.join(root, name);
  fs.mkdirSync(cwd, { recursive: true });
  const gh = createFakeGh(
    cwd,
    `(call, ctx) => {
        const fs = require('fs'); const a = call.args[1] || '';
        const flag = (f) => fs.existsSync(${JSON.stringify(cwd)} + '/' + f);
        const mark = (f) => fs.writeFileSync(${JSON.stringify(cwd)} + '/' + f, '');
        const row = (n) => ({ number: n, title: 'work ' + n, state: 'open', closed_at: null, body: '', labels: [{ name: 'pbi' }], assignees: [], issue_dependencies_summary: { blocked_by: 0 } });
        const open = ${JSON.stringify(issues)}.filter((n) => !(n === 10 && flag('closed10')));
        const blocked = ${JSON.stringify(blocked)};
        if (/\\/milestones\\?/.test(a)) return { rest: [[{ number: 4, title: 'M4 Merge', state: 'open', html_url: 'https://github.com/acme/app/milestone/4' }]] };
        if (/issues\\?milestone=4&state=(open|all)/.test(a)) return { rest: [open.map(row)] };
        if (/issues\\?milestone=4&state=closed/.test(a)) return { rest: [[]] };
        let m = /issues\\/(\\d+)\\/dependencies\\/blocked_by/.exec(a);
        if (m) { const b = blocked[m[1]]; return { rest: [b && (b === 10 ? !flag('closed10') : !flag('unblock')) ? [{ number: b, state: 'open' }] : []] }; }
        if (/rules\\/branches/.test(a)) return { rest: [] };
        if (/pulls\\?base=release\\/next/.test(a)) { const n = ctx.count('pulls'); return { rest: (${prs})(n, mark) }; }
        if (/branches\\/release\\/next$/.test(a)) return { rest: { commit: { sha: 'base' } } };
        m = /commits\\/(\\w+)\\/check-runs/.exec(a);
        if (m) return { rest: { check_runs: m[1] === 'red' ? [{ name: 'test', status: 'completed', conclusion: 'failure' }] : [] } };
        m = /^repos\\/\\{owner\\}\\/\\{repo\\}\\/issues\\/(\\d+)$/.exec(a);
        if (m) { const n = Number(m[1]); const r = row(n); if (n === 10 && flag('closed10')) r.state = 'closed'; return { rest: r }; }
        if (/pulls\\/\\d+$/.test(a)) return { rest: { merged: false, mergeable: true, mergeable_state: 'clean' } };
        throw new Error('unexpected gh ' + call.args.join(' '));
      }`,
  );
  fs.writeFileSync(
    path.join(cwd, 'harness.js'),
    `const fs = require('fs'); const cp = require('child_process'); const cwd = ${JSON.stringify(cwd)};
const n = (fs.existsSync(cwd + '/n') ? Number(fs.readFileSync(cwd + '/n', 'utf8')) : 0) + 1; fs.writeFileSync(cwd + '/n', String(n));
if (n === 1) {
  cp.execFileSync('pwsh', ['-NoProfile', '-File', ${JSON.stringify(path.join(SCRIPTS, 'Report-Progress.ps1'))}, '-Type', 'issue.finished', '-Issue', '10', '-Outcome', 'merging', '-Pr', '${PR}']);
  fs.writeFileSync(cwd + '/unblock', '');
}`,
  );
  fs.writeFileSync(path.join(gh.bin, 'claude'), `#!/bin/sh\nnode ${cwd}/harness.js\n`, {
    mode: 0o755,
  });
  for (const b of ['herdr', 'osascript'])
    fs.writeFileSync(path.join(gh.bin, b), '#!/bin/sh\ntrue\n', { mode: 0o755 });
  return { cwd, gh };
};
export const run = (loop: PwshWorker, s: ReturnType<typeof setup>, max: string) =>
  loop.run(['-Milestone', 'M4', '-Model', 'sonnet', '-Max', max], {
    cwd: s.cwd,
    env: {
      ...s.gh.env(),
      HERDR_ENV: '',
      POIMEN_SOCKET: '',
      NO_COLOR: '1',
      DELIVER_MERGE_POLL_SECONDS: '0',
      AGENT_EVENTS_DIR: path.join(s.cwd, 'events'),
    },
  });
export const started = (cwd: string) => {
  const dir = path.join(cwd, 'events');
  return fs
    .readdirSync(dir)
    .flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n'))
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === 'issue.started')
    .map((e) => e.issue.number);
};
export const pr = (sha: string) =>
  `{ number: 55, html_url: '${PR}', head: { ref: 'feat/10-a', sha: '${sha}' }, auto_merge: { merge_method: 'squash' } }`;
