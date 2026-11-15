// DELIVER_HOST selects a host module under hosts/; unset means `process`; an unknown name exits 64.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { LoopHost } from './host.ts';

export class UnknownHostError extends Error {
  readonly exitCode = 64;
  constructor(name: string) {
    super(`unknown DELIVER_HOST '${name}'`);
  }
}

const HOSTS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'hosts');

export async function selectHost(
  env: Record<string, string | undefined> = process.env,
  hostsDir = HOSTS_DIR,
): Promise<LoopHost> {
  const name = env.DELIVER_HOST || 'process';
  const file = join(hostsDir, `${name}.ts`);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name) || !existsSync(file))
    throw new UnknownHostError(name);
  const mod = await import(pathToFileURL(file).href);
  if (typeof mod.createHost !== 'function') throw new UnknownHostError(name);
  return mod.createHost() as LoopHost;
}

/** For the entry point: the host, or a message on stderr and exit code 64. */
export async function selectHostOrExit(
  env: Record<string, string | undefined> = process.env,
): Promise<LoopHost> {
  try {
    return await selectHost(env);
  } catch (e) {
    if (e instanceof UnknownHostError) {
      console.error(e.message);
      process.exit(e.exitCode);
    }
    throw e;
  }
}
