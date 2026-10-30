import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../../helpers/pwsh-worker';

const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
const posix = process.platform !== 'win32';

const DIR = path.resolve(__dirname, '../../../skills/context-statusline/scripts');
const STATUS = path.join(DIR, 'statusline.mjs');
const SUB = path.join(DIR, 'subagent-statusline.mjs');
const INSTALLER = path.join(DIR, 'Install-Statusline.ps1');
// eslint-disable-next-line no-control-regex
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const run = (script: string, stdin: string, cwd?: string) =>
  spawnSync('node', [script], { input: stdin, encoding: 'utf8', cwd });

describe('statusline.mjs', () => {
  let tmp: string;
  beforeEach(() => (tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-'))));
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('renders dir, model, context and rate limits', () => {
    const r = run(
      STATUS,
      JSON.stringify({
        workspace: { current_dir: tmp },
        model: { display_name: 'Opus 4' },
        context_window: { used_percentage: 41.6 },
        rate_limits: { five_hour: { used_percentage: 12.2 }, seven_day: { used_percentage: 30 } },
      }),
    );
    expect(r.status).toBe(0);
    const out = strip(r.stdout);
    expect(out).toContain(`:${tmp} Opus 4 ctx:42%`);
    expect(out).toContain('5h:12% 7d:30%');
    expect(out).toMatch(/^[^@\s]+@[^:\s]+:/);
    expect(out).not.toContain('(');
  });

  it('is null-safe and shows no ctx part without a percentage even with a size', () => {
    const r = run(
      STATUS,
      JSON.stringify({
        workspace: { current_dir: tmp },
        model: null,
        context_window: { used_percentage: null, context_window_size: 200000 },
        rate_limits: { five_hour: null, seven_day: { used_percentage: null } },
      }),
    );
    expect(r.status).toBe(0);
    expect(strip(r.stdout)).toMatch(new RegExp(`:${tmp.replace(/[\\/]/g, '.')}$`));
  });

  it('prefers current_context_used_percentage (Copilot CLI payload, no rate limits)', () => {
    const r = run(
      STATUS,
      JSON.stringify({
        cwd: tmp,
        session_id: 's1',
        model: { id: 'gpt-5', display_name: 'GPT-5' },
        workspace: { current_dir: tmp },
        context_window: {
          used_percentage: 30,
          current_context_used_percentage: 12.4,
          context_window_size: 128000,
        },
        cost: { total_premium_requests: 3 },
      }),
    );
    const out = strip(r.stdout);
    expect(out).toContain('GPT-5 ctx:12% (16k/128k)');
    expect(out).not.toContain('5h:');
    expect(
      strip(
        run(
          STATUS,
          JSON.stringify({
            workspace: { current_dir: tmp },
            context_window: { used_percentage: 30, current_context_used_percentage: null },
          }),
        ).stdout,
      ),
    ).toContain('ctx:30%');
  });

  describe('context window size', () => {
    const ctxOf = (cw: unknown) =>
      strip(
        run(STATUS, JSON.stringify({ workspace: { current_dir: tmp }, context_window: cw })).stdout,
      );

    // used tokens: the sum of the current_usage input fields (output_tokens ignored), else pct * size
    it.each([
      [
        'the sum of current_usage, not the percentage',
        {
          input_tokens: 4000,
          cache_creation_input_tokens: 20000,
          cache_read_input_tokens: 30000,
          output_tokens: 9,
        },
        '54k',
      ],
      ['the sum of a partial current_usage', { input_tokens: 10000 }, '10k'],
      ['pct * size for a current_usage without numbers', { input_tokens: 'x' }, '50k'],
      ['pct * size for a current_usage that is no object', 'str', '50k'],
      ['pct * size without current_usage', undefined, '50k'],
    ])('uses %s', (_, cu, used) => {
      expect(
        ctxOf({ used_percentage: 25, context_window_size: 200000, current_usage: cu }),
      ).toContain(`ctx:25% (${used}/200k)`);
    });

    // token format boundaries: 999499 -> 999k, 999500 -> 1M, 1000000 -> 1M, 1500000 -> 1.5M
    it.each([
      [999499, 1500000, '(999k/1.5M)'],
      [999500, 1000000, '(1M/1M)'],
    ])('formats %i used of a %i window as %s', (used, size, want) => {
      expect(
        ctxOf({
          used_percentage: 50,
          context_window_size: size,
          current_usage: { input_tokens: used },
        }),
      ).toContain(want);
    });

    it.each([0, -5, 'big'])('omits the size part for size %j', (size) => {
      const out = ctxOf({ used_percentage: 42, context_window_size: size });
      expect(out).toContain('ctx:42%');
      expect(out).not.toContain('ctx:42% (');
    });
  });

  // traffic light per value: <50 green (32), <80 yellow (33), else red (31); each row checks the boundaries in all three slots
  it.each([
    [49, 50, 80, '32', '33', '31'],
    [80, 79, 49, '31', '33', '32'],
  ])('colours ctx %i%, 5h %i%, 7d %i% with codes %s, %s, %s', (ctx, h5, d7, cCtx, cH5, cD7) => {
    const r = run(
      STATUS,
      JSON.stringify({
        workspace: { current_dir: tmp },
        context_window: { used_percentage: ctx, context_window_size: 200000 },
        rate_limits: { five_hour: { used_percentage: h5 }, seven_day: { used_percentage: d7 } },
      }),
    );
    expect(r.stdout).toContain(`\x1b[${cCtx}mctx:${ctx}%`);
    expect(r.stdout).toContain(`\x1b[${cH5}m5h:${h5}%`);
    expect(r.stdout).toContain(`\x1b[${cD7}m7d:${d7}%`);
    expect(r.stdout).not.toContain('\x1b[90m');
  });

  it('shows only the 7d limit when 5h is missing', () => {
    const out = strip(
      run(
        STATUS,
        JSON.stringify({
          workspace: { current_dir: tmp },
          rate_limits: { seven_day: { used_percentage: 7 } },
        }),
      ).stdout,
    );
    expect(out).toMatch(/ 7d:7%$/);
    expect(out).not.toContain('5h:');
  });

  it('falls back to cwd, then to the process directory, on missing fields', () => {
    expect(strip(run(STATUS, JSON.stringify({ cwd: tmp })).stdout)).toContain(`:${tmp}`);
    expect(strip(run(STATUS, '{}', tmp).stdout)).toContain(`:${fs.realpathSync(tmp)}`);
  });

  // empty (parse error), a JSON non-object and an array
  it.each(['', 'null', '[1,2]'])('exits 0 with defaults on stdin %j', (stdin) => {
    const r = run(STATUS, stdin, tmp);
    expect(r.status).toBe(0);
    expect(strip(r.stdout)).toContain('@');
  });

  it.skipIf(spawnSync('git', ['--version']).status !== 0)('shows the git branch', () => {
    const git = (...a: string[]) => spawnSync('git', ['-C', tmp, ...a], { encoding: 'utf8' });
    git('init', '-q', '-b', 'topic/x');
    const out = strip(run(STATUS, JSON.stringify({ workspace: { current_dir: tmp } })).stdout);
    expect(out).toContain('(topic/x)');
  });
});

describe('subagent-statusline.mjs', () => {
  const rows = (stdout: string) =>
    stdout
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
  const task = (o: Record<string, unknown>) => ({
    id: 't1',
    agentType: 'explorer',
    label: 'scan',
    ...o,
  });
  // one process renders all tasks: one row per task, in order
  const contents = (tasks: unknown[]) =>
    rows(run(SUB, JSON.stringify({ tasks })).stdout).map((r) => r.content as string);

  it('prints one JSON line per task with agent, model, percent, tokens and label', () => {
    const r = run(
      SUB,
      JSON.stringify({
        columns: 80,
        tasks: [
          task({
            model: 'claude-haiku-4-5-20251001',
            tokenCount: 36000,
            contextWindowSize: 200000,
          }),
          task({
            id: 't2',
            agentType: 'planner',
            model: 'opus',
            tokenCount: 100000,
            contextWindowSize: 200000,
            label: 'plan it',
          }),
        ],
      }),
    );
    expect(r.status).toBe(0);
    const [a, b] = rows(r.stdout);
    expect(a.id).toBe('t1');
    expect(strip(a.content)).toBe('explorer haiku-4-5 ctx:18% (36k/200k) · scan');
    expect(strip(b.content)).toBe('planner opus ctx:50% (100k/200k) · plan it');
  });

  it('colours by percent of the window: <50% green, <80% yellow, else red', () => {
    const cases: [number, string][] = [
      [10000, '32'],
      [99999, '32'],
      [100000, '33'],
      [159999, '33'],
      [160000, '31'],
      [250000, '31'],
    ];
    const out = contents(cases.map(([n]) => task({ tokenCount: n, contextWindowSize: 200000 })));
    expect(out).toHaveLength(cases.length);
    for (const [i, [, code]] of cases.entries()) expect(out[i]).toContain(`\x1b[${code}mctx:`);
  });

  it('formats tokens as k and M (999499 -> 999k, 999500 -> 1M, 1500000 -> 1.5M, a 1M window -> 1M)', () => {
    const out = contents([
      task({ tokenCount: 999499, contextWindowSize: 2000000 }),
      task({ tokenCount: 999500, contextWindowSize: 2000000 }),
      task({ tokenCount: 1500000, contextWindowSize: 2000000 }),
      task({ tokenCount: 250000, contextWindowSize: 1000000 }),
    ]).map(strip);
    expect(out[0]).toContain('(999k/2M)');
    expect(out[1]).toContain('(1M/2M)');
    expect(out[2]).toContain('(1.5M/2M)');
    expect(out[3]).toBe('explorer ctx:25% (250k/1M) · scan');
  });

  it('shows only the token count when contextWindowSize is missing or zero', () => {
    const out = contents(
      [undefined, 0, null].map((size) => task({ tokenCount: 12400, contextWindowSize: size })),
    );
    expect(out.map(strip)).toEqual(Array(3).fill('explorer 12k · scan'));
  });

  it('uses defaults for missing fields (name, description, no tokens)', () => {
    const [named, bare] = rows(
      run(
        SUB,
        JSON.stringify({ tasks: [{ id: 7, name: 'bob', description: 'desc' }, { id: 'x' }] }),
      ).stdout,
    );
    expect(named.id).toBe(7);
    expect(strip(named.content)).toBe('bob 0k · desc');
    expect(strip(bare.content)).toBe('agent 0k · ');
  });

  it('skips malformed tasks', () => {
    const r = run(SUB, JSON.stringify({ tasks: [null, 5, 'x', {}, task({})] }));
    expect(rows(r.stdout)).toHaveLength(1);
  });

  // parse error, no tasks key, tasks not an array, an empty task list
  it.each(['', 'null', '{"tasks":"x"}', '{"tasks":[]}'])(
    'prints nothing and exits 0 on stdin %j',
    (stdin) => {
      const r = run(SUB, stdin);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('');
    },
  );
});

/** Command path as the installer writes it: quoted when it contains whitespace, else as is (absolute outside HOME). */
const cmdPath = (dir: string) => (/\s/.test(dir) ? `"${dir}"` : dir);
/** Copies the skill scripts to <root>/<client dir>/skills/context-statusline/scripts and returns the installer path there. */
const deploy = (root: string, clientDir: string) => {
  const dst = path.join(root, clientDir, 'skills', 'context-statusline', 'scripts');
  fs.mkdirSync(dst, { recursive: true });
  for (const f of ['statusline.mjs', 'subagent-statusline.mjs', 'Install-Statusline.ps1'])
    fs.copyFileSync(path.join(DIR, f), path.join(dst, f));
  return path.join(dst, 'Install-Statusline.ps1');
};

describe.skipIf(!hasPwsh || !posix)('Install-Statusline.ps1', () => {
  // One worker for all cases. pwsh fixes $HOME at process start, so the worker is spawned with HOME = the shared fake home
  // and every case starts from an emptied tmp (home recreated) instead of a fresh mkdtemp.
  let tmp: string;
  let home: string;
  let worker: PwshWorker;
  const caseEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, ...extra };
    delete env.USERPROFILE;
    if (!('COPILOT_HOME' in extra)) delete env.COPILOT_HOME;
    return env;
  };
  beforeAll(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'slinst-')));
    home = path.join(tmp, 'home');
    // pwsh fixes $HOME at start, so the worker starts with the fake home
    worker = new PwshWorker(INSTALLER, { ...process.env, HOME: home });
  });
  afterAll(() => {
    worker.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  beforeEach(() => {
    for (const f of fs.readdirSync(tmp))
      fs.rmSync(path.join(tmp, f), { recursive: true, force: true });
    fs.mkdirSync(home);
  });

  const run = (args: string[], env: Record<string, string> = {}) =>
    worker.run(args, { cwd: tmp, env: caseEnv(env) });
  // an installer copy elsewhere ($PSScriptRoot decides the script directory) needs its own process
  const spawnCopy = (installer: string, env: Record<string, string>, ...args: string[]) =>
    spawnSync('pwsh', ['-NoProfile', '-File', installer, ...args], {
      encoding: 'utf8',
      cwd: tmp,
      env: caseEnv(env),
    });

  describe('-Client claude (default)', () => {
    let settings: string;
    let oldCopy: string;
    beforeEach(() => {
      settings = path.join(home, '.claude', 'settings.json');
      oldCopy = path.join(home, '.claude', 'apm-hub', 'statusline');
      fs.mkdirSync(path.join(home, '.claude'));
    });

    const install = (...args: string[]) => run(args);
    const read = () => JSON.parse(fs.readFileSync(settings, 'utf8'));
    const backups = () =>
      fs.readdirSync(path.dirname(settings)).filter((f) => f.startsWith('settings.json.bak-'));
    const ours = (f: string) => ({ type: 'command', command: `node ${cmdPath(DIR)}/${f}` });
    const old = (f: string) => ({
      type: 'command',
      command: `node ~/.claude/apm-hub/statusline/${f}`,
    });

    it('installs into a fresh HOME without settings.json, pointing at the skill scripts, no copy', async () => {
      fs.rmSync(path.dirname(settings), { recursive: true });
      const r = await install();
      expect(r.status).toBe(0);
      expect(read()).toEqual({
        statusLine: ours('statusline.mjs'),
        subagentStatusLine: ours('subagent-statusline.mjs'),
      });
      expect(fs.existsSync(oldCopy)).toBe(false);
      expect(fs.readdirSync(path.join(home, '.claude'))).toEqual(['settings.json']);
      expect(fs.readFileSync(settings, 'utf8')).toContain('\n  "statusLine": {');
    });

    it('writes a ~/ command when the skill is deployed under HOME', () => {
      const r = spawnCopy(deploy(home, '.claude'), {});
      expect(r.status).toBe(0);
      expect(read()).toEqual({
        statusLine: {
          type: 'command',
          command: 'node ~/.claude/skills/context-statusline/scripts/statusline.mjs',
        },
        subagentStatusLine: {
          type: 'command',
          command: 'node ~/.claude/skills/context-statusline/scripts/subagent-statusline.mjs',
        },
      });
    });

    it('refuses when the target script is missing and leaves settings.json untouched', () => {
      fs.writeFileSync(settings, '{"a":1}');
      const inst = path.join(tmp, 'alone', 'Install-Statusline.ps1');
      fs.mkdirSync(path.dirname(inst));
      fs.copyFileSync(INSTALLER, inst);
      const r = spawnCopy(inst, {});
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('statusline.mjs not found');
      expect(fs.readFileSync(settings, 'utf8')).toBe('{"a":1}');
      expect(backups()).toHaveLength(0);
    });

    it('keeps other keys and their order, and writes a backup', async () => {
      const orig = '{\n  "model": "opus",\n  "env": { "A": "ü" },\n  "hooks": { "Stop": [] }\n}\n';
      fs.writeFileSync(settings, orig);
      expect((await install()).status).toBe(0);
      const s = read();
      expect(Object.keys(s)).toEqual(['model', 'env', 'hooks', 'statusLine', 'subagentStatusLine']);
      expect(s.env).toEqual({ A: 'ü' });
      expect(backups()).toHaveLength(1);
      expect(fs.readFileSync(path.join(path.dirname(settings), backups()[0]), 'utf8')).toBe(orig);
    });

    it('is idempotent: second run changes nothing and writes no backup', async () => {
      await install();
      const before = fs.readFileSync(settings, 'utf8');
      const r = await install();
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Up to date');
      expect(fs.readFileSync(settings, 'utf8')).toBe(before);
      expect(backups()).toHaveLength(0);
    });

    it('migrates entries of an older version without -Force and removes its copies', async () => {
      fs.writeFileSync(
        settings,
        JSON.stringify({
          statusLine: old('statusline.mjs'),
          x: 1,
          subagentStatusLine: old('subagent-statusline.mjs'),
        }),
      );
      fs.mkdirSync(oldCopy, { recursive: true });
      fs.writeFileSync(path.join(oldCopy, 'statusline.mjs'), 'old');
      fs.writeFileSync(path.join(oldCopy, 'subagent-statusline.mjs'), 'old');
      const r = await install();
      expect(r.status).toBe(0);
      expect(read()).toEqual({
        statusLine: ours('statusline.mjs'),
        x: 1,
        subagentStatusLine: ours('subagent-statusline.mjs'),
      });
      expect(fs.existsSync(oldCopy)).toBe(false);
      expect((await install()).stdout).toContain('Up to date');
    });

    it('refuses a foreign statusLine without -Force, replaces it with -Force', async () => {
      const orig = JSON.stringify(
        { statusLine: { type: 'command', command: 'bash ~/mine.sh' }, x: 1 },
        null,
        2,
      );
      fs.writeFileSync(settings, orig);
      const r = await install();
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('-Force');
      expect(fs.readFileSync(settings, 'utf8')).toBe(orig);
      expect((await install('-Force')).status).toBe(0);
      expect(read()).toEqual({
        statusLine: ours('statusline.mjs'),
        x: 1,
        subagentStatusLine: ours('subagent-statusline.mjs'),
      });
    });

    it('fails on invalid JSON without touching the file', async () => {
      fs.writeFileSync(settings, '{ nope');
      const r = await install();
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('not valid JSON');
      expect(fs.readFileSync(settings, 'utf8')).toBe('{ nope');
    });

    it('-WhatIf changes nothing', async () => {
      fs.writeFileSync(settings, '{"a":1}');
      fs.mkdirSync(oldCopy, { recursive: true });
      fs.writeFileSync(path.join(oldCopy, 'statusline.mjs'), 'old');
      expect((await install('-WhatIf')).status).toBe(0);
      expect(fs.readFileSync(settings, 'utf8')).toBe('{"a":1}');
      expect(fs.existsSync(path.join(oldCopy, 'statusline.mjs'))).toBe(true);
      expect(backups()).toHaveLength(0);
    });

    it('-Uninstall removes only our entries and the copies of older versions, never the skill files', async () => {
      fs.writeFileSync(settings, JSON.stringify({ keep: true }));
      await install();
      fs.mkdirSync(oldCopy, { recursive: true });
      fs.writeFileSync(path.join(oldCopy, 'statusline.mjs'), 'old');
      expect((await install('-Uninstall')).status).toBe(0);
      expect(read()).toEqual({ keep: true });
      expect(fs.existsSync(oldCopy)).toBe(false);
      expect(fs.existsSync(STATUS)).toBe(true);
      expect(fs.existsSync(SUB)).toBe(true);
    });

    it('-Uninstall removes entries of an older version', async () => {
      fs.writeFileSync(
        settings,
        JSON.stringify({
          statusLine: old('statusline.mjs'),
          subagentStatusLine: old('subagent-statusline.mjs'),
        }),
      );
      expect((await install('-Uninstall')).status).toBe(0);
      expect(read()).toEqual({});
    });

    it('-Uninstall leaves a foreign statusLine alone', async () => {
      const foreign = { type: 'command', command: 'bash ~/mine.sh' };
      fs.writeFileSync(settings, JSON.stringify({ statusLine: foreign }));
      expect((await install('-Uninstall')).status).toBe(0);
      expect(read()).toEqual({ statusLine: foreign });
    });

    it('-Uninstall without settings.json is a no-op', async () => {
      expect((await install('-Uninstall')).status).toBe(0);
      expect(fs.existsSync(settings)).toBe(false);
    });
  });

  describe('-Client copilot', () => {
    let chome: string;
    beforeEach(() => (chome = path.join(tmp, 'chome')));

    const install = (env: Record<string, string>, ...args: string[]) =>
      run(['-Client', 'copilot', ...args], env);
    const sp = (base: string) => path.join(base, 'settings.json');
    const read = (base: string) => JSON.parse(fs.readFileSync(sp(base), 'utf8'));
    const entry = { type: 'command', command: `node ${cmdPath(DIR)}/statusline.mjs`, padding: 1 };

    it('installs under ~/.copilot with the feature flag, no subagent entry and no copy', async () => {
      const r = await install({});
      expect(r.status).toBe(0);
      const base = path.join(home, '.copilot');
      expect(read(base)).toEqual({
        statusLine: entry,
        feature_flags: { enabled: ['STATUS_LINE'] },
      });
      expect(fs.readdirSync(base)).toEqual(['settings.json']);
      expect(fs.existsSync(path.join(home, '.claude'))).toBe(false);
    });

    it('uses COPILOT_HOME for settings.json', async () => {
      expect((await install({ COPILOT_HOME: chome })).status).toBe(0);
      expect(read(chome).statusLine).toEqual(entry);
      expect(fs.existsSync(path.join(home, '.copilot'))).toBe(false);
    });

    it('points at the ~/.agents deployment when run from the ~/.claude one, refuses without it', () => {
      const inst = deploy(home, '.claude');
      const r1 = spawnCopy(inst, { COPILOT_HOME: chome }, '-Client', 'copilot');
      expect(r1.status).not.toBe(0);
      expect(r1.stderr).toContain(
        '.agents/skills/context-statusline/scripts/statusline.mjs not found',
      );
      expect(fs.existsSync(chome)).toBe(false);
      deploy(home, '.agents');
      const r2 = spawnCopy(inst, { COPILOT_HOME: chome }, '-Client', 'copilot');
      expect(r2.status).toBe(0);
      expect(read(chome).statusLine).toEqual({
        type: 'command',
        command: 'node ~/.agents/skills/context-statusline/scripts/statusline.mjs',
        padding: 1,
      });
    });

    it('keeps existing flags and keys, adds the flag once, is idempotent', async () => {
      fs.mkdirSync(chome);
      fs.writeFileSync(
        sp(chome),
        JSON.stringify({ model: 'x', feature_flags: { enabled: ['OTHER'], disabled: ['D'] } }),
      );
      expect((await install({ COPILOT_HOME: chome })).status).toBe(0);
      const once = fs.readFileSync(sp(chome), 'utf8');
      expect(read(chome)).toEqual({
        model: 'x',
        feature_flags: { enabled: ['OTHER', 'STATUS_LINE'], disabled: ['D'] },
        statusLine: entry,
      });
      const r = await install({ COPILOT_HOME: chome });
      expect(r.stdout).toContain('Up to date');
      expect(fs.readFileSync(sp(chome), 'utf8')).toBe(once);
      expect(fs.readdirSync(chome).filter((f) => f.includes('.bak-'))).toHaveLength(1);
    });

    it('does not duplicate an already enabled flag', async () => {
      fs.mkdirSync(chome);
      fs.writeFileSync(sp(chome), JSON.stringify({ feature_flags: { enabled: ['STATUS_LINE'] } }));
      await install({ COPILOT_HOME: chome });
      expect(read(chome).feature_flags.enabled).toEqual(['STATUS_LINE']);
    });

    it('migrates an older entry with the absolute COPILOT_HOME copy path and removes the copy', async () => {
      fs.mkdirSync(path.join(chome, 'apm-hub', 'statusline'), { recursive: true });
      fs.writeFileSync(path.join(chome, 'apm-hub', 'statusline', 'statusline.mjs'), 'old');
      fs.writeFileSync(
        sp(chome),
        JSON.stringify({
          statusLine: {
            type: 'command',
            command: `node ${chome}/apm-hub/statusline/statusline.mjs`,
            padding: 1,
          },
        }),
      );
      expect((await install({ COPILOT_HOME: chome })).status).toBe(0);
      expect(read(chome).statusLine).toEqual(entry);
      expect(fs.existsSync(path.join(chome, 'apm-hub'))).toBe(false);
    });

    it('refuses a foreign statusLine without -Force, replaces it with -Force', async () => {
      fs.mkdirSync(chome);
      const orig = JSON.stringify({ statusLine: { type: 'command', command: 'mine' } });
      fs.writeFileSync(sp(chome), orig);
      const r = await install({ COPILOT_HOME: chome });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('-Force');
      expect(fs.readFileSync(sp(chome), 'utf8')).toBe(orig);
      expect((await install({ COPILOT_HOME: chome }, '-Force')).status).toBe(0);
      expect(read(chome).statusLine).toEqual(entry);
    });

    it('-WhatIf changes nothing', async () => {
      expect((await install({ COPILOT_HOME: chome }, '-WhatIf')).status).toBe(0);
      expect(fs.existsSync(chome)).toBe(false);
    });

    it('-Uninstall removes the entry and an old copy, leaves the flag and other keys', async () => {
      fs.mkdirSync(path.join(chome, 'apm-hub', 'statusline'), { recursive: true });
      fs.writeFileSync(path.join(chome, 'apm-hub', 'statusline', 'statusline.mjs'), 'old');
      fs.writeFileSync(sp(chome), JSON.stringify({ keep: 1 }));
      await install({ COPILOT_HOME: chome });
      expect((await install({ COPILOT_HOME: chome }, '-Uninstall')).status).toBe(0);
      expect(read(chome)).toEqual({ keep: 1, feature_flags: { enabled: ['STATUS_LINE'] } });
      expect(fs.existsSync(path.join(chome, 'apm-hub'))).toBe(false);
    });

    it('-Client all installs both', async () => {
      const r = await run(['-Client', 'all'], { COPILOT_HOME: chome });
      expect(r.status).toBe(0);
      expect(read(path.join(home, '.claude'))).toEqual({
        statusLine: { type: 'command', command: `node ${cmdPath(DIR)}/statusline.mjs` },
        subagentStatusLine: {
          type: 'command',
          command: `node ${cmdPath(DIR)}/subagent-statusline.mjs`,
        },
      });
      expect(read(chome).statusLine).toEqual(entry);
    });

    it("-Client all from a ~/.claude deployment uses each client's own deployment", () => {
      const inst = deploy(home, '.claude');
      deploy(home, '.agents');
      const r = spawnCopy(inst, { COPILOT_HOME: chome }, '-Client', 'all');
      expect(r.status).toBe(0);
      expect(read(path.join(home, '.claude')).statusLine.command).toBe(
        'node ~/.claude/skills/context-statusline/scripts/statusline.mjs',
      );
      expect(read(chome).statusLine.command).toBe(
        'node ~/.agents/skills/context-statusline/scripts/statusline.mjs',
      );
    });
  });
});
