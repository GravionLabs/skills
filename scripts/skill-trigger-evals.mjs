// Offline check that evals/skill-triggers.json matches the skills/<group>/<name>/SKILL.md on disk.
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Groups whose skills are contributor tooling and get no eval. */
export const EXCLUDED_GROUPS = ['skill-tooling'];
/** Model-invocable skills that have no eval case yet; remove an entry when its case is added. */
export const NO_EVAL_YET = ['check-prerequisites'];

/** Reads and parses the eval file; throws when it is not a JSON array. */
export function loadEvals(evalsPath) {
  const data = JSON.parse(fs.readFileSync(evalsPath, 'utf8'));
  if (!Array.isArray(data)) throw new Error(`${evalsPath}: expected a JSON array`);
  return data;
}

/** True when the frontmatter sets `disable-model-invocation: true`. */
export function isModelGated(content) {
  const lines = content.split(/\r?\n/);
  if (lines[0].trimEnd() !== '---') return false;
  const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---');
  return lines
    .slice(1, end < 0 ? 1 : end)
    .some((l) => /^disable-model-invocation:\s*(['"]?)true\1\s*$/.test(l));
}

/** Names of model-invocable skills under skillsDir (skills/<group>/<name>/SKILL.md), sorted. */
export function modelInvocableSkills(skillsDir) {
  const names = [];
  for (const group of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!group.isDirectory() || EXCLUDED_GROUPS.includes(group.name)) continue;
    for (const skill of fs.readdirSync(path.join(skillsDir, group.name), { withFileTypes: true })) {
      const file = path.join(skillsDir, group.name, skill.name, 'SKILL.md');
      if (
        skill.isDirectory() &&
        fs.existsSync(file) &&
        !isModelGated(fs.readFileSync(file, 'utf8'))
      )
        names.push(skill.name);
    }
  }
  return names.sort();
}

/** Human-readable problems; an empty list means the evals match the skills on disk. */
export function validateEvals(evals, skillsDir, noEvalYet = NO_EVAL_YET) {
  const problems = [];
  const expected = new Set(modelInvocableSkills(skillsDir));
  const seenSkills = new Set();
  const seenPrompts = new Map();

  for (const e of evals) {
    if (seenSkills.has(e.skill)) problems.push(`${e.skill}: duplicate entry`);
    seenSkills.add(e.skill);
    if (!expected.has(e.skill))
      problems.push(`${e.skill}: not a model-invocable skill (gated, tooling or unknown)`);
    if (!Array.isArray(e.shouldTrigger) || !e.shouldTrigger.length)
      problems.push(`${e.skill}: needs at least one shouldTrigger prompt`);
    if (!Array.isArray(e.shouldNotTrigger) || !e.shouldNotTrigger.length)
      problems.push(`${e.skill}: needs at least one shouldNotTrigger prompt`);
    const prompts = [e.shouldTrigger, e.shouldNotTrigger];
    if (prompts.some((l) => l !== undefined && !Array.isArray(l))) {
      problems.push(`${e.skill}: shouldTrigger and shouldNotTrigger must be arrays`);
      continue;
    }
    for (const p of [...(e.shouldTrigger ?? []), ...(e.shouldNotTrigger ?? [])]) {
      if (typeof p !== 'string' || !p.trim()) {
        problems.push(`${e.skill}: prompts must be non-empty strings`);
        continue;
      }
      if (p.trim().startsWith('-'))
        problems.push(`${e.skill}: prompt starts with "-" (read as a CLI flag): "${p}"`);
      const key = p.trim().toLowerCase();
      const prev = seenPrompts.get(key);
      if (prev !== undefined)
        problems.push(`${e.skill}: duplicate prompt "${p}" (also in ${prev})`);
      else seenPrompts.set(key, e.skill);
    }
  }
  for (const s of expected)
    if (!seenSkills.has(s) && !noEvalYet.includes(s)) problems.push(`${s}: missing eval entry`);
  return problems;
}
