import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';

const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Invoke-RefineSet.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

// #675: deliver-loop refine checks a set in one session and applies the result
describe.skipIf(!hasPwsh || process.platform === 'win32')('Invoke-RefineSet.ps1', () => {
  let tmp: string;
  beforeAll(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'refine-')));
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const issues = `{
    1: { state: 'open', labels: ['pbi'], html_url: 'https://github.com/o/r/issues/1' },
    2: { state: 'open', labels: ['pbi'], html_url: 'https://github.com/o/r/issues/2' },
    3: { state: 'open', labels: ['bug'], html_url: 'https://github.com/o/r/issues/3' },
    4: { state: 'closed', labels: ['pbi'], html_url: 'https://github.com/o/r/issues/4' },
    9: { state: 'open', labels: ['feature'], html_url: 'https://github.com/o/r/issues/9' },
  }`;
  const handler = `(call) => {
    const a = call.args;
    const issues = ${issues};
    const m = /issues\\/(\\d+)(\\/sub_issues)?/.exec(a[1] || '');
    if (a[0] === 'api' && m && m[2]) return { rest: [{ number: 1 }, { number: 2 }] };
    if (a[0] === 'api' && m) { const i = issues[m[1]]; return { rest: { state: i.state, html_url: i.html_url, labels: i.labels.map((n) => ({ name: n })) } }; }
    return { rest: '' };
  }`;

  const mk = (name: string, result: unknown | null, exit = 0) => {
    const dir = path.join(tmp, name);
    fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
    const gh = createFakeGh(dir, handler);
    // claude stub: records argv, writes the result file named after --result
    fs.writeFileSync(
      path.join(gh.bin, 'claude'),
      `#!/bin/sh\necho "$*" >> "${dir}/claude-calls.txt"\n` +
        `f=$(echo "$2" | sed 's/.*--result //')\n` +
        (result === null
          ? ''
          : `mkdir -p "$(dirname "$f")"\ncat > "$f" <<'JSON'\n${JSON.stringify(result)}\nJSON\n`) +
        `exit ${exit}\n`,
      { mode: 0o755 },
    );
    const run = (args: string[]) => {
      const r = spawnSync('pwsh', ['-NoProfile', '-File', SCRIPT, ...args], {
        cwd: dir,
        env: gh.env(),
        encoding: 'utf8',
      });
      return { ...r, gh, dir };
    };
    return { run, gh, dir };
  };
  const writes = (gh: ReturnType<typeof createFakeGh>) =>
    gh
      .calls()
      .map((c) => c.args)
      .filter((a) => a[0] === 'issue' && a[1] !== 'view');

  it('one session for the set; labels and comments only the PBIs with questions', () => {
    const t = mk('ok', {
      items: [
        { number: 1, ready: true, questions: [] },
        { number: 2, ready: false, questions: ['Which format?', 'Keep the old flag?'] },
        { number: 3, ready: true, questions: [] },
      ],
    });
    const r = t.run(['-Target', '9,3,4']);
    expect(r.status).toBe(0);
    const calls = fs.readFileSync(path.join(t.dir, 'claude-calls.txt'), 'utf8').trim().split('\n');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^-p \/planner refine --check 1,2,3 --result /);
    expect(r.stdout).toContain('refine: 2 ready, 1 with open questions or no result');
    expect(r.stdout).toContain('ready: #1 https://github.com/o/r/issues/1');
    expect(r.stdout).toContain('open questions: #2 https://github.com/o/r/issues/2');
    expect(r.stdout).toContain('  - Which format?');
    const w = writes(t.gh);
    expect(w.filter((a) => a[1] === 'edit')).toEqual([
      ['issue', 'edit', '2', '--add-label', 'needs-refinement'],
    ]);
    expect(w.filter((a) => a[1] === 'comment').map((a) => a[2])).toEqual(['2']);
    const list = fs
      .readdirSync(path.join(t.dir, '.agents/deliver-loop/refine'))
      .find((f) => f.startsWith('2'));
    const saved = JSON.parse(
      fs.readFileSync(path.join(t.dir, '.agents/deliver-loop/refine', list!), 'utf8'),
    );
    expect(saved.map((e: any) => e.status)).toEqual(['ready', 'open questions', 'ready']);
  });

  it('without a usable result nothing is changed and the exit code is 1', () => {
    const t = mk('none', null, 1);
    const r = t.run(['-Target', '1,2']);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('nothing was changed');
    expect(writes(t.gh)).toEqual([]);
  });

  it('dry run starts no session; an empty set and bad arguments are errors', () => {
    const t = mk('dry', null);
    const d = t.run(['-Target', '1,2', '-DryRun']);
    expect(d.status).toBe(0);
    expect(d.stdout).toContain('dry run: claude -p /planner refine --check 1,2');
    expect(fs.existsSync(path.join(t.dir, 'claude-calls.txt'))).toBe(false);
    expect(t.run(['-Target', '4']).status).toBe(2);
    expect(t.run([]).status).toBe(64);
    expect(t.run(['-Target', '1', '-Harness', 'x']).status).toBe(64);
  });
});
