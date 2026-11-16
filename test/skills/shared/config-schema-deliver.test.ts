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

// The deliver key of .agents/config.json holds the settings of deliver-min.
describe('config schema: deliver', () => {
  it('accepts base, tracker, harness and protectedPaths', () => {
    expect(
      validate({
        deliver: {
          base: 'main',
          tracker: 'github',
          harness: 'copilot',
          protectedPaths: ['.github/'],
        },
      }),
    ).toBe(true);
  });

  it.each([
    { harness: 'codex' },
    { base: '' },
    { protectedPaths: 'x' },
    { parallel: 3 },
    { roles: {} },
  ])('rejects %j', (deliver) => {
    expect(validate({ deliver })).toBe(false);
  });
});
