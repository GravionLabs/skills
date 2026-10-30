import * as fs from 'fs';
import * as os from 'os';

/** Optional ISO-8601 UTC prefix of a ledger line (`2026-10-21T15:19:46Z `). */
export const TS_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z /;

/** Reads a file and drops the optional timestamp prefix of every line, so format-agnostic assertions stay readable. */
export const readLedger = (file: string): string =>
  fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.replace(TS_PREFIX, ''))
    .join('\n');

/** Env without inherited GIT_* (e.g. GIT_DIR when run from a git hook) and without user/system git config. */
export const gitCleanEnv = (
  base: NodeJS.ProcessEnv,
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv => {
  const env = { ...base };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  return { ...env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_SYSTEM: os.devNull, ...extra };
};
