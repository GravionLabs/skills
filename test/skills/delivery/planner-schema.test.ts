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
      if (typeof b === 'string' && !b.includes('#') && !ids.has(b))
        errors.push(`dangling ${b} in ${it.id}`);
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
  const repos = [
    plan.parent_repo,
    ...plan.items.flatMap((it: any) => [
      it.repo,
      ...it.blocked_by.filter((b: any) => typeof b === 'string' && b.includes('#')),
      ...(it.requires ?? []),
    ]),
  ].filter(Boolean);
  if (new Set(repos.map((r: string) => r.split('/')[0])).size > 1) errors.push('owner differs');
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

  it('has no instruction to close, edit or create an issue and no merged-children lines', () => {
    expect(md).not.toMatch(/gh issue (close|edit|create)|\bclose them\b/);
    expect(md).not.toContain('already merged');
    expect(md).not.toContain('#<task>');
  });
});

describe('objective plans across repositories (#541)', () => {
  const objective = () => ({
    ...clone(),
    parent_issue: 3,
    parent_repo: 'GravionLabs/telos',
    input_type: 'objective',
    level: 'feature',
    questions: [],
    items: [
      { ...item('p1'), title: 'CI event format v2', repo: 'GravionLabs/ci' },
      {
        ...item('p2', ['p1', 'GravionLabs/ci#12']),
        title: 'Panel reads event format v2',
        repo: 'GravionLabs/skills',
        requires: ['GravionLabs/ci@M004 rc', 'GravionLabs/ci@M003.1 released'],
      },
    ],
  });

  it('accepts an objective plan with repo, requires and a cross-repo blocker', () => {
    expect(check(objective())).toEqual([]);
  });

  it('keeps repo optional outside an objective plan', () => {
    const p = clone();
    p.items[0].repo = 'GravionLabs/ci';
    expect(check(p)).toEqual([]);
    expect(check(clone())).toEqual([]);
  });

  it.each([
    ['an item without repo', (p: any) => delete p.items[0].repo],
    ['no parent_repo', (p: any) => delete p.parent_repo],
    ['level pbi', (p: any) => (p.level = 'pbi')],
    ['a repo without owner', (p: any) => (p.items[0].repo = 'ci')],
    ['requires without state', (p: any) => (p.items[1].requires = ['GravionLabs/ci@M004'])],
    [
      'requires with an unknown state',
      (p: any) => (p.items[1].requires = ['GravionLabs/ci@M004 merged']),
    ],
    ['requires without milestone', (p: any) => (p.items[1].requires = ['GravionLabs/ci rc'])],
    ['requires with a legacy issue ref', (p: any) => (p.items[1].requires = ['GravionLabs/ci#12'])],
    [
      'a duplicate requires entry',
      (p: any) => (p.items[1].requires = ['GravionLabs/ci@M004 rc', 'GravionLabs/ci@M004 rc']),
    ],
    ['a blocker ref without number', (p: any) => (p.items[1].blocked_by = ['GravionLabs/ci#'])],
  ])('rejects %s', (_name, mutate) => {
    const p = objective();
    mutate(p);
    expect(check(p)).toContain('schema');
  });

  it.each([
    ['an item repo', (p: any) => (p.items[0].repo = 'other/ci')],
    ['a requires entry', (p: any) => (p.items[1].requires = ['other/ci@M004 rc'])],
    ['a cross-repo blocker', (p: any) => (p.items[1].blocked_by = ['other/ci#12'])],
  ])('rejects another owner in %s', (_name, mutate) => {
    const p = objective();
    mutate(p);
    expect(check(p)).toEqual(['owner differs']);
  });

  it('plan-schema.md documents repo, requires, parent_repo and the same-owner rule', () => {
    for (const f of ['`items[].repo`', '`items[].requires[]`', '`parent_repo`', '`objective`'])
      expect(doc).toContain(f);
    expect(doc).toMatch(/Same owner: every `items\[\]\.repo`/);
    expect(schema.properties.input_type.enum).toContain('objective');
  });

  it('SKILL.md maps an Objective to Features with repo and grills via grill-me', () => {
    const md = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8');
    const row = md.split('\n').find((l) => l.startsWith('| Objective'))!;
    expect(row).toContain('`[Feature] …`');
    expect(row).toContain('`repo`');
    expect(row).toContain('`grill-me`');
  });

  it('create-from-plan.md creates in the item repo, links the foreign parent and sets cross-repo blockers', () => {
    const cfp = fs.readFileSync(
      path.resolve(__dirname, '../../../skills/github/github-issue/references/create-from-plan.md'),
      'utf-8',
    );
    expect(cfp).toContain('gh issue create --repo <repo>');
    expect(cfp).toContain(
      'repos/<parent_repo>/issues/<parent_issue>/sub_issues -F sub_issue_id=$childId',
    );
    expect(cfp).toContain('gh api repos/<blocker-repo>/issues/<n> --jq .id');
    expect(cfp).toContain('`Requires: <entry>`');
    expect(cfp).toContain('-Mode assign -Repo <repo>');
    expect(cfp).toMatch(/another owner → stop/);
  });
});
