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

describe('deliver-release-review.schema.json (#100)', () => {
  const validateRelease = ajv.compile({
    ...read('delivery/deliver/schema/deliver-release-review.schema.json'),
    $id: `${base}delivery/deliver/schema/deliver-release-review.schema.json`,
  });
  const result = () => ({
    milestone: 'v1.2.0',
    sha: 'e3838c9',
    round: 2,
    review: {
      blocking: [{ file: 'a.md', line: 9, title: 'drift', why: 'step 9 names a missing input' }],
      notes: [],
    },
    bugs: [131],
  });

  it('accepts a round with bugs and a clean round', () => {
    expect(validateRelease(result())).toBe(true);
    expect(validateRelease({ ...result(), review: { blocking: [], notes: ['n'] }, bugs: [] })).toBe(
      true,
    );
  });

  it.each(['milestone', 'sha', 'round', 'review', 'bugs'])('rejects a missing %s', (key) => {
    const doc: any = result();
    delete doc[key];
    expect(validateRelease(doc)).toBe(false);
  });

  // #235: keyed by M<n>, the same key before and after close renames the title to M<n> (x.y.z)
  it.each(['M4', '1.2.0'])('accepts the milestone key %s', (milestone) => {
    expect(validateRelease({ ...result(), milestone })).toBe(true);
  });

  it('rejects the renamed title M4 (0.2.0) as key', () => {
    expect(validateRelease({ ...result(), milestone: 'M4 (0.2.0)' })).toBe(false);
  });

  it('rejects round 0, a bug number 0 and an extra field', () => {
    expect(validateRelease({ ...result(), round: 0 })).toBe(false);
    expect(validateRelease({ ...result(), bugs: [0] })).toBe(false);
    expect(validateRelease({ ...result(), pbi: 1 })).toBe(false);
  });
});

describe('config schema release-review role (#100)', () => {
  const validateConfig = new Ajv({ allErrors: true }).compile(
    read('shared/implementation/schema/config.schema.json'),
  );
  const config = (role: unknown) => ({ deliver: { roles: { 'release-review': role } } });

  it('accepts a model and effort override', () => {
    expect(validateConfig(config({ model: 'sonnet', effort: 'medium' }))).toBe(true);
  });

  it('rejects tiers and an unknown effort', () => {
    expect(validateConfig(config({ tiers: { fast: { model: 'haiku' } } }))).toBe(false);
    expect(validateConfig(config({ effort: 'huge' }))).toBe(false);
  });
});
