import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  appMint,
  appTokenCommand,
} from '../../../skills/delivery/deliver/scripts/gates/app-token.mts';
import { gateMain, readResult } from '../../../skills/delivery/deliver/scripts/gates/result.mts';

const gate = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/gates/app-token.mts',
);
const SECRET = 'ghs_secretTokenValue';
const EXPIRES = '2030-01-01T10:00:00.000Z';

let dir: string;
let repo: string;
let outDir: string;
let key: string;
let env: NodeJS.ProcessEnv;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'gate-app-token-'));
  repo = path.join(dir, 'repo');
  outDir = path.join(dir, 'out');
  mkdirSync(path.join(repo, '.git'), { recursive: true });
  mkdirSync(outDir);
  key = path.join(dir, 'app.pem');
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  writeFileSync(key, privateKey);
  writeFileSync(path.join(repo, 'app.pem'), privateKey);
  env = { DELIVER_APP_ID: '4242', DELIVER_APP_KEY_FILE: key };
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllGlobals());

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const granted = json.bind(null, 201, { token: SECRET, expires_at: EXPIRES });

/** Stubs `fetch`: the installation lookup, then the answer of the token call. */
function stubFetch(created: () => Response = granted, installation = () => json(200, { id: 5 })) {
  const fetch = vi.fn<(url: string) => Promise<Response>>(async (url) =>
    url.endsWith('/installation') ? installation() : created(),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

/** Runs the gate in-process as its CLI does and returns the printed line and the exit code. */
async function run(args: string[], own: NodeJS.ProcessEnv = env, cwd = repo) {
  let stdout = '';
  const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  const before = process.exitCode;
  try {
    await gateMain((given) => appTokenCommand(given, { env: own, cwd }), args);
    return { stdout, result: readResult(stdout, Number(process.exitCode)) };
  } finally {
    process.exitCode = before;
    out.mockRestore();
  }
}

describe('app-token', () => {
  it('passes, writes the token for its owner only and never prints it', async () => {
    const fetch = stubFetch();
    const file = path.join(outDir, 'token');
    writeFileSync(file, 'old', { mode: 0o644 });
    const { stdout, result } = await run(['acme/widget', '--out', file]);
    expect(result).toEqual({
      result: 'pass',
      reason: 'token minted',
      evidence: { repo: 'acme/widget', expiresAt: EXPIRES },
    });
    expect(stdout).not.toContain(SECRET);
    expect(readFileSync(file, 'utf8')).toBe(SECRET);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(outDir)).toEqual(['token']);
    expect(fetch.mock.calls[0]![0]).toMatch(/\/repos\/acme\/widget\/installation$/);
    rmSync(file);
  });

  it.skipIf(process.platform === 'win32')('replaces a link instead of following it', async () => {
    stubFetch();
    const target = path.join(repo, 'leak');
    const file = path.join(outDir, 'link');
    writeFileSync(target, 'untouched');
    symlinkSync(target, file);
    await expect(run(['acme/widget', '--out', file])).resolves.toMatchObject({
      result: { result: 'pass' },
    });
    expect(readFileSync(target, 'utf8')).toBe('untouched');
    expect(readFileSync(file, 'utf8')).toBe(SECRET);
    rmSync(file);
  });

  it.each([
    ['retry', 'a 5xx', () => json(502, {})],
    ['retry', 'a 429', () => json(429, {})],
    ['retry', 'a spent quota', () => json(403, {}, { 'x-ratelimit-remaining': '0' })],
    ['retry', 'a secondary limit', () => json(403, { message: 'secondary rate limit' })],
    ['fail', 'a 401', () => json(401, { message: SECRET })],
    ['fail', 'a 404', () => json(404, {})],
    ['fail', 'another 403', () => json(403, { message: 'forbidden' })],
    ['fail', 'a response without a token', () => json(201, {})],
    ['fail', 'a broken response', () => new Response(`${SECRET} {`, { status: 201 })],
  ])('reports %s on %s', async (word, _name, answer) => {
    stubFetch(answer);
    const file = path.join(outDir, 'none');
    const { stdout, result } = await run(['acme/widget', '--out', file]);
    expect(result.result).toBe(word);
    expect(stdout).not.toContain(SECRET);
    expect(() => statSync(file)).toThrow('ENOENT');
  });

  it('fails an app that is not installed and names the status', async () => {
    stubFetch(granted, () => json(404, {}));
    const { result } = await run(['acme/widget', '--out', path.join(outDir, 'none')]);
    expect(result).toEqual({
      result: 'fail',
      reason: 'GitHub GET /repos/acme/widget/installation: HTTP 404',
      evidence: { repo: 'acme/widget', status: 404 },
    });
  });

  const out = () => path.join(outDir, 'token');
  it.each([
    ['no repository', () => ['--out', out()], {}],
    ['a repository without owner', () => ['widget', '--out', out()], {}],
    ['a repository that is a path', () => ['acme/..', '--out', out()], {}],
    ['no --out', () => ['acme/widget'], {}],
    ['--out in a checkout', () => ['acme/widget', '--out', 'token'], {}],
    ['--out in the git directory', () => ['acme/widget', '--out', path.join(repo, '.git/t')], {}],
    ['--out in a missing directory', () => ['acme/widget', '--out', path.join(dir, 'no/t')], {}],
    ['--out that is a directory', () => ['acme/widget', '--out', outDir], {}],
    ['no app settings', () => ['acme/widget', '--out', out()], { none: true }],
    ['no app id', () => ['acme/widget', '--out', out()], { DELIVER_APP_ID: '' }],
    ['no key', () => ['acme/widget', '--out', out()], { DELIVER_APP_KEY_FILE: '' }],
    ['a key file of the checkout', () => ['acme/widget', '--out', out()], { relative: true }],
  ])('reports usage on %s and mints nothing', async (_name, args, change) => {
    const fetch = stubFetch();
    const own =
      'none' in change
        ? {}
        : { ...env, ...('relative' in change ? { DELIVER_APP_KEY_FILE: 'app.pem' } : change) };
    await expect(run(args(), own)).resolves.toMatchObject({ result: { result: 'usage' } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('starts the key command outside the checkout', async () => {
    stubFetch();
    // the command gives the key only when it runs in the home directory
    const script = path.join(dir, 'key-command.cjs');
    writeFileSync(
      script,
      `const fs = require('node:fs');
if (fs.realpathSync(process.cwd()) !== fs.realpathSync(require('node:os').homedir())) process.exit(1);
process.stdout.write(fs.readFileSync(${JSON.stringify(key)}, 'utf8'));`,
    );
    const command = `node "${script}"`;
    const own = { DELIVER_APP_ID: '4242', DELIVER_APP_KEY_COMMAND: command };
    const file = path.join(outDir, 'command');
    await expect(run(['acme/widget', '--out', file], own)).resolves.toMatchObject({
      result: { result: 'pass' },
    });
  });

  it('gives a token source the token, or throws the reason', async () => {
    const settings = { appId: '4242', keyFile: key };
    stubFetch();
    await expect(appMint(settings, 'acme/widget')).resolves.toEqual({
      token: SECRET,
      expiresAt: Date.parse(EXPIRES),
    });
    stubFetch(() => json(500, {}));
    await expect(appMint(settings, 'acme/widget')).rejects.toThrow(
      'GitHub POST /app/installations/5/access_tokens: HTTP 500',
    );
  });

  it('prints one result and no token as a process', async () => {
    const server = createServer((request, response) => {
      const lookup = request.url!.endsWith('/installation');
      response.statusCode = lookup ? 200 : 201;
      response.end(JSON.stringify(lookup ? { id: 5 } : { token: SECRET, expires_at: EXPIRES }));
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const file = path.join(outDir, 'process');
      const child = spawn(process.execPath, [gate, 'acme/widget', '--out', file], {
        cwd: repo,
        env: {
          ...process.env,
          ...env,
          DELIVER_APP_KEY_COMMAND: '',
          DELIVER_APP_API_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => (stderr += chunk));
      const code = await new Promise<number | null>((done) => child.on('close', done));
      expect(readResult(stdout, code).result).toBe('pass');
      expect(stdout + stderr).not.toContain(SECRET);
      expect(readFileSync(file, 'utf8')).toBe(SECRET);
    } finally {
      server.close();
    }
  });
});
