// The two helpers of the agent-events jsonl-file binding (the loop's TypeScript, Get-PublishState's PowerShell)
// against the same cases: test/fixtures/agent-events (`directory/` is a copy of the tag in VERSION).
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');
const { eventsDirectory, expiredRuns, pruneRuns, repoOfUrl, runOrigin } = (await import(
  path.join(root, 'skills/delivery/deliver/scripts/event-dir.mts')
)) as typeof import('../../../skills/delivery/deliver/scripts/event-dir.mts');
const psm = path.join(root, 'skills/github/github-release/scripts/EventDirectory.psm1');
const fixtures = path.join(root, 'test/fixtures/agent-events');

type Location = {
  directory: {
    name: string;
    windows: boolean;
    env: Record<string, string>;
    expected: string[] | null;
  }[];
  repository: { url: string; repo: string | null }[];
};
const cases = JSON.parse(fs.readFileSync(path.join(fixtures, 'location.json'), 'utf8')) as Location;
type Expected = {
  now: string;
  files: Record<string, { mtime: string }>;
  writer: { repo?: string };
  mayDelete: string[];
};

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'event-dir-')));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.test', ...args], {
    cwd,
    stdio: 'ignore',
  });

// a run file: finished or not, of a repository (`null`: no origin), `days` old
function writeRun(dir: string, name: string, repo: string | null, days: number, extra = {}) {
  const started = {
    type: 'run.started',
    ...(repo === null ? {} : { origin: { repo } }),
    ...extra,
  };
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.jsonl`);
  fs.writeFileSync(file, `${JSON.stringify(started)}\n{"type":"run.finished"}\n`);
  const at = new Date(Date.now() - days * 86_400_000);
  fs.utimesSync(file, at, at);
  return file;
}

// the retention case of the binding with its modification times, and a directory above the cap
const retention = path.join(tmp, 'retention');
const expected = JSON.parse(
  fs.readFileSync(path.join(fixtures, 'directory/retention-per-repository/expected.json'), 'utf8'),
) as Expected;
fs.cpSync(path.join(fixtures, 'directory/retention-per-repository/shared'), retention, {
  recursive: true,
});
for (const [file, { mtime }] of Object.entries(expected.files)) {
  const at = new Date(mtime);
  fs.utimesSync(path.join(retention, path.basename(file)), at, at);
}
const mayDelete = expected.mayDelete.map((file) => path.basename(file));

const capped = path.join(tmp, 'capped');
for (let i = 0; i < 102; i++) {
  const n = String(i).padStart(3, '0');
  writeRun(capped, `a-${n}`, 'a', (200 - i) / 1000);
  writeRun(capped, `b-${n}`, 'b', 1);
}
// a quiet run whose writer lives is deleted only by the age of the file; a dead writer ends a recent one
const writers = path.join(tmp, 'writers');
const unfinished = (name: string, pid: number, host: string) => {
  const file = path.join(writers, `${name}.jsonl`);
  fs.mkdirSync(writers, { recursive: true });
  const event = {
    type: 'run.started',
    origin: { repo: 'a', host },
    host: { 'jsonl-file.pid': String(pid) },
  };
  fs.writeFileSync(file, `${JSON.stringify(event)}\n`);
};
for (let i = 0; i < 100; i++) writeRun(writers, `done-${i}`, 'a', 0);
unfinished('dead', 2 ** 22 + 1, os.hostname());
unfinished('alive', process.pid, os.hostname());
unfinished('elsewhere', 2 ** 22 + 1, 'another-host');

const plain = path.join(tmp, 'plain');
fs.mkdirSync(plain);
const local = path.join(tmp, 'local');
fs.mkdirSync(local);
git(local, 'init', '-q', '-b', 'main');
git(local, 'commit', '-q', '--allow-empty', '-m', 'init');
const linked = path.join(tmp, 'linked');
git(local, 'worktree', 'add', '-q', '--detach', linked);
const remote = path.join(tmp, 'remote');
fs.mkdirSync(remote);
git(remote, 'init', '-q', '-b', 'feat/x');
git(remote, 'remote', 'add', 'origin', 'git@github.com:example/a.git');
const places = [plain, local, linked, remote];
const host = os.hostname();
const origins = [
  { host },
  { repo: local, branch: 'main', worktree: local, host },
  { repo: local, worktree: linked, host },
  { repo: 'example/a', branch: 'feat/x', worktree: remote, host },
];

const legacy = path.join(local, '.git/.agents/events');
const kept = writeRun(legacy, 'old', null, 40);

const names = (files: string[]) => files.map((f) => path.basename(f)).sort();

describe('event-dir.mts', () => {
  it.each(cases.directory)('directory: $name', ({ windows, env, expected: parts }) => {
    expect(eventsDirectory(env, windows ? 'win32' : 'linux', '/home/dev')).toBe(
      parts ? path.resolve(...parts) : undefined,
    );
  });

  it.each(cases.repository)('repository of $url', ({ url, repo }) => {
    expect(repoOfUrl(url) ?? null).toBe(repo);
  });

  it('names the origin, without the fields that do not exist', () => {
    expect(places.map((place) => runOrigin(place))).toEqual(origins);
  });

  it('may delete exactly the files of the retention case', () => {
    const files = expiredRuns(retention, expected.writer.repo, Date.parse(expected.now));
    expect(names(files)).toEqual(mayDelete);
  });

  it('keeps 100 runs per repository, whatever others hold', () => {
    expect(names(expiredRuns(capped, 'a'))).toEqual(['a-000.jsonl', 'a-001.jsonl']);
  });

  it('counts a run of a dead writer as abandoned, never one of a live writer or another host', () => {
    expect(expiredRuns(writers, 'a')).toHaveLength(1);
  });

  it('deletes nothing in the legacy directory', () => {
    pruneRuns(legacy, local, local);
    expect(fs.existsSync(kept)).toBe(true);
  });
});

describe('EventDirectory.psm1', () => {
  // one pwsh for every case: a start per case costs more than the cases
  let out: {
    directory: (string | null)[];
    repository: (string | null)[];
    origins: object[];
    retention: string[];
    capped: string[];
    writers: string[];
  };
  beforeAll(() => {
    const input = path.join(tmp, 'input.json');
    fs.writeFileSync(
      input,
      JSON.stringify({ ...cases, places, retention, expected, capped, writers, legacy, local }),
    );
    const script = `
$ErrorActionPreference = 'Stop'
Import-Module $env:PSM
$in = Get-Content -Raw $env:INPUT_FILE | ConvertFrom-Json -AsHashtable -DateKind Utc
$directory = foreach ($c in $in.directory) {
  foreach ($k in 'AGENT_EVENTS_DIR', 'XDG_STATE_HOME', 'LOCALAPPDATA') { Set-Item "env:$k" $c.env[$k] }
  Get-AgentEventsDirectory -Windows $c.windows -HomeDirectory '/home/dev'
}
$repository = foreach ($c in $in.repository) { ,(Get-RepositoryOfUrl $c.url) }
$origins = foreach ($p in $in.places) { Set-Location $p; Get-RunOrigin }
$retention = @(Get-ExpiredRun -Directory $in.retention -Repository $in.expected.writer.repo -Now ([datetime]$in.expected.now))
$capped = @(Get-ExpiredRun -Directory $in.capped -Repository a)
$writers = @(Get-ExpiredRun -Directory $in.writers -Repository a)
Set-Location $in.local
Remove-ExpiredRun -Directory $in.legacy -Repository $in.local
@{ directory = @($directory); repository = @($repository); origins = @($origins); retention = $retention; capped = $capped; writers = $writers } | ConvertTo-Json -Depth 4`;
    out = JSON.parse(
      execFileSync('pwsh', ['-NoProfile', '-Command', script], {
        encoding: 'utf8',
        env: { ...process.env, PSM: psm, INPUT_FILE: input },
      }),
    );
  });

  it('resolves the same directories', () => {
    expect(out.directory).toEqual(
      cases.directory.map((c) => (c.expected ? path.resolve(...c.expected) : null)),
    );
  });

  it('reads the same repositories from URLs', () => {
    expect(out.repository).toEqual(cases.repository.map((c) => c.repo));
  });

  it('names the same origin', () => {
    expect(out.origins).toEqual(origins);
  });

  it('may delete the same files', () => {
    expect(names(out.retention)).toEqual(mayDelete);
    expect(names(out.capped)).toEqual(['a-000.jsonl', 'a-001.jsonl']);
    expect(out.writers).toHaveLength(1);
  });

  it('deletes nothing in the legacy directory', () => {
    expect(fs.existsSync(kept)).toBe(true);
  });
});
