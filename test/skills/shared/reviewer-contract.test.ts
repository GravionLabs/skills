import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv/dist/2020';

const skillDir = path.resolve(__dirname, '../../../skills/code-review');
const read = (p: string) => fs.readFileSync(path.join(skillDir, p), 'utf-8');
const schema = JSON.parse(read('schema/review.schema.json'));
const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);

const finding = { file: 'src/a.ts', line: 3, title: 'null deref', why: 'criterion 1' };

describe('review.schema.json', () => {
  it('accepts the example of reviewer-contract.md', () => {
    const json = read('references/reviewer-contract.md').match(/```json\n([\s\S]*?)```/)![1];
    expect(validate(JSON.parse(json))).toBe(true);
  });

  it('accepts an empty review', () => {
    expect(validate({ blocking: [], notes: [] })).toBe(true);
  });

  it.each([
    ['missing notes', { blocking: [] }],
    ['extra property', { blocking: [], notes: [], score: 1 }],
    ['finding without why', { blocking: [{ ...finding, why: undefined }], notes: [] }],
    ['line 0', { blocking: [{ ...finding, line: 0 }], notes: [] }],
    ['extra finding property', { blocking: [{ ...finding, severity: 'high' }], notes: [] }],
    ['empty note', { blocking: [], notes: [''] }],
  ])('rejects %s', (_n, v) => {
    expect(validate(JSON.parse(JSON.stringify(v)))).toBe(false);
  });
});

describe('code-review skill', () => {
  const skill = read('SKILL.md');
  const ref = read('references/reviewer-contract.md');

  it('replaces the severity ladder by the blocking definition', () => {
    expect(skill + ref).not.toMatch(/🔴|🟡|🟢/);
    expect(skill).toMatch(/breaks an acceptance criterion, or is a correctness or security defect/);
    expect(ref).toMatch(/breaks an acceptance criterion or is a correctness or security defect/);
  });

  it('has a security section and keeps the language dispatch', () => {
    expect(skill).toMatch(/^## Security$/m);
    expect(skill).toContain('detect-techstack');
    expect(skill).toContain('## Review rules');
  });

  it('reads the Review rules of the <lang>-test skills next to the implementation rules', () => {
    expect(skill).toMatch(/`<lang>-implementation` and of its `<lang>-test` skill/);
    expect(skill).toMatch(/test files of the diff/);
    expect(ref).toMatch(/Review rules` of the `<lang>-test` skills/);
    expect(ref).toMatch(/test files of the diff/);
  });

  it('keeps an interactive readable report', () => {
    expect(skill).toMatch(/Interactive: a readable report/);
  });

  it('links reference and schema, names every schema property, stays within 100 lines', () => {
    expect(skill).toContain('references/reviewer-contract.md');
    expect(skill).toContain('schema/review.schema.json');
    for (const k of [
      'blocking',
      'notes',
      ...Object.keys(schema.properties.blocking.items.properties),
    ])
      expect(ref).toContain(`\`${k}\``);
    expect(skill.split('\n').length).toBeLessThanOrEqual(100);
  });

  it('names no state path', () => {
    expect(ref).not.toMatch(/\.agents|\.dromos|<state>/);
  });
});
