// The checkouts of an Objective run (#1041 decision 4): one bare clone per repository in `<run-root>/repos/<owner>/
// <repo>`, made on first use and fetched later. `runRepository` takes the clone as its `root`: its worktrees come from
// it and lie beside it (`<repo>-wt-<nr>`). No clone of the user is read or changed. Another host (a poimen space) is
// another `Checkouts`.

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { isRepository } from './objective.mts';

/** The directory of a repository, else why a person has to look: it concerns this repository only. */
export type Checkout = { repo: string; root: string } | { repo: string; needsYou: string };
export type Checkouts = {
  /** `repo` is `owner/name`. Never rejects: a failure is a `needsYou`. */
  checkout: (repo: string) => Promise<Checkout>;
};
export type CloneOptions = {
  runRoot: string;
  /**
   * The token of a repository. Without the function, or when it gives none, git runs with the login of the user. When
   * it throws, the checkout fails: it never falls back to the login.
   */
  token?: (repo: string) => Promise<string | undefined>;
  /** The URL to clone from. */
  url?: (repo: string) => string;
};

const execGit = promisify(execFile);

/**
 * The environment of git for a token: an authorization header for the host of the URL, in the environment only (never
 * in the arguments or the config of the clone), and no other source of credentials.
 */
export function tokenEnv(
  url: string,
  token: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const header = `http.${new URL(url).origin}/.extraheader`;
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  // an empty value drops the entries configured before it
  const entries = [
    ['credential.helper', ''],
    [header, ''],
    [header, `AUTHORIZATION: basic ${basic}`],
  ];
  const from = Number(env.GIT_CONFIG_COUNT ?? 0);
  const added: NodeJS.ProcessEnv = { GIT_CONFIG_COUNT: String(from + entries.length) };
  entries.forEach(([key, value], index) => {
    added[`GIT_CONFIG_KEY_${from + index}`] = key;
    added[`GIT_CONFIG_VALUE_${from + index}`] = value;
  });
  return { ...env, ...added, GIT_ASKPASS: '' };
}

/** What git said: its `fatal:` line, else the first line. */
const gitError = (error: unknown): string => {
  const text = String((error as { stderr?: string }).stderr || (error as Error).message || error);
  const found = text.trim().split('\n');
  return found.find((line) => line.startsWith('fatal:')) ?? found[0] ?? '';
};

/** The default `Checkouts`: plain clones below `<run-root>/repos`. */
export function cloneCheckouts({
  runRoot,
  token,
  url = (repo) => `https://github.com/${repo}.git`,
}: CloneOptions): Checkouts {
  return {
    async checkout(repo) {
      // the name becomes a path below the run root
      if (!isRepository(repo)) return { repo, needsYou: `${repo}: not a repository name` };
      const root = path.resolve(runRoot, 'repos', ...repo.split('/'));
      const cloned = existsSync(path.join(root, 'HEAD'));
      // a clone is built beside its place and moved there when complete: an interrupted one is never used
      const partial = `${root}.partial-${process.pid}`;
      try {
        const source = url(repo);
        const secret = await token?.(repo);
        const env = {
          ...(secret ? tokenEnv(source, secret) : process.env),
          // nobody answers a question
          GIT_TERMINAL_PROMPT: '0',
        };
        const git = (...args: string[]) =>
          execGit('git', args, { env, maxBuffer: 64 * 1024 * 1024 });
        if (cloned) {
          await git('-C', root, 'fetch', '--quiet', '--prune', 'origin');
        } else {
          rmSync(partial, { recursive: true, force: true });
          mkdirSync(path.dirname(root), { recursive: true });
          // not `clone --bare`: the loop reads `origin/<branch>`, and a session creates its branch itself
          await git('init', '--quiet', '--bare', partial);
          await git('-C', partial, 'remote', 'add', 'origin', source);
          await git('-C', partial, 'fetch', '--quiet', 'origin');
          renameSync(partial, root);
        }
        return { repo, root };
      } catch (error) {
        rmSync(partial, { recursive: true, force: true });
        return {
          repo,
          needsYou: `${repo}: ${cloned ? 'fetch' : 'clone'} failed: ${gitError(error)}`,
        };
      }
    },
  };
}
