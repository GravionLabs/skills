import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const hermetic = (home: string): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  for (const k of Object.keys(env))
    if (k.startsWith('GIT_') || k === 'XDG_CONFIG_HOME') delete env[k];
  return { ...env, HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
};

// Registers beforeAll/afterAll that build the release-branch history and returns accessors (valid inside tests).
export function useReleaseFixture() {
  let tmp: string;
  let work: string; // the history, source of every origin ref
  let origin: string; // bare remote
  let clone: string; // working clone with `origin`
  let env: NodeJS.ProcessEnv;

  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd,
      encoding: 'utf8',
      env,
    });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout.trim();
  };
  const commit = (cwd: string, name: string) => {
    fs.writeFileSync(path.join(cwd, `${name}.txt`), name);
    git(cwd, 'add', `${name}.txt`);
    git(cwd, 'commit', '-q', '-m', name);
  };
  const bash = (cwd: string, script: string) => {
    const r = spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8', env });
    expect(r.stderr).toBe('');
    return { out: r.stdout.trim(), status: r.status };
  };
  const dropRef = (ref: string) => git(origin, 'update-ref', '-d', ref);
  // origin heads are reset from `work` before every resolver case, so the cases are independent
  const resetHeads = () => git(origin, 'fetch', '-q', work, '+refs/heads/*:refs/heads/*');

  // History: main A ─ M1 (merge of release/2.1 = B, tag v2.1.0) ─ H (hotfix, tag v2.1.1) ─ M2 (merge of release/next = D, tag v2.3.0)
  //          release/2.2 = C from M1, release/legacy = A, release/2.1 continued with E, release/next continued with F,
  //          fresh = G from M2 (cut after the release), release/9.0 = A with tag v9.0.0 (released, sorts above 2.2)
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-guards-'));
    env = hermetic(tmp);
    work = path.join(tmp, 'work');
    fs.mkdirSync(work);
    git(work, 'init', '-q', '-b', 'main');
    commit(work, 'A');
    git(work, 'checkout', '-q', '-b', 'release/2.1');
    commit(work, 'B');
    git(work, 'checkout', '-q', 'main');
    git(work, 'merge', '-q', '--no-ff', '-m', 'release: 2.1', 'release/2.1');
    git(work, 'tag', '-a', '-m', 'v2.1.0', 'v2.1.0');
    git(work, 'checkout', '-q', '-b', 'release/2.2');
    commit(work, 'C');
    git(work, 'checkout', '-q', '-b', 'release/next', 'main');
    commit(work, 'D');
    git(work, 'branch', '-q', 'release/legacy', 'main~1');
    git(work, 'branch', '-q', 'release/9.0', 'main~1'); // released line sorting above 2.2, tag v9.0.0 on origin
    git(work, 'tag', 'v9.0.0', 'main~1');
    git(work, 'checkout', '-q', 'main');
    commit(work, 'H');
    git(work, 'tag', 'v2.1.1');
    git(work, 'checkout', '-q', 'release/2.1');
    commit(work, 'E');
    git(work, 'checkout', '-q', 'main');
    git(work, 'merge', '-q', '--no-ff', '-m', 'release: release/next', 'release/next');
    git(work, 'tag', '-a', '-m', 'v2.3.0', 'v2.3.0');
    git(work, 'checkout', '-q', '-b', 'fresh');
    commit(work, 'G');
    git(work, 'checkout', '-q', 'release/next');
    commit(work, 'F');
    git(work, 'checkout', '-q', 'main');
    origin = path.join(tmp, 'origin.git');
    git(tmp, 'clone', '-q', '--bare', work, origin);
    clone = path.join(tmp, 'clone');
    git(tmp, 'clone', '-q', origin, clone);
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
  return {
    get tmp() {
      return tmp;
    },
    get work() {
      return work;
    },
    get origin() {
      return origin;
    },
    get clone() {
      return clone;
    },
    get env() {
      return env;
    },
    git,
    commit,
    bash,
    dropRef,
    resetHeads,
  };
}
