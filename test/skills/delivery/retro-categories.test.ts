import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const file = path.resolve(__dirname, '../../../skills/retro/references/categories.md');
const text = fs.readFileSync(file, 'utf8');

describe('retro categories.md', () => {
  it('names no removed ledger artefact', () => {
    for (const term of ['Escalation:', 'Ruling:', 'costEstimated', 'working-mode.md', '/clear']) {
      expect(text).not.toContain(term);
    }
  });

  it('keeps categories 1-7 and model per role as 8', () => {
    for (let n = 1; n <= 8; n++) {
      expect(text).toMatch(new RegExp(`^${n}\\. \\*\\*`, 'm'));
    }
    expect(text).toMatch(/^8\. \*\*Model per role\*\*.*agentlens/m);
    expect(text).not.toMatch(/^(9|10)\. /m);
  });

  it('keeps the fix-round metric line', () => {
    expect(text).toContain('Fix rounds above 1 per PBI');
  });
});
