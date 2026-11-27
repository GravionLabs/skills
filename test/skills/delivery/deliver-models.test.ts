// deliver loop: the model and tier of each session (#1086): the PBI's `Tier:` line, the role, the flags.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  issueTier,
  sessionModels,
} from '../../../skills/delivery/deliver/scripts/session-models.mts';
import { type Scenario, fixture, loop, repo } from './deliver/run-loop';

fixture();

const item = (id: number, tier?: string) => ({
  id,
  title: '[PBI] feat: tiered',
  body: tier ? `## Overview\n\nSize: S\nTier: ${tier} — because\nTier: strong — second` : 'text',
});

describe('deliver loop: models (fake harness)', () => {
  const run = async (items: Scenario['items'], args: string[] = [], config?: object) => {
    const dir = path.join(repo, '.agents');
    if (config) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
    }
    try {
      return await loop({ items }, { args });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('picks the implementer by the Tier line and another model for the review', async () => {
    const out = await run([item(401, 'fast'), item(402), item(403, 'strong')]);
    expect(out.status).toBe(0);
    expect(out.results.map((r) => r.sessions)).toMatchObject([
      [
        { model: 'haiku', tier: 'fast' },
        { role: 'review', model: 'opus', tier: 'strong' },
      ],
      [
        { model: 'sonnet', tier: 'standard' },
        { role: 'review', model: 'opus', tier: 'strong' },
      ],
      [
        { model: 'opus', tier: 'strong' },
        { role: 'review', model: 'opus', tier: 'strong' },
      ],
    ]);
    expect(out.stdout).toMatch(
      /run \S+ in fake\/repo, models: implement by the issue's tier \(standard sonnet\), review opus, retro sonnet, results: /,
    );
    expect(out.stdout).toContain('#402 no Tier: line in the issue: implements with tier standard');
    expect(out.stdout).not.toContain('#401 no Tier');
    expect(out.stdout).toContain("#403 review runs the implementer's model (opus)");
  });

  it('lets --model and deliver.review.model win', async () => {
    const out = await run([item(404, 'fast')], ['--model', 'my-model'], {
      deliver: { review: { model: 'my-reviewer' } },
    });
    expect(out.results[0]?.sessions).toMatchObject([
      { model: 'my-model', tier: 'fast' },
      { role: 'review', model: 'my-reviewer', tier: 'strong' },
    ]);
    expect(out.stdout).toContain('models: implement my-model, review my-reviewer');
  });

  it('gives the review the next stronger tier when both roles resolve to one model', async () => {
    const out = await run([item(405)], [], { models: { roles: { review: 'standard' } } });
    expect(out.results[0]?.sessions).toMatchObject([
      { model: 'sonnet', tier: 'standard' },
      { role: 'review', model: 'opus', tier: 'strong' },
    ]);
  });

  it('refuses a wrong models setting before any session', async () => {
    const out = await run([item(406)], [], { models: { roles: { retro: 'huge' } } });
    expect(out.status).toBe(64);
    expect(out.stderr).toContain('models: unknown tier');
    expect(out.sessions).toEqual([]);
  });
});

describe('session models', () => {
  const models = (extra: object = {}, config?: object) =>
    sessionModels({
      layers: config ? [{ source: 'repository', file: 'config.json', config }] : [],
      harness: 'claude',
      reviewHarness: 'claude',
      ...extra,
    });

  it.each([
    ['Tier: fast — small', 'fast'],
    ['text\r\nTier: Strong\r\n', 'strong'],
    ['Tier: interactive', undefined],
    ['no line, only the Tier: word in a sentence', undefined],
  ])('reads %j', (body, tier) => {
    expect(issueTier(body).tier).toBe(tier);
  });

  it('names an unknown tier and implements it with standard', () => {
    expect(models().implement('Tier: huge')).toEqual({
      model: 'sonnet',
      tier: 'standard',
      note: 'unknown tier "huge" in the issue: implements with tier standard',
    });
  });

  it('keeps a role that is mapped to a fixed tier, and the retro role', () => {
    const fixed = models({}, { models: { roles: { implement: 'strong', retro: 'fast' } } });
    expect(fixed.implement('Tier: fast').model).toBe('opus');
    expect(fixed.retro).toEqual({ model: 'haiku', tier: 'fast' });
    expect(models().retro).toEqual({ model: 'sonnet', tier: 'standard' });
  });

  it('compares models across harnesses by family, unknown names exactly', () => {
    const copilot = models({ reviewHarness: 'copilot' }, { models: { roles: { review: 'fast' } } });
    expect(copilot.review('Tier: fast').model).toBe('claude-sonnet-5.5');
    const own = models({ model: 'gpt-x' }, { models: { roles: { review: 'fast' } } });
    expect(own.review('')).toEqual({ model: 'haiku', tier: 'fast', note: undefined });
  });
});
