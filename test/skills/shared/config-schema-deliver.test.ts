import Ajv2020 from 'ajv/dist/2020';
import * as fs from 'fs';
import * as path from 'path';

const schema = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../skills/shared/implementation/schema/config.schema.json'),
    'utf8',
  ),
);
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

// The deliver key of .agents/config.json holds the settings of deliver.
describe('config schema: deliver', () => {
  it('accepts base, tracker, harness, handoverMinutes, parallel, maxSessions, protectedPaths and review', () => {
    expect(
      validate({
        deliver: {
          base: 'main',
          tracker: 'github',
          harness: 'copilot',
          handoverMinutes: 30,
          mergeRisk: 'high',
          parallel: 3,
          maxSessions: 5,
          protectedPaths: ['.github/'],
          review: { model: 'opus', harness: 'claude', effort: 'high' },
        },
      }),
    ).toBe(true);
  });

  it.each([
    { harness: 'codex' },
    { base: '' },
    { protectedPaths: 'x' },
    { handoverMinutes: -1 },
    { mergeRisk: 'critical' },
    { handoverMinutes: 1.5 },
    { parallel: 0 },
    { parallel: 1.5 },
    { maxSessions: 0 },
    { maxSessions: 1.5 },
    { roles: {} },
    { review: { harness: 'codex' } },
    { review: { effort: 'huge' } },
    { review: { rounds: 3 } },
  ])('rejects %j', (deliver) => {
    expect(validate({ deliver })).toBe(false);
  });
});

describe('config schema: models', () => {
  it('accepts tiers per harness and roles', () => {
    expect(
      validate({
        models: {
          tiers: { claude: { strong: 'claude-opus-5-5[1m]' }, copilot: { fast: 'x' } },
          roles: { implement: 'tier', review: 'strong' },
        },
      }),
    ).toBe(true);
  });

  it.each([
    { tiers: { codex: {} } },
    { tiers: { claude: { huge: 'x' } } },
    { tiers: { claude: { fast: 'two words' } } },
    { roles: { boss: 'fast' } },
    { roles: { review: 'huge' } },
    { effort: 'high' },
  ])('rejects %j', (models) => {
    expect(validate({ models })).toBe(false);
  });
});
