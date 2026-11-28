#!/usr/bin/env node
// Gate `app-token <repo> --out <file>` (references/gates.md): mints an installation token of the GitHub App for one
// repository and writes it to a file only its owner reads. The token is never part of the result. The loop mints
// through `appMint`. Settings come from the environment only, never from a file of the checkout.
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  type AppSettings,
  type AppToken,
  MintError,
  appSettings,
  mintToken,
} from '../app-token.mts';
import { type GateResult, UsageError, gateMain } from './result.mts';

const USAGE = 'app-token <owner>/<name> --out <file>';

/** `token`: set on `pass`; it is not printed. */
export type AppTokenResult = GateResult & { token?: AppToken };

/** `retry`: a 5xx or a rate limit of the mint call. `fail`: every other failure, a 401 or 404 included. */
export async function appToken(
  settings: AppSettings,
  repo: string,
  mint: typeof mintToken = mintToken,
): Promise<AppTokenResult> {
  let token: AppToken;
  try {
    token = await mint(settings, repo);
  } catch (error) {
    const status = error instanceof MintError ? error.status : undefined;
    const again = error instanceof MintError && (error.rateLimited || error.status >= 500);
    return {
      result: again ? 'retry' : 'fail',
      reason: (error as Error).message,
      evidence: { repo, ...(status !== undefined && { status }) },
    };
  }
  const expires = new Date(token.expiresAt);
  if (!token.token || Number.isNaN(expires.getTime()))
    return { result: 'fail', reason: 'GitHub gave no usable token', evidence: { repo } };
  return {
    result: 'pass',
    reason: 'token minted',
    evidence: { repo, expiresAt: expires.toISOString() },
    token,
  };
}

/** `appToken` as the mint of a token source (`tokenSource`, `tokenSources`): every other word than `pass` throws. */
export const appMint: typeof mintToken = async (settings, repo, apiUrl) => {
  const result = await appToken(settings, repo, (own, name) => mintToken(own, name, apiUrl));
  if (!result.token) throw new Error(result.reason);
  return result.token;
};

/** The nearest directory at or above `directory` that holds `.git` (a checkout or a worktree). */
function checkoutOf(directory: string): string | undefined {
  if (existsSync(path.join(directory, '.git'))) return directory;
  const parent = path.dirname(directory);
  return parent === directory ? undefined : checkoutOf(parent);
}

const isInside = (root: string, file: string): boolean => {
  const rel = path.relative(root, file);
  return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`);
};

const realIfThere = (file: string): string => {
  try {
    return realpathSync.native(file);
  } catch {
    return file;
  }
};

/** The absolute key file. One inside the checkout of `cwd` is refused: the reviewed change could supply it. */
function keyFileOutside(keyFile: string, cwd: string): string {
  const file = path.resolve(cwd, keyFile);
  const root = checkoutOf(realpathSync.native(cwd));
  const named = path.join(realIfThere(path.dirname(file)), path.basename(file));
  if (root && (isInside(root, named) || isInside(root, realIfThere(file))))
    throw new UsageError('DELIVER_APP_KEY_FILE must not be inside the repository');
  return file;
}

/** The path the token goes to: in an existing directory outside every git checkout, new or a file to replace. */
function outFile(out: string, cwd: string): string {
  const named = path.resolve(cwd, out);
  let directory: string;
  try {
    directory = realpathSync.native(path.dirname(named));
  } catch {
    throw new UsageError('the directory of --out does not exist');
  }
  if (checkoutOf(directory)) throw new UsageError('--out must not be inside a git checkout');
  const file = path.join(directory, path.basename(named));
  const found = lstatSync(file, { throwIfNoEntry: false });
  if (found && !found.isFile() && !found.isSymbolicLink())
    throw new UsageError('--out must name a file');
  return file;
}

// A new file renamed over the target: a link there is replaced, not followed, and an older mode is not kept.
function writeSecret(file: string, content: string): void {
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
    chmodSync(temporary, 0o600);
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** The CLI: checks the arguments and the settings before the mint, writes the token of a `pass` to `--out`. */
export async function appTokenCommand(
  args: string[],
  { env = process.env, cwd = process.cwd() }: { env?: NodeJS.ProcessEnv; cwd?: string } = {},
): Promise<GateResult> {
  const { values, positionals } = parseArgs({
    args,
    options: { out: { type: 'string' } },
    allowPositionals: true,
  });
  const [repo, ...rest] = positionals;
  if (!repo || rest.length || !values.out || !/^[\w-]+\/(?!\.{1,2}$)[\w.-]+$/.test(repo))
    throw new UsageError(USAGE);
  let settings: AppSettings | undefined;
  try {
    settings = appSettings(env);
  } catch (error) {
    throw new UsageError(`github app: ${(error as Error).message}`);
  }
  if (!settings)
    throw new UsageError(
      'github app: set DELIVER_APP_ID with DELIVER_APP_KEY_FILE or DELIVER_APP_KEY_COMMAND',
    );
  if (settings.keyFile) settings.keyFile = keyFileOutside(settings.keyFile, cwd);
  const file = outFile(values.out, cwd);
  const { token, ...result } = await appToken(
    // the key command starts in the home directory: it finds no script or tool config of a checkout
    { ...settings, commandDir: os.homedir() },
    repo,
    (own, name) => mintToken(own, name, env.DELIVER_APP_API_URL),
  );
  if (token) writeSecret(file, token.token);
  return result;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await gateMain(appTokenCommand);
}
