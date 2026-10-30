import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv/dist/2020';

const skillDir = path.resolve(__dirname, '../../../skills/delivery/planner');
const refs = path.join(skillDir, 'references');
const schema = JSON.parse(fs.readFileSync(path.join(skillDir, 'schema/plan.schema.json'), 'utf-8'));
const doc = fs.readFileSync(path.join(refs, 'plan-schema.md'), 'utf-8');
const example = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(doc)![1]);

const ajv = new Ajv({ allErrors: true });
const validateSchema = ajv.compile(schema);

/** Graph invariants JSON Schema cannot express. Returns error strings. */
function graphErrors(plan: any): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const it of plan.items) {
    if (ids.has(it.id)) errors.push(`duplicate id ${it.id}`);
    ids.add(it.id);
  }
  for (const it of plan.items) {
    for (const b of it.blocked_by) {
      if (typeof b === 'string' && !ids.has(b)) errors.push(`dangling ${b} in ${it.id}`);
      if (b === it.id) errors.push(`self reference ${it.id}`);
    }
  }
  for (const q of plan.questions) {
    if (!q.options.includes(q.recommended)) errors.push(`${q.id}: recommended not in options`);
    for (const b of q.blocks) if (!ids.has(b)) errors.push(`dangling ${b} in ${q.id}`);
  }
  const state = new Map<string, number>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    const it = plan.items.find((i: any) => i.id === id);
    for (const b of it?.blocked_by ?? []) {
      if (typeof b === 'string' && ids.has(b) && visit(b)) return true;
    }
    state.set(id, 2);
    return false;
  };
  if ([...ids].some(visit)) errors.push('cycle');
  return errors;
}

const check = (plan: any) => [...(validateSchema(plan) ? [] : ['schema']), ...graphErrors(plan)];

const clone = () => structuredClone(example);
const item = (id: string, blocked_by: any[] = []) => ({ ...clone().items[0], id, blocked_by });

