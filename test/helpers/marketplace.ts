import * as fs from 'node:fs';
import * as path from 'node:path';

const manifest = path.resolve(__dirname, '../../.claude-plugin/marketplace.json');

/** Skill names of one group (plugin) of .claude-plugin/marketplace.json. */
export function groupSkills(group: string): string[] {
  const m = JSON.parse(fs.readFileSync(manifest, 'utf8')) as {
    plugins: { name: string; skills: string[] }[];
  };
  const plugin = m.plugins.find((p) => p.name === group);
  if (!plugin) throw new Error(`no group ${group} in marketplace.json`);
  return plugin.skills.map((s) => s.split('/').at(-1) as string);
}
