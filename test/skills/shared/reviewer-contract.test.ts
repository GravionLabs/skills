import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv/dist/2020';

const skillDir = path.resolve(__dirname, '../../../skills/shared/code-review');
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

describe('governance rules of code-review', () => {
  const rules = read('references/governance.md');

  it('accepts the optional rule on a blocking item and rejects other values', () => {
    expect(validate({ blocking: [{ ...finding, rule: 'adr-missing' }], notes: [] })).toBe(true);
    expect(validate({ blocking: [{ ...finding, rule: 'spec-drift' }], notes: [] })).toBe(true);
    expect(validate({ blocking: [{ ...finding, rule: 'other' }], notes: [] })).toBe(false);
  });

  it('names the rule in the reviewer contract', () => {
    const ref = read('references/reviewer-contract.md');
    expect(ref).toContain('`rule`');
    expect(ref).toContain('adr-missing');
    expect(ref).toContain('spec-drift');
  });

  it('points at governance.md in one line and stays within 100 lines', () => {
    const skill = read('SKILL.md');
    expect(skill.split('\n').filter((l) => l.includes('references/governance.md'))).toHaveLength(1);
    expect(skill).toMatch(/`governance`/);
    expect(skill.split('\n').length).toBeLessThanOrEqual(100);
  });

  it('states the adr-missing and spec-drift rules', () => {
    expect(rules).toContain('Get-GovernanceMatches.ps1');
    expect(rules).toContain('[-Head <ref>]');
    expect(rules).toMatch(/## adr-missing[\s\S]*blocking[\s\S]*`skipLabels`/);
    expect(rules).toMatch(/## spec-drift[\s\S]*`specMode: require`[\s\S]*\*\*note\*\*/);
    expect(rules).toContain('no spec change needed: <that spec>');
  });
});

describe('rule proposal', () => {
  const shared = path.resolve(__dirname, '../../../skills/shared');
  const skill = read('SKILL.md');
  const proposal = read('references/rule-proposal.md');
  const contract = fs.readFileSync(path.join(shared, 'lessons/references/contract.md'), 'utf-8');

  it('code-review names the proposal and links the skill and reference', () => {
    expect(skill).toContain('propose ast-grep rule');
    expect(skill).toContain('references/rule-proposal.md');
    expect(skill).toContain('ast-grep-rules');
    expect(skill.split('\n').length).toBeLessThanOrEqual(100);
    expect(proposal).toContain('propose ast-grep rule');
    expect(proposal).toContain('ast-grep-rules');
    expect(proposal).toMatch(/Why: .* Instead: .* See #/);
  });

  it('the lessons contract documents the rule pointer', () => {
    expect(contract).toContain('rule: <rule id>');
    expect(contract).toContain('ast-grep-rules');
    expect(contract).toMatch(/candidate to retire/);
  });

  it('keeps the reviewer result schema to blocking, notes and the optional spec', () => {
    expect(Object.keys(schema.properties).sort()).toEqual(['blocking', 'notes', 'spec']);
  });
});

describe('UX review of a UI diff', () => {
  const ref = read('references/ux-review.md');
  const skill = read('SKILL.md');
  const exts = ['.html', '.css', '.scss', '.tsx', '.jsx', '.vue', '.svelte', '*.component.ts'];

  it('SKILL.md step and reference name the extensions, the reference and the rubric path', () => {
    for (const e of exts) {
      expect(skill).toContain('`' + e + '`');
      expect(ref).toContain('`' + e + '`');
    }
    expect(skill).toContain('references/ux-review.md');
    expect(ref).toContain('docs/styleguide/ux-review-rubric.md');
    expect(ref).toContain('ui-styleguide');
    expect(skill.split('\n').length).toBeLessThanOrEqual(100);
  });

  it('the reference lists the five rubric headings under Notes', () => {
    for (const h of [
      'Top fixes',
      'Friction notes',
      'Suggested changes',
      'Keyboard and speed check',
      'Follow-up states (loading, empty, error, partial)',
    ]) {
      expect(ref).toContain('### ' + h);
    }
    expect(ref).toContain('## Notes');
  });

  it('the eval case for a UI diff exists', () => {
    const evals = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../evals/skill-triggers.json'), 'utf-8'),
    );
    const cr = evals.find((e: { skill: string }) => e.skill === 'code-review');
    expect(cr.shouldTrigger.some((q: string) => /component\.ts/.test(q))).toBe(true);
  });
});

describe('spec section', () => {
  const skill = read('SKILL.md');
  const ref = read('references/reviewer-contract.md');
  const item = {
    kind: 'unrequested',
    criterion: 'none',
    file: 'src/a.ts',
    detail: 'adds a retry nobody asked for',
  };

  it('keeps old results without spec valid and requires no spec', () => {
    expect(schema.required).toEqual(['blocking', 'notes']);
    expect(validate({ blocking: [], notes: [] })).toBe(true);
  });

  it.each(['missing', 'unrequested', 'wrong'])('accepts a %s item', (kind) => {
    expect(validate({ blocking: [], notes: [], spec: [{ ...item, kind }] })).toBe(true);
  });

  it.each([
    ['other kind', { ...item, kind: 'extra' }],
    ['no criterion', { ...item, criterion: undefined }],
    ['no detail', { ...item, detail: '' }],
    ['extra property', { ...item, line: 1 }],
  ])('rejects %s', (_n, v) => {
    expect(validate({ blocking: [], notes: [], spec: [JSON.parse(JSON.stringify(v))] })).toBe(
      false,
    );
  });

  it('SKILL.md has the Spec section, the rules and the source commit', () => {
    expect(skill).toMatch(/^## Spec$/m);
    expect(skill).toMatch(/`## Blocking`, `## Spec`.*`## Notes`/);
    expect(skill).toMatch(/\*\*unrequested\*\*.*note/);
    expect(skill).toContain('49dd158d1076134a641b33efb035946536778336');
    expect(skill.split('\n').length).toBeLessThanOrEqual(100);
  });

  it('the contract names every spec property and kind', () => {
    for (const k of [
      ...Object.keys(schema.properties.spec.items.properties),
      'missing',
      'unrequested',
      'wrong',
    ])
      expect(ref).toContain(`\`${k}\``);
  });

  it('deliver step 4 returns unrequested behavior', () => {
    const deliver = fs.readFileSync(
      path.resolve(__dirname, '../../../skills/delivery/deliver/SKILL.md'),
      'utf-8',
    );
    expect(deliver).toMatch(/unrequested behavior/);
  });

  it('the eval case: a diff with an unrequested change is reported as unrequested', () => {
    const fx = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../../evals/code-review/unrequested.json'),
        'utf-8',
      ),
    );
    expect(validate(fx.expected)).toBe(true);
    expect(fx.expected.blocking).toEqual([]);
    const [s] = fx.expected.spec;
    expect(s.kind).toBe('unrequested');
    expect(fx.diff).toContain(s.file);
    expect(fx.expected.notes.length).toBeGreaterThan(0);
  });

  describe('smell baseline', () => {
    const smells = read('references/smells.md');
    const names = [
      'Mysterious Name',
      'Duplicated Code',
      'Feature Envy',
      'Data Clumps',
      'Primitive Obsession',
      'Repeated Switches',
      'Shotgun Surgery',
      'Divergent Change',
      'Speculative Generality',
      'Message Chains',
      'Middle Man',
      'Refused Bequest',
    ];

    it('lists the twelve smells, each with a fix', () => {
      for (const n of names) expect(smells).toMatch(new RegExp(`\\*\\*${n}\\*\\* — .+ → .+`));
    });

    it('is loaded in step 5 and stays a note', () => {
      expect(skill).toMatch(/non-test file of the diff load `references\/smells\.md`/);
      expect(smells).toMatch(/always a \*\*note\*\*/);
      expect(smells).toContain('possible <smell>');
    });

    it('is suppressed by review rules and lessons and skipped for linted rules', () => {
      expect(smells).toMatch(/`## Review rules` entry .* or an approved lesson/);
      expect(smells).toMatch(/linter of the repository enforces/);
    });

    it('does not contradict step 10 (no abstractions without need)', () => {
      expect(skill).toMatch(/10\. Do not recommend patterns or abstractions/);
      expect(smells).toMatch(/step 10/);
      expect(smells).toMatch(/Speculative Generality/);
    });

    it('the eval case: duplicated logic is a note, not blocking', () => {
      const fx = JSON.parse(
        fs.readFileSync(
          path.resolve(__dirname, '../../../evals/code-review/duplicated-code.json'),
          'utf-8',
        ),
      );
      expect(validate(fx.expected)).toBe(true);
      expect(fx.expected.blocking).toEqual([]);
      expect(fx.expected.notes[0]).toMatch(/^possible Duplicated Code/);
    });
  });
});
