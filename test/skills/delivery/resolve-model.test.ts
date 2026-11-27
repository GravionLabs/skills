import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HARNESSES } from '../../../skills/delivery/deliver/scripts/harness.mts';
import {
  HARNESS_NAMES,
  ROLES,
  type ConfigLayer,
  resolveModel,
} from '../../../skills/delivery/deliver/scripts/resolve-model.mts';

const layer = (source: ConfigLayer['source'], models: unknown): ConfigLayer => ({
  source,
  file: `${source}.json`,
  config: { models },
});

describe('resolveModel', () => {
  it('knows the harnesses of the loop', () => {
    expect([...HARNESS_NAMES]).toEqual(Object.keys(HARNESSES));
  });

  it.each([
    ['claude', ['opus', 'opus', 'opus', 'sonnet', 'opus', 'sonnet', 'sonnet']],
    [
      'copilot',
      ['opus', 'opus', 'opus', 'sonnet', 'opus', 'sonnet', 'sonnet'].map((m) => `claude-${m}-5.5`),
    ],
  ])('resolves every role of %s by default', (harness, expected) => {
    expect(ROLES).toEqual([
      'orchestrator',
      'triage',
      'planner',
      'implement',
      'review',
      'retro',
      'release',
    ]);
    expect(ROLES.map((role) => resolveModel({ role, harness }).model)).toEqual(expected);
  });

  it.each([
    ['claude', 'haiku'],
    ['copilot', 'claude-haiku-5.5'],
  ])('has the fast model of %s', (harness, model) => {
    expect(resolveModel({ role: 'implement', tier: 'fast', harness }).model).toBe(model);
  });

  it('reads the user config', () => {
    const layers = [
      layer('user', { tiers: { claude: { strong: 'fable' } }, roles: { retro: 'strong' } }),
    ];
    expect(resolveModel({ role: 'retro', layers })).toMatchObject({
      harness: 'claude',
      tier: 'strong',
      model: 'fable',
      sources: { harness: 'default', tier: 'user', model: 'user' },
    });
  });

  it('lets the repository override the user per value', () => {
    const layers = [
      layer('user', {
        tiers: { claude: { strong: 'user-strong', fast: 'user-fast' } },
        roles: { review: 'fast', retro: 'strong' },
      }),
      layer('repository', {
        tiers: { claude: { strong: 'claude-opus-5-5[1m]' }, copilot: { fast: 'other' } },
        roles: { review: 'strong' },
      }),
    ];
    expect(resolveModel({ role: 'review', layers })).toMatchObject({
      model: 'claude-opus-5-5[1m]',
      sources: { tier: 'repository', model: 'repository' },
    });
    expect(resolveModel({ role: 'retro', layers })).toMatchObject({
      model: 'claude-opus-5-5[1m]',
      sources: { tier: 'user', model: 'repository' },
    });
    expect(resolveModel({ role: 'review', tier: 'fast', layers }).model).toBe('user-fast');
  });

  it('lets the flag win over the config', () => {
    const layers = [layer('repository', { roles: { review: 'fast' } })];
    expect(
      resolveModel({ role: 'review', tier: 'standard', harness: 'copilot', layers }),
    ).toMatchObject({
      model: 'claude-sonnet-5.5',
      sources: { harness: 'flag', tier: 'flag', model: 'default' },
    });
  });

  it('uses standard for a role mapped to the tier of the issue without --tier', () => {
    const layers = [layer('repository', { roles: { review: 'tier' } })];
    expect(resolveModel({ role: 'review', layers })).toMatchObject({
      tier: 'standard',
      sources: { tier: 'default' },
    });
  });

  it.each([
    [{ role: 'boss' }, /unknown role "boss": one of orchestrator, triage/],
    [{ role: 'review', tier: 'huge' }, /unknown tier "huge": one of fast, standard, strong/],
    [{ role: 'review', tier: 'tier' }, /unknown tier "tier"/],
    [{ role: 'review', harness: 'codex' }, /unknown harness "codex": one of claude, copilot/],
    [{ role: 'toString' }, /unknown role/],
  ])('refuses %j', (input, message) => {
    expect(() => resolveModel(input)).toThrow(message);
  });

  it.each([
    'two words',
    'opus;rm',
    '$(id)',
    'a`b`',
    'a|b',
    'a&b',
    '--dangerous',
    'opus\n',
    '*',
    '',
    5,
  ])('refuses the model name %j, also of another harness', (model) => {
    const layers = [layer('repository', { tiers: { copilot: { fast: model } } })];
    expect(() => resolveModel({ role: 'review', layers })).toThrow(
      /repository\.json: models\.tiers\.copilot\.fast is no model name/,
    );
  });

  it.each([
    [{ roles: { review: 'huge' } }, /models\.roles\.review.*one of fast, standard, strong, tier/],
    [{ tiers: 'opus' }, /models\.tiers is an object/],
    ['opus', /models is an object/],
  ])('refuses the config %j', (models, message) => {
    expect(() => resolveModel({ role: 'review', layers: [layer('user', models)] })).toThrow(
      message,
    );
  });

  it('warns once per file about unknown keys', () => {
    const layers = [
      layer('repository', {
        default: 'x',
        tiers: { codex: {}, claude: { huge: 'x' } },
        roles: { boss: 'fast' },
      }),
    ];
    const { warnings, model } = resolveModel({ role: 'review', layers });
    expect(model).toBe('opus');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(
      'repository.json: models.default, models.tiers.codex, models.tiers.claude.huge, models.roles.boss ignored',
    );
  });
});

describe('resolve-model.mts', () => {
  const script = path.resolve(
    __dirname,
    '../../../skills/delivery/deliver/scripts/resolve-model.mts',
  );
  let dir: string;
  const write = (where: string, text: string) => {
    mkdirSync(path.join(dir, where, '.agents'), { recursive: true });
    writeFileSync(path.join(dir, where, '.agents/config.json'), text);
  };
  const run = (cwd: string, ...args: string[]) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: path.join(dir, cwd),
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: path.join(dir, 'home'),
        USERPROFILE: path.join(dir, 'home'),
        GIT_CEILING_DIRECTORIES: dir,
      },
    });

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'resolve-model-'));
    write('home', JSON.stringify({ models: { tiers: { claude: { standard: 'mine' } } } }));
    write('repo', JSON.stringify({ models: { roles: { release: 'fast' }, extra: 1 } }));
    write('broken', '{');
    mkdirSync(path.join(dir, 'repo/sub'));
    spawnSync('git', ['init', '-q'], { cwd: path.join(dir, 'repo') });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('prints the model, from the root of the checkout', () => {
    const out = run('repo/sub', 'release');
    expect(out.status).toBe(0);
    expect(out.stdout).toBe('haiku\n');
    expect(out.stderr).toContain('models.extra ignored');
  });

  it('prints JSON with the source of each value', () => {
    const out = run('repo', 'implement', '--json');
    expect(JSON.parse(out.stdout)).toEqual({
      role: 'implement',
      harness: 'claude',
      tier: 'standard',
      model: 'mine',
      sources: { harness: 'default', tier: 'default', model: 'user' },
    });
  });

  it.each([
    ['repo', ['boss'], 'one of orchestrator'],
    ['repo', [], 'give exactly one role'],
    ['repo', ['review', '--model', 'x'], '--model'],
    ['broken', ['review'], 'invalid JSON'],
  ])('exits 64 in %s for %j', (cwd, args, message) => {
    const out = run(cwd, ...args);
    expect(out.status).toBe(64);
    expect(out.stdout).toBe('');
    expect(out.stderr).toContain(message);
  });
});
