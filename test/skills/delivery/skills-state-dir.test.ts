import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { groupSkills } from '../../helpers/marketplace';

const root = path.resolve(__dirname, '../../../skills');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

describe('delivery and shared skills keep no state under .agents/', () => {
  const files = [
    ...['delivery', 'shared'].flatMap((group) =>
      groupSkills(group).flatMap((s) => walk(path.join(root, group, s))),
    ),
  ].filter((f) => /\.(md)$/.test(f));

  it('has no .agents state path except the .agents/skills install dir', () => {
    const offenders = files.filter((f) =>
      /\.agents(?!\/skills)/.test(
        fs
          .readFileSync(f, 'utf8')
          .replace(
            /\.opencode\|\.agents\||~\/\.agents|\.agents\/(format|config)\.json|\.agents\/lessons[./*a-z]*|\.agents\/\*|\.agents\/state\/review-<nr>\.json|\.agents\/deliver-loop[./<>a-z]*|subagents\.agents\.general-purpose\.model|ui\.sidebar\.agents/g,
            '',
          ),
      ),
    );
    expect(offenders).toEqual([]);
  });
});

describe('state-dir allowlist (#53)', () => {
  const allow = /\.agents\/state\/review-<nr>\.json/;
  it('admits only the review result file under .agents/state', () => {
    expect(allow.test('.agents/state/review-<nr>.json')).toBe(true);
    expect(allow.test('.agents/state/other.json')).toBe(false);
  });
});
