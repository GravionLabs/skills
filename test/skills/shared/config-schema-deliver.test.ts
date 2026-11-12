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

// #548: deliver.parallel of .agents/config.json (integer >= 1, default 1).
describe('config schema: deliver.parallel', () => {
  it('accepts 1 and 3 and documents the default 1', () => {
    expect(validate({ deliver: { parallel: 1 } })).toBe(true);
    expect(validate({ deliver: { parallel: 3 } })).toBe(true);
    expect(schema.properties.deliver.properties.parallel.default).toBe(1);
  });

  it.each([0, -1, 1.5, '2'])('rejects parallel %j', (parallel) => {
    expect(validate({ deliver: { parallel } })).toBe(false);
  });
});
