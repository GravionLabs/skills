import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HARNESSES } from '../../../skills/delivery/deliver/scripts/harness.mts';
import { unknownConfigKeys } from '../../../skills/delivery/deliver/scripts/legacy.mts';
import { retroSettings } from '../../../skills/delivery/deliver/scripts/review.mts';
import { create, withRetroLine } from '../../../skills/delivery/deliver/scripts/tracker/github.mts';
import { createFakeGh } from '../../helpers/fake-gh';
import { RED, fixture, loop } from './deliver/run-loop';

fixture();

const URL = 'https://example.test/issues/7#issuecomment-1';
const one = { items: [{ id: 31, title: '[PBI] feat: last' }] };
const milestone = { milestone: true };

describe('retro after a milestone (fake harness)', () => {
  it('runs after the last merge, before the release pull request, and links its comment', async () => {
    const out = await loop(one, milestone);
    expect(out.status).toBe(0);
    expect(out.retros).toEqual([{ prompt: '/retro --milestone M001 --post', releasePulls: 0 }]);
    expect(out.calls.filter((c) => c !== 'dropBranch')).toEqual([
      'merge',
      'releasePull',
      'linkRetro',
    ]);
    expect(out.final).toMatchObject({ status: 'done', retro: URL });
  });

  it('opens the release pull request first and names it when the milestone has no Feature', async () => {
    const out = await loop({ ...one, retroFeature: false }, milestone);
    expect(out.retros).toEqual([
      {
        prompt: '/retro --milestone M001 --post --release-pr https://example.test/pull/900',
        releasePulls: 1,
      },
    ]);
    expect(out.calls).toContain('linkRetro');
  });

  it.each([
    ['a failing session', 'fail', 'session failed (exit 1)'],
    ['a session without a comment', 'none', 'no retro comment'],
    ['a timed-out session', 'hang', 'session timeout'],
  ] as const)('still ends done with a warning after %s', async (_name, retro, why) => {
    const out = await loop(
      { ...one, retro },
      { ...milestone, env: retro === 'hang' ? { DELIVER_SESSION_MS: '3000' } : {} },
    );
    expect(out.status).toBe(0);
    expect(out.stdout).toContain(`retro failed: ${why}`);
    expect(out.releasePulls).toBe(1);
    expect(out.calls).not.toContain('linkRetro');
    expect(out.final).toMatchObject({ status: 'done', retroFailed: why });
    expect(out.retros).toHaveLength(1);
  });

  it('is skipped by --no-retro', async () => {
    const out = await loop(one, { ...milestone, args: ['--no-retro'] });
    expect(out.status).toBe(0);
    expect(out.retros).toEqual([]);
    expect(out.releasePulls).toBe(1);
  });

  it('does not run after a blocked run', async () => {
    const out = await loop({ ...one, gates: [RED] }, milestone);
    expect(out.status).toBe(2);
    expect(out.retros).toEqual([]);
  });
});

describe('retro settings', () => {
  it('defaults to enabled with the review model; config and --no-retro change it', () => {
    expect(retroSettings({ config: undefined, reviewModel: 'opus' })).toEqual({
      enabled: true,
      model: 'opus',
    });
    expect(
      retroSettings({ config: { enabled: false, model: 'haiku' }, reviewModel: 'opus' }),
    ).toEqual({ enabled: false, model: 'haiku' });
    expect(retroSettings({ disabled: true, config: {}, reviewModel: 'opus' }).enabled).toBe(false);
    expect(() => retroSettings({ config: { model: '--x' }, reviewModel: 'opus' })).toThrow(
      'deliver.retro.model',
    );
    expect(() => retroSettings({ config: { enabled: 'no' }, reviewModel: 'opus' })).toThrow(
      'deliver.retro.enabled',
    );
  });

  it('warns about unknown keys of retro', () => {
    expect(unknownConfigKeys({ retro: { enabled: true, model: 'opus' } })).toBeUndefined();
    expect(unknownConfigKeys({ retro: { harness: 'x' } })).toContain('deliver.retro.harness');
  });

  it('denies commands in the command line of each harness', () => {
    const input = { prompt: 'p', deny: ['git push'] };
    expect(HARNESSES['claude']?.command(input)).toContain('Bash(git push:*)');
    expect(HARNESSES['copilot']?.command(input).slice(-2)).toEqual([
      '--deny-tool',
      'shell(git push)',
    ]);
  });
});

