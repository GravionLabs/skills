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

// #378: the release key of .agents/config.json.
describe('config schema: release', () => {
  it('accepts release.prerelease and release.test.gate', () => {
    expect(
      validate({
        release: {
          prerelease: 'gh workflow run release.yml --ref release/next -f prerelease=true',
          test: { gate: true },
        },
      }),
    ).toBe(true);
  });

  it.each([
    { release: { unknown: 1 } },
    { release: { test: { gate: 'yes' } } },
    { release: { test: { other: true } } },
    { release: { prerelease: '' } },
  ])('rejects %j', (cfg) => {
    expect(validate(cfg)).toBe(false);
  });
});
