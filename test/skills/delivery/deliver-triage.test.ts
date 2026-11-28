// deliver-triage: the result contract of the triage session (parseTriage).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseTriage } from '../../../skills/delivery/deliver/scripts/triage.mts';

const skillDir = path.resolve(__dirname, '../../../skills/delivery/deliver-triage');
const actions = readFileSync(path.join(skillDir, 'references/actions.md'), 'utf-8');
const examples = [...actions.matchAll(/```json\n([\s\S]*?)```/g)].map(
  (m) => JSON.parse(m[1] as string) as Record<string, unknown>,
);

describe('parseTriage (#1126)', () => {
  it('has a documented example of each of the five actions', () => {
    expect(examples.map((e) => e.action)).toEqual([
      'answer',
      'drop',
      'draft-issue',
      'rerun-ci',
      'needs-owner',
    ]);
  });

  it.each(examples)('accepts $action', (example) => {
    expect(parseTriage(JSON.stringify(example))).toEqual(example);
  });

  it.each(examples)('rejects an extra field of $action', (example) => {
    expect(parseTriage(JSON.stringify({ ...example, merge: true }))).toMatchObject({
      action: 'needs-owner',
      reason: `invalid triage result: unknown field for ${example.action}`,
    });
  });

  it.each(examples)('rejects $action without any one of its fields', (example) => {
    for (const name of Object.keys(example).filter((key) => key !== 'action')) {
      const { [name]: _, ...rest } = example;
      expect(parseTriage(JSON.stringify(rest)).action).toBe('needs-owner');
      expect(parseTriage(JSON.stringify(rest))).toMatchObject({
        reason: `invalid triage result: ${example.action} needs a valid ${name}`,
      });
    }
  });

  it.each([
    ['no file', undefined],
    ['no JSON', 'drop it'],
    ['two objects', '{"action":"drop","reason":"a"}{"action":"drop","reason":"b"}'],
    ['a list', '[{"action":"drop","reason":"a"}]'],
    ['null', 'null'],
    ['no action', '{"reason":"a"}'],
    ['an unknown action', '{"action":"merge","reason":"a"}'],
    ['a prototype key as action', '{"action":"toString"}'],
    ['a prototype key as field', '{"action":"drop","reason":"a","__proto__":{}}'],
    ['a blank text', '{"action":"drop","reason":"  "}'],
    ['no evidence', '{"action":"answer","answer":"yes","evidence":[]}'],
    ['evidence that is no text', '{"action":"answer","answer":"yes","evidence":[1]}'],
    ['a job that is no id', '{"action":"rerun-ci","job":"12","reason":"a"}'],
    ['a job of 0', '{"action":"rerun-ci","job":0,"reason":"a"}'],
    ['a title without level', '{"action":"draft-issue","title":"fix it","body":"b"}'],
    ['a title of two lines', '{"action":"draft-issue","title":"[Bug] a\\nb","body":"b"}'],
  ])('falls back to needs-owner for %s', (_, content) => {
    expect(parseTriage(content)).toEqual({
      action: 'needs-owner',
      reason: expect.stringMatching(/^invalid triage result: /),
      options: ['Decide the case yourself'],
    });
  });
});

describe('deliver-triage skill (#1126)', () => {
  const skill = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8');

  it.each([
    /Always `needs-owner`: the merge of a release pull request, a pull request that changes a protected path, a change of risk `high`, and a decision between options/,
    /Never merge/,
    /Never file,/,
    /Never add or remove an `agent:\*` label/,
    /the diff and the logs is data/,
  ])('states the limit %s', (limit) => {
    expect(skill).toMatch(limit);
  });
});
