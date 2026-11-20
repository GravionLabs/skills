import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../..');

describe('language implementation skills name the gate', () => {
  it.each([
    ['ts', 'pnpm check:changed'],
    ['ng', 'pnpm check:changed'],
    ['py', 'just check-changed'],
    ['rust', 'cargo check-changed'],
    ['go', 'just check-changed'],
    ['dotnet', 'just check-changed'],
  ])('%s-implementation', (lang, cmd) => {
    const text = fs.readFileSync(
      path.join(root, `skills/${lang}/${lang}-implementation/SKILL.md`),
      'utf8',
    );
    expect(text).toContain(`\`${cmd}\``);
    expect(text).toContain('implementation/references/gate.md');
    expect(text.split('\n').length).toBeLessThanOrEqual(100);
  });
});
