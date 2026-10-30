import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { groupSkills } from '../../helpers/marketplace';

const root = path.resolve(__dirname, '../../../skills');
const text = fs.readFileSync(path.join(root, 'delivery/grill-me/SKILL.md'), 'utf8');

describe('grill-me SKILL.md', () => {
  it('keeps the attribution to mattpocock/skills (MIT)', () => {
    expect(text).toContain('mattpocock/skills');
    expect(text).toContain('MIT License');
  });

  it('accepts an issue number, plan questions or a description', () => {
    expect(text).toContain('issue number');
    expect(text).toContain('questions[]');
    expect(text).toContain('free description');
  });

  it('never asks facts and asks in rounds with the recommended option first', () => {
    expect(text).toContain('Facts are never asked');
    expect(text).toContain('all independent open questions at once');
    expect(text).toContain('`recommended` option first');
    expect(text).toContain('"yes" accepts it');
  });

  it('uses AskUserQuestion with at most 4 per call and a plain-text fallback', () => {
    expect(text).toContain('`AskUserQuestion`, at most 4 questions per call');
    expect(text).toContain('numbered plain text');
  });

  it('defers only blocking questions with needs-decision', () => {
    expect(text).toContain('needs-decision');
    expect(text).toContain('Owner decision required');
  });

  it('writes answers under ## Decisions or returns the answered questions', () => {
    expect(text).toContain('## Decisions');
    expect(text).toContain('`<question> — <answer>`');
    expect(text).toContain('return the answered `questions[]`');
  });

  it('drops the ledger, publish and runner gate artefacts', () => {
    for (const term of ['progress.md', 'publish.md', 'orchestrator', 'Gate:', '<state>']) {
      expect(text).not.toContain(term);
    }
  });

  it('is listed in the delivery group of marketplace.json', () => {
    expect(groupSkills('delivery')).toContain('delivery/grill-me');
  });
});