describe('plan.json schema', () => {
  it('accepts the example from plan-schema.md', () => {
    expect(check(example)).toEqual([]);
  });

  it('requires tier and rejects model', () => {
    const p = clone();
    expect(p.items[0].tier).toBe('standard');
    expect(p.items[0].model).toBeUndefined();
    p.items[0].model = 'sonnet';
    expect(check(p)).toContain('schema');
    const noTier = clone();
    delete noTier.items[0].tier;
    expect(check(noTier)).toContain('schema');
  });

  it.each(['fast', 'standard', 'strong'])('accepts tier %s', (tier) => {
    const p = clone();
    p.items[0].tier = tier;
    expect(check(p)).toEqual([]);
  });

  it.each(['haiku', 'sonnet', 'inherit', 'opus'])('rejects tier %s', (tier) => {
    const p = clone();
    p.items[0].tier = tier;
    expect(check(p)).toContain('schema');
  });

  it('plan-schema.md documents the legacy model migration', () => {
    expect(doc).toMatch(/`haiku` to `fast`, `sonnet` to `standard`, `inherit` to `strong`/);
  });

  it('rejects a dangling blocked_by id', () => {
    const p = clone();
    p.items[0].blocked_by = ['p9'];
    expect(check(p).join()).toContain('dangling p9');
  });

  it('rejects a cycle', () => {
    const p = clone();
    p.items = [item('p1', ['p2']), item('p2', ['p1'])];
    p.questions = [];
    expect(check(p)).toContain('cycle');
  });

  it('accepts integer blockers (existing issues)', () => {
    const p = clone();
    p.items[0].blocked_by = [42];
    expect(check(p)).toEqual([]);
  });

  it('rejects recommended not in options', () => {
    const p = clone();
    p.questions[0].recommended = 'other';
    expect(check(p)).toContain('q1: recommended not in options');
  });

  it('rejects fewer than 2 options', () => {
    const p = clone();
    p.questions[0].options = ['drop now'];
    p.questions[0].recommended = 'drop now';
    expect(check(p)).toContain('schema');
  });

  it('rejects duplicate ids', () => {
    const p = clone();
    p.items = [item('p1'), item('p1')];
    p.questions = [];
    expect(check(p)).toContain('duplicate id p1');
  });

  it('requires why on every question', () => {
    const p = clone();
    delete p.questions[0].why;
    expect(check(p)).toContain('schema');
  });

  it('rejects an issue field on an item', () => {
    const p = clone();
    p.items[0].issue = null;
    expect(check(p)).toContain('schema');
  });

  it('accepts empty blocks', () => {
    const p = clone();
    p.questions[0].blocks = [];
    expect(check(p)).toEqual([]);
  });

  it('plan-schema.md names every top-level property of the schema', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    for (const prop of Object.keys(schema.properties)) expect(doc).toContain(`\`${prop}`);
  });

  it('requires assumptions as a list of strings', () => {
    const p = clone();
    expect(p.assumptions.length).toBeGreaterThan(0);
    p.assumptions = [1];
    expect(check(p)).toContain('schema');
    delete p.assumptions;
    expect(check(p)).toContain('schema');
  });

  it('rejects level task (#890)', () => {
    const p = clone();
    p.level = 'task';
    expect(check(p)).toContain('schema');
  });

  it('accepts a PBI split into sibling PBIs and an empty plan for a PBI that fits (#890)', () => {
    const split = clone();
    split.input_type = 'pbi';
    split.parent_issue = 890;
    split.items = [item('p1'), item('p2', ['p1'])];
    split.questions = [];
    expect(check(split)).toEqual([]);
    const fits = { ...clone(), input_type: 'bug', items: [], questions: [] };
    expect(check(fits)).toEqual([]);
  });

  it('plan-schema.md names no file path and no publish step', () => {
    expect(doc).not.toMatch(/<state>|publish/i);
    expect(doc).not.toMatch(/plan\.json`? (is )?written/i);
  });
});

describe('planner references', () => {
  const skill = path.resolve(refs, '..');
  const questions = fs.readFileSync(path.join(refs, 'questions.md'), 'utf-8');

  it('has no publish.md and no grilling.md', () => {
    expect(fs.existsSync(path.join(refs, 'publish.md'))).toBe(false);
    expect(fs.existsSync(path.join(refs, 'grilling.md'))).toBe(false);
  });

  it('questions.md names every question field', () => {
    for (const f of ['id', 'question', 'options[]', 'recommended', 'why']) {
      expect(questions).toContain(`\`${f}\``);
    }
  });

  it('SKILL.md references questions.md and no state path', () => {
    const md = fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf-8');
    expect(md).toContain('references/questions.md');
    expect(md).not.toMatch(/<state>|publish\.md|grilling\.md/);
  });

  it('the interactive path names grill-me, create-from-plan and refine; non-interactive stays data', () => {
    const md = fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf-8');
    const interactive = md.slice(md.indexOf('\n## Interactive'), md.indexOf('\n## Refine'));
    expect(interactive).toContain('`grill-me`');
    expect(interactive).toContain('create-from-plan.md');
    expect(interactive).not.toMatch(/Task breakdown/);
    expect(md.slice(md.indexOf('\n## Refine'), md.indexOf('\n## Depth'))).toContain('`grill-me`');
    expect(md).toMatch(/\*\*Non-interactive\*\*.*no questions.*`questions\[\]` as data/);
    expect(fs.readdirSync(refs).filter((f) => /question/.test(f))).toEqual(['questions.md']);
  });
});

describe('planner output level without Task issues (#890)', () => {
  const md = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8');
  const level = md.slice(md.indexOf('\n## Output level'), md.indexOf('\n## Steps'));
  const row = level.split('\n').find((l) => l.startsWith('| PBI or bug'))!;

  it('a PBI or Bug yields no tasks: refine, or a split into sibling PBIs when too big', () => {
    expect(row).toContain('`refine <nr>`');
    expect(row).toMatch(/size L or more than one session/);
    expect(row).toMatch(/sibling PBIs under the same Feature/);
    expect(row).not.toMatch(/\btasks?\b|\[Task\]/);
  });

  it('description only keeps internal steps without issues', () => {
    expect(level).toMatch(/\| Description only \| internal steps .*no issues/);
  });

  it('never creates [Task] issues and has no Task breakdown', () => {
    expect(level).toContain('No plan creates `[Task]` issues');
    expect(md).not.toMatch(/Task breakdown|task-issues/);
    expect(doc).not.toMatch(/`chore: …` for `task`|Task issue body/);
  });
});

describe('planner without removed dependencies', () => {
  const skill = path.resolve(refs, '..');
  const md = fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf-8');

  it('names no model-policy and dispatches no explorer agent', () => {
    expect(md + doc).not.toMatch(/model-policy|subagent_type: explorer/);
    expect(md).not.toMatch(/`explorer` agent/);
  });

  it('defines the three tiers inline in plan-schema.md', () => {
    const tiers = doc.slice(doc.indexOf('## Tiers'));
    for (const t of ['fast', 'standard', 'strong']) expect(tiers).toContain(`\`${t}\``);
  });

  it('has no instruction to close, edit or create an issue and reports merged children', () => {
    expect(md).not.toMatch(/gh issue (close|edit|create)|\bclose them\b/);
    expect(md).toContain('already merged: #<nr>');
    expect(md).not.toContain('#<task>');
  });
});