describe('GitHub tracker: retro (fake gh)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'deliver-retro-'));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  const tracker = (handler: string) => {
    const fake = createFakeGh(dir, handler);
    for (const [k, v] of Object.entries(fake.env())) if (v !== undefined) vi.stubEnv(k, v);
    const made = create({
      cwd: dir,
      base: 'release/next',
      selection: { milestone: 'M001' },
      trustAuthors: false,
    });
    return { made, fake };
  };
  const pull = { id: 9, title: 'r', url: 'u', branch: 'release/next' };

  it('replaces the Retro line of the release pull request body or appends it', () => {
    expect(withRetroLine('Release.', 'u1')).toBe('Release.\n\nRetro: u1');
    expect(withRetroLine('Release.\r\n\r\nRetro: u0\r\nmore', 'u1')).toBe(
      'Release.\r\n\r\nRetro: u1\r\nmore',
    );
    expect(withRetroLine(null, 'u1')).toBe('Retro: u1');
    const { made, fake } = tracker(`(call) => {
      if (call.args[0] === 'repo') return { rest: 'o/r' };
      return { rest: { body: 'Release.' } };
    }`);
    made.linkRetro(pull, 'u1');
    expect(fake.calls().at(-1)?.args).toEqual(
      expect.arrayContaining(['PATCH', 'repos/o/r/pulls/9', 'body=Release.\n\nRetro: u1']),
    );
  });

  it.each([
    ['a Feature parent', 'o/r', 'feature', true],
    ['a parent of another repository', 'o/other', 'feature', false],
    ['a parent that is no Feature', 'o/r', 'epic', false],
  ])('finds the Feature of the milestone: %s', (_name, parentRepo, label, found) => {
    const { made } = tracker(`(call) => {
      const route = call.args[1] || '';
      if (call.args[0] === 'repo') return { rest: 'o/r' };
      if (route.includes('/milestones')) return { rest: [[{ number: 1, title: 'M001' }]] };
      if (route.includes('issues?milestone')) return { rest: [[{ number: 3 }, { number: 4 }]] };
      if (route.endsWith('/3/parent')) throw new Error('gh: Not Found (HTTP 404)');
      return { rest: { title: 'x', labels: [{ name: '${label}' }],
        repository_url: 'https://api.github.com/repos/${parentRepo}' } };
    }`);
    expect(made.hasRetroFeature()).toBe(found);
  });

  it('accepts only a comment of this repository that starts with the marker', () => {
    const url = 'https://github.com/o/r/issues/7#issuecomment-5';
    const { made } = tracker(`(call) => {
      if (call.args[0] === 'repo') return { rest: 'o/r' };
      return { rest: { html_url: '${url}', body: '<!-- retro: M001 -->\\nreport' } };
    }`);
    expect(made.isRetroComment(url, '<!-- retro: M001 -->')).toBe(true);
    expect(made.isRetroComment(url, '<!-- retro: M002 -->')).toBe(false);
    expect(made.isRetroComment(url.replace('o/r', 'o/x'), '<!-- retro: M001 -->')).toBe(false);
  });
});

describe('deliver SKILL.md: retro', () => {
  const text = readFileSync(
    path.resolve(__dirname, '../../../skills/delivery/deliver/SKILL.md'),
    'utf8',
  );
  it('names the command, the settings and the flag', () => {
    for (const part of [
      '/retro --milestone <M> --post',
      'deliver.retro.enabled',
      'deliver.retro.model',
      '--no-retro',
      'Retro: <url>',
    ])
      expect(text).toContain(part);
  });
});
