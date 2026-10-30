#!/usr/bin/env node
// The folders decide the groups: skills/<group>/<name>/SKILL.md is skill <name> in group <group>.
// This script keeps .claude-plugin/marketplace.json (one plugin per group) and the installer's
// groups.json in step with the folders.
//
//   node scripts/check-marketplace.mjs         check, exit 1 on any problem
//   node scripts/check-marketplace.mjs --fix   rewrite the skill lists of marketplace.json and groups.json
//
// Rules: every group folder has a plugin with a description in marketplace.json (written by hand) and
// every plugin has a folder; skill names are unique across groups; the frontmatter name equals the
// directory name; no SKILL.md sits directly in skills/<name>/.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const skillsDir = join(root, 'skills');
const manifestPath = join(root, '.claude-plugin/marketplace.json');
const groupsPath = join(skillsDir, 'delivery/skills-install/scripts/groups.json');
const fix = process.argv.includes('--fix');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
const problems = [];
const dirs = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

// Folders on disk: group -> skill names
const onDisk = new Map();
const seen = new Map();
for (const group of dirs(skillsDir)) {
  if (existsSync(join(skillsDir, group, 'SKILL.md'))) {
    problems.push(`skills/${group} is a skill outside a group folder: move it to skills/<group>/`);
    continue;
  }
  const names = dirs(join(skillsDir, group)).filter((n) =>
    existsSync(join(skillsDir, group, n, 'SKILL.md')),
  );
  onDisk.set(group, names);
  for (const name of names) {
    if (seen.has(name)) problems.push(`skill ${name} exists in ${seen.get(name)} and ${group}`);
    seen.set(name, group);
    const head = readFileSync(join(skillsDir, group, name, 'SKILL.md'), 'utf-8').split(/\r?\n/);
    const end = head.indexOf('---', 1);
    const nameLine = head.slice(1, end).find((l) => l.startsWith('name:'));
    const declared = nameLine
      ?.slice(5)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (declared !== name)
      problems.push(`skills/${group}/${name}: frontmatter name is "${declared}"`);
  }
}

// Plugins: one per group folder, skill list derived from the folder
const plugins = new Map(manifest.plugins.map((p) => [p.name, p]));
for (const group of onDisk.keys()) {
  if (!plugins.has(group)) problems.push(`group ${group} has no plugin in marketplace.json`);
}
for (const plugin of manifest.plugins) {
  const names = onDisk.get(plugin.name);
  if (!names) {
    problems.push(`plugin ${plugin.name} has no folder skills/${plugin.name}`);
    continue;
  }
  if (!plugin.description) problems.push(`plugin ${plugin.name} has no description`);
  if (plugin.source !== './') problems.push(`plugin ${plugin.name}: source must be "./"`);
  const wanted = names.map((n) => `./skills/${plugin.name}/${n}`);
  if (JSON.stringify(plugin.skills ?? []) !== JSON.stringify(wanted)) {
    if (fix) plugin.skills = wanted;
    else problems.push(`plugin ${plugin.name}: skills differ from skills/${plugin.name}/ (--fix)`);
  }
}

const groups = Object.fromEntries([...onDisk].filter(([g]) => plugins.has(g)));
const groupsJson = `${JSON.stringify(groups, null, 2)}\n`;
const current = existsSync(groupsPath) ? readFileSync(groupsPath, 'utf-8') : '';
if (fix) {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  if (current !== groupsJson) writeFileSync(groupsPath, groupsJson);
} else if (current !== groupsJson) {
  problems.push('groups.json of skills-install is out of date (--fix)');
}

if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}
console.log(`✓ ${seen.size} skills in ${onDisk.size} groups`);
