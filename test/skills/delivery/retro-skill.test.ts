import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const text = fs.readFileSync(
  path.resolve(__dirname, '../../../skills/delivery/retro/SKILL.md'),
  'utf8',
);

describe('retro SKILL.md', () => {
  it('gathers figures with agentlens and gh and names no dromos', () => {
    expect(text).toContain('agentlens cost --by issue --format json');
    expect(text).toContain('gh pr view');
    expect(text).not.toMatch(/dromos/i);
    expect(text).not.toContain('phase.finished');
  });

  it('marks estimates, handles a missing agentlens and repeated findings', () => {
    expect(text).toContain('`~`');
    expect(text).toMatch(/`agentlens` missing or failing[^\n]*not measured/);
    expect(text).toMatch(/same file and title in two or more PRs/);
  });

  it('takes escalation lines from the deliver report', () => {
    expect(text).toMatch(/Escalation lines[^\n]*final report of `deliver`/);
    expect(text).toContain('"no run report"');
  });

  it('names the source of every column in references/metrics-sources.md', () => {
    const ref = fs.readFileSync(
      path.resolve(__dirname, '../../../skills/delivery/retro/references/metrics-sources.md'),
      'utf8',
    );
    expect(text).toContain('references/metrics-sources.md');
    for (const col of [
      'cost',
      'main peak',
      'requests',
      'roles by cost',
      'review rounds',
      'fix rounds',
      'CI',
    ]) {
      expect(ref).toContain(col);
    }
    expect(ref).not.toMatch(/dromos/i);
  });

  it('stays within 100 lines', () => {
    expect(text.split('\n').length).toBeLessThanOrEqual(100);
  });

  it('keeps the seven columns and the approval rule', () => {
    expect(text).toContain('exactly these seven columns');
    expect(text).toContain("without the user's approval");
  });

  it('has draft PBIs name the skill file and the rule', () => {
    expect(text).toMatch(/names the skill file[^\n]*the rule to change/);
  });

  it('names no ledger artefact', () => {
    for (const term of ['<state>', 'ledger', 'Get-RunMetrics']) {
      expect(text).not.toContain(term);
    }
  });
});
