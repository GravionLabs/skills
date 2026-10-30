#!/usr/bin/env node
// Writes docs/skill-list.md: one table per group of .claude-plugin/marketplace.json with each skill's
// description and install command. The file is gitignored; the site build runs this first.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, process.argv[2] ?? 'docs/skill-list.md');
const manifest = JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf-8'));

/** The `description` of a SKILL.md frontmatter: single line, quoted or plain, or a folded block (`>`). */
function description(skill) {
  const lines = readFileSync(join(root, 'skills', skill, 'SKILL.md'), 'utf-8').split(/\r?\n/);
  const end = lines.indexOf('---', 1);
  const front = lines.slice(1, end);
  const at = front.findIndex((l) => l.startsWith('description:'));
  if (at < 0) return '';
  let value = front[at].slice('description:'.length).trim();
  if (/^[>|][-+]?$/.test(value)) {
    const block = [];
    for (const l of front.slice(at + 1)) {
      if (!/^\s+/.test(l)) break;
      block.push(l.trim());
    }
    value = block.join(' ');
  } else if (/^'.*'$/.test(value)) {
    value = value.slice(1, -1).replaceAll("''", "'");
  } else if (/^".*"$/.test(value)) {
    value = value.slice(1, -1).replaceAll('\\"', '"');
  }
  return value.replaceAll('|', '\\|');
}

const sections = manifest.plugins.map((p) => {
  const skills = p.skills.map((s) => s.replace('./skills/', ''));
  const rows = skills.map((s) => `| \`${s}\` | ${description(s)} |`);
  return [
    `## ${p.name}`,
    '',
    p.description,
    '',
    `Install: \`npx skills add GravionLabs/skills ${skills.map((s) => `--skill ${s}`).join(' ')}\``,
    '',
    '| Skill | Description |',
    '| :-- | :-- |',
    ...rows,
    '',
  ].join('\n');
});

const total = manifest.plugins.reduce((n, p) => n + p.skills.length, 0);
const text = [
  '# Skill list',
  '',
  `${total} skills in ${manifest.plugins.length} groups. Generated from \`.claude-plugin/marketplace.json\` by \`pnpm run generate\`; do not edit.`,
  'The easier way to install a group is `/skills-install <group>` (or its script), which also brings the external dependencies.',
  '',
  ...sections,
].join('\n');
writeFileSync(out, text);
console.log(`wrote ${out} (${total} skills)`);
