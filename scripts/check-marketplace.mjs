#!/usr/bin/env node
// Keeps .claude-plugin/marketplace.json, the skill directories and the installer's groups.json in sync.
//
//   node scripts/check-marketplace.mjs                 check, exit 1 on any problem
//   node scripts/check-marketplace.mjs --fix           rewrite groups.json; drop entries of deleted skills
//   node scripts/check-marketplace.mjs --fix --add <group> <skill>   list a new skill under <group>
//
// Rules: every skills/<name>/SKILL.md is listed in exactly one plugin (group); every listed path exists;
// the frontmatter name equals the directory name; skill names are unique; groups.json mirrors the groups.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifestPath = join(root, '.claude-plugin/marketplace.json');
const groupsPath = join(root, 'skills/skills-install/scripts/groups.json');
const args = process.argv.slice(2);
const fix = args.includes('--fix');
const addAt = args.indexOf('--add');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
const problems = [];

if (addAt >= 0) {
  const [group, skill] = args.slice(addAt + 1, addAt + 3);
  const plugin = manifest.plugins.find((p) => p.name === group);
  if (!group || !skill) problems.push('--add needs <group> <skill>');
  else if (!plugin) problems.push(`--add: no group "${group}" in marketplace.json`);
  else if (!plugin.skills.includes(`./skills/${skill}`)) {
    plugin.skills.push(`./skills/${skill}`);
    plugin.skills.sort();
  }
}

const onDisk = readdirSync(join(root, 'skills'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(root, 'skills', d.name, 'SKILL.md')))
  .map((d) => d.name)
  .sort();

const owner = new Map();
for (const plugin of manifest.plugins) {
  if (plugin.source !== './') problems.push(`${plugin.name}: source must be "./"`);
  const kept = [];
  for (const path of plugin.skills ?? []) {
    const name = path.replace(/^\.\/skills\//, '');
    if (!path.startsWith('./skills/') || name.includes('/')) {
      problems.push(`${plugin.name}: ${path} is not ./skills/<name>`);
      continue;
    }
    if (!onDisk.includes(name)) {
      if (fix) continue;
      problems.push(`${plugin.name}: ${path} has no SKILL.md`);
    }
    if (owner.has(name))
      problems.push(`${name} is listed in ${owner.get(name)} and ${plugin.name}`);
    owner.set(name, plugin.name);
    kept.push(path);
  }
  plugin.skills = kept;
}

for (const name of onDisk) {
  if (!owner.has(name))
    problems.push(`skills/${name} is in no group (use --fix --add <group> ${name})`);
  const head = readFileSync(join(root, 'skills', name, 'SKILL.md'), 'utf-8').split(/\r?\n/);
  const end = head.indexOf('---', 1);
  const nameLine = head.slice(1, end).find((l) => l.startsWith('name:'));
  const declared = nameLine
    ?.slice(5)
    .trim()
    .replace(/^['"]|['"]$/g, '');
  if (declared !== name) problems.push(`skills/${name}: frontmatter name is "${declared}"`);
}

const groups = Object.fromEntries(
  manifest.plugins.map((p) => [p.name, p.skills.map((s) => s.replace('./skills/', '')).sort()]),
);
const groupsJson = `${JSON.stringify(groups, null, 2)}\n`;
const current = existsSync(groupsPath) ? readFileSync(groupsPath, 'utf-8') : '';

if (fix) {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  if (current !== groupsJson) writeFileSync(groupsPath, groupsJson);
} else if (current !== groupsJson) {
  problems.push('skills/skills-install/scripts/groups.json is out of date (run with --fix)');
}

if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}
console.log(`✓ ${onDisk.length} skills in ${manifest.plugins.length} groups`);
