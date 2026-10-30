import * as fs from 'fs';
import * as path from 'path';

import { groupSkills } from '../../helpers/marketplace';

const root = path.resolve(__dirname, '../../..');
const pkg = path.join(root, 'skills', 'rust');
const skills = ['rust-implementation', 'rust-test'];
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('rust group', () => {
  it('rust-test description explains purpose, not just keywords', () => {
    const text = read('skills/rust/rust-test/SKILL.md');
    expect(/^description: (.*)$/m.exec(text)![1].length).toBeGreaterThan(60);
  });

  it('README knows rust', () => {
    expect(read('README.md')).toMatch(/^\| `rust`\s+\| `rust-implementation`, `rust-test`/m);
  });

  it.each(skills)('%s has valid frontmatter and size', (name) => {
    const text = fs.readFileSync(path.join(pkg, '.', name, 'SKILL.md'), 'utf8');
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    expect(fm).not.toBeNull();
    expect(fm![1]).toMatch(new RegExp(`^name: ${name}$`, 'm'));
    expect(fm![1]).toMatch(/^description:/m);
    expect(text.split('\n').length).toBeLessThanOrEqual(100);
  });

  it('rust-implementation has Review rules and clippy/rustfmt/unsafe/thiserror/anyhow guidance', () => {
    const dir = path.join(pkg, 'rust-implementation');
    const text = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
    expect(text).toMatch(/^## Review rules$/m);
    expect(text).toContain('-D warnings');
    expect(text).toContain('rustfmt');
    const refs = fs.readFileSync(path.join(dir, 'references/conventions.md'), 'utf8');
    for (const word of ['thiserror', 'anyhow', 'unsafe', 'tokio']) expect(refs).toContain(word);
  });

  it('rust-test covers cargo test, nextest, mockall and proptest', () => {
    const dir = path.join(pkg, 'rust-test');
    const text = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
    expect(text).toContain('cargo test');
    expect(text).toContain('nextest');
    expect(text).toContain('#[cfg(test)]');
    const refs = fs.readFileSync(path.join(dir, 'references/mocking-and-properties.md'), 'utf8');
    expect(refs).toContain('mockall');
    expect(refs).toContain('proptest');
    expect(refs).toContain('use mockall::predicate::eq;');
    expect(refs).toContain('`#[async_trait]` above `#[automock]`');
    expect(text).toContain('tests/*.rs');
  });

  it('manifest lists exactly the skills on disk and every referenced file exists', () => {
    expect(groupSkills('rust').sort()).toEqual([...skills].sort());
    let refCount = 0;
    for (const name of skills) {
      const text = read(`skills/rust/${name}/SKILL.md`);
      for (const m of text.matchAll(/`(references\/[\w.-]+)`/g)) {
        refCount++;
        expect(fs.existsSync(path.join(pkg, '.', name, m[1]))).toBe(true);
      }
    }
    expect(refCount).toBeGreaterThanOrEqual(2);
  });

  it('is a group of marketplace.json and of the installer groups', () => {
    const groups = JSON.parse(read('skills/delivery/skills-install/scripts/groups.json'));
    expect(groups.rust).toEqual([...skills].sort());
  });

  describe('Tauri conventions', () => {
    const impl = () => read('skills/rust/rust-implementation/SKILL.md');
    const ref = () => read('skills/rust/rust-implementation/references/tauri.md');

    it('rust-implementation loads the reference only for framework tauri', () => {
      const line = impl()
        .split('\n')
        .find((l) => l.includes('references/tauri.md'))!;
      expect(line).toContain('frameworks: ["tauri"]');
      expect(line).toContain('`references/tauri.md`');
      expect(impl().match(/references\/tauri\.md/g)).toHaveLength(1);
    });

    it('detect-techstack reports tauri as a framework', () => {
      const dt =
        read('skills/shared/detect-techstack/SKILL.md') +
        fs
          .readdirSync(path.join(root, 'skills/shared/detect-techstack'), {
            recursive: true,
          })
          .filter((f) => String(f).endsWith('.md'))
          .map((f) => read(`skills/shared/detect-techstack/${f}`))
          .join('');
      expect(dt).toContain('tauri');
    });

    it('tauri.md has a section per required topic', () => {
      for (const h of [
        /^## Commands$/m,
        /^## Events vs commands$/m,
        /^## Capabilities and permissions/m,
        /^## Plugins$/m,
        /^## Layout and separation$/m,
        /^## Tauri 1 vs 2$/m,
      ])
        expect(ref()).toMatch(h);
      expect(ref()).toContain('tauri::State');
      expect(ref()).toContain('thiserror');
      expect(ref()).toContain('src-tauri/capabilities');
      expect(ref()).toContain('untrusted');
    });

    it('rust-test names the command strategy conditionally and delegates frontend to ts-test', () => {
      const t = read('skills/rust/rust-test/SKILL.md');
      const line = t.split('\n').find((l) => l.includes('tauri::test'))!;
      expect(line).toContain('frameworks: ["tauri"]');
      expect(line).toContain('pure functions');
      expect(line).toContain('`ts-test`');
    });
  });
});
