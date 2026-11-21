import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

describe('rust gate mapping and review rules', () => {
  it('gate.md lists the Rust gate commands', () => {
    const rust = read('skills/shared/implementation/references/gate.md')
      .split('\n')
      .find((l) => l.startsWith('| Rust '))!;
    expect(rust).toContain('cargo fmt --check');
    expect(rust).toContain('cargo clippy --all-targets --all-features -- -D warnings');
    expect(rust).toContain('cargo deny check');
    expect(rust).toContain('cargo test');
  });

  it('review rules cover allow, missing reason and panics outside tests', () => {
    const text = read('skills/rust/rust-implementation/SKILL.md');
    const rules = text.slice(text.indexOf('## Review rules'));
    expect(rules).toMatch(/🟡 `#\[allow\(\.\.\.\)\]`[^\n]*🔴[^\n]*-D warnings/);
    expect(rules).toMatch(/🟡[^\n]*`#\[expect\]` without a `reason`/);
    expect(rules).toMatch(/🔴 `unwrap\(\)`\/`expect\(\)`\/`panic!` outside tests/);
    expect(rules).toContain('cargo deny check');
    expect(text.split('\n').length).toBeLessThanOrEqual(100);
  });
});
