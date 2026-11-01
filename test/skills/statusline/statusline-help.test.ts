import * as fs from 'fs';
import * as path from 'path';
import { expectSkillHelp } from '../../helpers/skill-help';

const SKILL = path.resolve(__dirname, '../../../skills/statusline/context-statusline');

describe('context-statusline help', () => {
  it('follows the help convention', () => {
    expectSkillHelp(SKILL);
  });

  it('covers the installer clients, Node version and update path', () => {
    const help = fs.readFileSync(path.join(SKILL, 'references/help.md'), 'utf8');
    for (const t of [
      '-Client claude|copilot|all',
      'Node >= 22',
      'settings.json',
      'npx skills update',
    ]) {
      expect(help).toContain(t);
    }
  });

  it('is mentioned in the docs page', () => {
    const doc = fs.readFileSync(
      path.resolve(__dirname, '../../../docs/usage/statusline.md'),
      'utf8',
    );
    expect(doc).toContain('/context-statusline help');
  });
});
