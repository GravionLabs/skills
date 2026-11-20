import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from 'yaml';

const root = path.resolve(__dirname, '../../..');
const skill = path.join(root, 'skills/shared/ratchet');

describe('ratchet CI template (#805)', () => {
  const wf = parse(fs.readFileSync(path.join(skill, 'templates/ratchet.yml'), 'utf-8'));
  const steps: { uses?: string; run?: string }[] = wf.jobs.ratchet.steps;

  it('is valid YAML that runs on pull_request with read-only permissions', () => {
    expect(wf.on).toHaveProperty('pull_request');
    expect(wf.permissions).toEqual({ contents: 'read' });
  });

  it('checks out, sets up Node and calls the runner', () => {
    expect(steps.some((s) => s.uses?.startsWith('actions/checkout@'))).toBe(true);
    expect(steps.some((s) => s.uses?.startsWith('actions/setup-node@'))).toBe(true);
    expect(steps.some((s) => s.run === 'node scripts/ratchets/run-ratchets.mts')).toBe(true);
  });

  it('is named in SKILL.md', () => {
    expect(fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf-8')).toContain(
      'templates/ratchet.yml',
    );
  });
});
