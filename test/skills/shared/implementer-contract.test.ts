import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv/dist/2020';

const skillDir = path.resolve(__dirname, '../../../skills/shared/implementation');
const read = (p: string) => fs.readFileSync(path.join(skillDir, p), 'utf-8');
const schema = JSON.parse(read('schema/implementer.schema.json'));
const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);

const done = {
  status: 'done',
  commit: 'a1b2c3d',
  filesChanged: ['src/a.ts'],
  testsRun: 'pnpm test: 3 passed',
  notes: [],
  risk: { level: 'low', what: 'tests only', backout: 'revert the commit' },
  visual_proof: { na: 'no UI change' },
};

describe('implementer.schema.json', () => {
  it('accepts the example of runner-contract.md', () => {
    const json = read('references/runner-contract.md').match(/```json\n([\s\S]*?)```/)![1];
    expect(validate(JSON.parse(json))).toBe(true);
  });

  it('accepts a blocked result without commit', () => {
    expect(
      validate({
        ...done,
        status: 'blocked',
        commit: null,
        filesChanged: [],
        testsRun: '',
        notes: ['criterion 2 contradicts the schema'],
      }),
    ).toBe(true);
  });

  it('accepts a result with before and after proof', () => {
    expect(validate({ ...done, visual_proof: { before: 'a.png', after: 'b.png' } })).toBe(true);
  });

  it.each([
    ['unknown status', { ...done, status: 'ok' }],
    ['missing testsRun', { ...done, testsRun: undefined }],
    ['extra property', { ...done, pr: 1 }],
    ['done without commit', { ...done, commit: null }],
    ['done without files', { ...done, filesChanged: [] }],
    ['blocked without reason', { ...done, status: 'blocked', commit: null, notes: [] }],
    ['commit not a sha', { ...done, commit: 'HEAD' }],
    ['missing risk', { ...done, risk: undefined }],
    ['missing visual_proof', { ...done, visual_proof: undefined }],
    ['unknown risk level', { ...done, risk: { ...done.risk, level: 'extreme' } }],
    ['risk without backout', { ...done, risk: { level: 'low', what: 'x' } }],
    ['proof with only before', { ...done, visual_proof: { before: 'a.png' } }],
  ])('rejects %s', (_n, v) => {
    expect(validate(JSON.parse(JSON.stringify(v)))).toBe(false);
  });
});

describe('runner-contract.md', () => {
  const ref = read('references/runner-contract.md');

  it('states the input, the commit rule and the two prohibitions', () => {
    expect(ref).toMatch(/PBI or Bug issue body/);
    expect(ref).toMatch(/acceptance criteria/);
    expect(ref).not.toMatch(/Task/);
    expect(ref).toMatch(/worktree/);
    expect(ref).toContain('Refs #<nr>');
    expect(ref).toMatch(/Never call `gh`/);
    expect(ref).toMatch(/Never push/);
  });

  it('names every schema property', () => {
    for (const k of Object.keys(schema.properties)) expect(ref).toContain(`\`${k}\``);
  });

  it('names the proof directory and the rule never committed', () => {
    expect(ref).toContain('.agents/proof/<branch>/');
    expect(ref).toMatch(/never committed or staged/);
  });

  it('keeps the language dispatch and names no other state path', () => {
    expect(ref).toContain('<lang>-implementation');
    expect(ref.replace('.agents/proof/<branch>/', '')).not.toMatch(/\.agents|\.dromos|<state>/);
    expect(read('SKILL.md')).toMatch(/Language dispatch[\s\S]*detect-techstack/);
  });

  it('SKILL.md links the reference and the schema and stays within 100 lines', () => {
    const skill = read('SKILL.md');
    expect(skill).toContain('references/runner-contract.md');
    expect(skill).toContain('schema/implementer.schema.json');
    expect(skill.split('\n').length).toBeLessThanOrEqual(100);
  });
});
