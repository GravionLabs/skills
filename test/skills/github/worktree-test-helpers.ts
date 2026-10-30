import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const SCRIPTS = path.resolve(__dirname, '../../../skills/github-issue/scripts');

const gitEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: '1',
});
delete process.env.DROMOS_STATE_DIR;

/** Isolated git (no user/system config, no signing, fixed identity); every call must succeed. */
export const git = (cwd: string, ...a: string[]): string => {
  const r = spawnSync(
    'git',
    ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t', ...a],
    { cwd, encoding: 'utf8', env: gitEnv() },
  );
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

export type Fixture = { root: string; repo: string; origin: string; state: string };

/** Temp repository with a bare "origin" (main pushed); `ignore` commits a .gitignore with `.worktrees/`. */
export const makeRepo = (o: { ignore?: boolean } = {}): Fixture => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-')));
  const origin = path.join(root, 'origin.git');
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  if (o.ignore !== false) fs.writeFileSync(path.join(repo, '.gitignore'), '.worktrees/\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  return { root, repo, origin, state: path.join(repo, '.git', 'agents') };
};

export const run = (
  script: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
) =>
  spawnSync('pwsh', ['-NoProfile', '-File', path.join(SCRIPTS, script), ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...gitEnv(), ...env },
  });

export const json = (r: { stdout: string }) => JSON.parse(r.stdout.trim());

/** First 16 hex of the SHA-256 of the checkout path: the lease file name. */
export const leaseKey = (checkout: string): string =>
  createHash('sha256').update(checkout, 'utf8').digest('hex').slice(0, 16);

const stamp = (d = new Date()) => d.toISOString().replace(/\.\d+Z$/, 'Z');

export type Lease = {
  path: string;
  issue: number;
  branch: string;
  host: string;
  started: string;
  heartbeat: string;
};

/** Plants a lease file; heartbeat and started default to now. */
export const plantLease = (
  state: string,
  l: Partial<Lease> & { path: string; issue: number },
): string => {
  const dir = path.join(state, 'leases');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${leaseKey(l.path)}.json`);
  const now = stamp();
  fs.writeFileSync(
    file,
    JSON.stringify({
      branch: `feat/${l.issue}`,
      host: 'other-host',
      started: now,
      heartbeat: now,
      ...l,
    }),
  );
  return file;
};

export const readLeases = (state: string): Lease[] => {
  const dir = path.join(state, 'leases');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')) as Lease);
};
