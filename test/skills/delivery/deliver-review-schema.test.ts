import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv/dist/2020';

const read = (p: string) =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../skills', p), 'utf-8'));
const base = 'https://example.test/skills/';
const schema = {
  ...read('delivery/deliver/schema/deliver-review.schema.json'),
  $id: `${base}delivery/deliver/schema/deliver-review.schema.json`,
};
const reviewSchema = {
  ...read('shared/code-review/schema/review.schema.json'),
  $id: `${base}shared/code-review/schema/review.schema.json`,
};

const ajv = new Ajv({ allErrors: true });
ajv.addSchema(reviewSchema);
const validate = ajv.compile(schema);

const valid = () => ({
  pbi: 53,
  branch: 'feat/53-deliver-review-result-file',
  sha: 'b18a36c0f1e2d3c4b5a69788796a5b4c3d2e1f00',
  round: 1,
  unmet: ['file is written'],
  review: {
    blocking: [{ file: 'a.ts', line: 3, title: 'null deref', why: 'crashes on empty input' }],
    notes: ['rename x'],
  },
});

describe('deliver-review.schema.json', () => {
  it('accepts a full result and a clean one', () => {
    expect(validate(valid())).toBe(true);
    expect(validate({ ...valid(), unmet: [], review: { blocking: [], notes: [] } })).toBe(true);
  });

  it.each(['pbi', 'branch', 'sha', 'round', 'unmet', 'review'])('rejects a missing %s', (key) => {
    const doc: any = valid();
    delete doc[key];
    expect(validate(doc)).toBe(false);
  });

  it('rejects an extra field at top level', () => {
    expect(validate({ ...valid(), extra: 1 })).toBe(false);
  });

  it('rejects an invalid review through the $ref', () => {
    const doc: any = valid();
    delete doc.review.blocking[0].why;
    expect(validate(doc)).toBe(false);
  });

  it('rejects round 0', () => {
    expect(validate({ ...valid(), round: 0 })).toBe(false);
  });
});
