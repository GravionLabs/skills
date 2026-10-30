import * as fs from 'fs';
import * as path from 'path';

const packages = path.resolve(__dirname, '../../../skills');
const read = (rel: string) => fs.readFileSync(path.join(packages, rel), 'utf-8');
const skill = 'setup-biome-husky';

describe('Biome setup (#556)', () => {
  it('the template matches the hub conventions', () => {
    const cfg = JSON.parse(read(`${skill}/templates/biome.json.template`));
    expect(cfg.formatter).toMatchObject({ indentStyle: 'space', indentWidth: 2, lineWidth: 100 });
    expect(cfg.javascript.formatter).toMatchObject({
      quoteStyle: 'single',
      semicolons: 'always',
      trailingCommas: 'all',
    });
  });

  it('the setup script refuses Angular projects and keeps an existing biome.json', () => {
    const s = read(`${skill}/scripts/Setup-Biome.ps1`);
    expect(s).toContain("Test-Path 'angular.json'");
    expect(s).toContain('biome.json exists, kept.');
  });

  it('ts skills point to Biome, ng skills state the Prettier choice', () => {
    expect(read('ts-create-project/SKILL.md')).toContain('`setup-biome-husky`');
    expect(read('ts-implementation/SKILL.md')).toContain('`setup-biome-husky`');
    expect(read('ng-implementation/SKILL.md')).toContain('Angular stays on Prettier');
    expect(read('ng-create-project/SKILL.md')).toContain('Angular stays on Prettier');
  });
});
