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
    const groups = JSON.parse(read('skills/delivery/skills-manage/scripts/groups.json'));
    expect(groups.rust).toEqual([...skills].sort());
  });

  describe('lint set', () => {
    const dir = 'skills/rust/rust-implementation';
    // Minimal TOML reader: [tables] and key = value lines (values kept as text).
    const parse = (text: string) => {
      const out: Record<string, Record<string, string>> = {};
      let table = '';
      for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const t = /^\[([\w.-]+)\]$/.exec(line);
        if (t) {
          table = t[1];
          out[table] ??= {};
          continue;
        }
        const kv = /^([\w-]+)\s*=\s*(.+)$/.exec(line);
        expect(kv, `invalid TOML line: ${line}`).not.toBeNull();
        expect(table).not.toBe('');
        out[table][kv![1]] = kv![2];
      }
      return out;
    };

    it('workspace-lints.toml has pedantic and the five restriction lints', () => {
      const t = parse(read(`${dir}/templates/workspace-lints.toml`));
      const clippy = t['workspace.lints.clippy'];
      expect(Object.keys(clippy).sort()).toEqual(
        [
          'allow_attributes',
          'allow_attributes_without_reason',
          'expect_used',
          'panic',
          'pedantic',
          'unwrap_used',
        ].sort(),
      );
      expect(clippy.pedantic).toMatch(/level = "warn".*priority = -1/);
      for (const k of ['unwrap_used', 'expect_used', 'panic', 'allow_attributes'])
        expect(clippy[k]).toBe('"warn"');
      expect(t['workspace.lints.rust'].unsafe_code).toBe('"forbid"');
    });

    it('clippy.toml allows unwrap, expect and panic in tests', () => {
      const text = read(`${dir}/templates/clippy.toml`);
      const keys = parse(`[t]\n${text}`).t;
      for (const k of ['unwrap', 'expect', 'panic', 'indexing-slicing'])
        expect(keys[`allow-${k}-in-tests`]).toBe('true');
      expect(text).toContain('# disallowed-methods');
      expect(text).toContain('# disallowed-types');
    });

    it('lints.md states the expect rule and is linked from SKILL.md and conventions.md', () => {
      const lints = read(`${dir}/references/lints.md`);
      expect(lints).toContain('#[expect(lint, reason = "…")]');
      expect(lints).toContain('unfulfilled_lint_expectations');
      expect(lints).toContain('cargo clippy --all-targets --all-features -- -D warnings');
      expect(read(`${dir}/SKILL.md`)).toContain('`references/lints.md`');
      expect(read(`${dir}/references/conventions.md`)).toContain('`lints.md`');
    });
  });

  describe('cargo-deny template', () => {
    const dir = 'skills/rust/rust-implementation';

    it('deny.toml has the four sections and the required keys', () => {
      const text = read(`${dir}/templates/deny.toml`);
      for (const t of ['graph', 'advisories', 'licenses', 'bans', 'sources'])
        expect(text).toMatch(new RegExp(`^\\[${t}\\]$`, 'm'));
      expect(text).toMatch(/^all-features = true$/m);
      expect(text).toMatch(/^version = 2$/m);
      expect(text).toMatch(/^wildcards = "deny"$/m);
      expect(text).toMatch(/^allow-wildcard-paths = true$/m);
      expect(text).toMatch(/^unknown-registry = "deny"$/m);
      expect(text).toMatch(/^unknown-git = "deny"$/m);
    });

    it('every ignore example has a reason and an expiry', () => {
      const files = ['templates/deny.toml', 'references/tauri.md', 'references/deny.md'];
      let count = 0;
      for (const f of files)
        for (const m of read(`${dir}/${f}`).matchAll(/\{ id = "RUSTSEC[^}]*\}/g)) {
          count++;
          expect(m[0], m[0]).toMatch(/reason = "[^"]+"/);
          expect(m[0], m[0]).toMatch(/expiry = "[^"]+"/);
        }
      expect(count).toBeGreaterThanOrEqual(3);
    });

    it('is linked from SKILL.md; deny.md names the network need; tauri.md the exit', () => {
      expect(read(`${dir}/SKILL.md`)).toContain('`references/deny.md`');
      expect(read(`${dir}/SKILL.md`)).toContain('`templates/deny.toml`');
      expect(read(`${dir}/references/deny.md`)).toMatch(/needs the network/);
      expect(read(`${dir}/references/tauri.md`)).toContain('when Tauri moves to GTK 4');
    });
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
