import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
export const MIN_TRIGGER_RATE = 80;
export const MAX_FALSE_TRIGGER_RATE = 10;
export const MAX_DROP = 5;
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Analyzes a stream-json transcript (JSON lines): invoked skills and whether the session ended properly. */
export function analyzeTranscript(transcript) {
  const invoked = [];
  let result;
  for (const line of transcript.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(ev)) continue;
    if (ev.type === 'result') result = ev;
    if (ev.type !== 'assistant' || !isObject(ev.message) || !Array.isArray(ev.message.content))
      continue;
    for (const block of ev.message.content) {
      if (!isObject(block) || block.type !== 'tool_use' || block.name !== 'Skill') continue;
      const input = block.input;
      if (isObject(input) && typeof input.skill === 'string')
        invoked.push(input.skill.split(':').pop());
    }
  }
  const maxTurns = result?.subtype === 'error_max_turns';
  const failed = result === undefined || (result.is_error === true && !maxTurns);
  return { invoked, completed: result !== undefined, failed };
}
/** Skill names from Skill tool_use blocks in a stream-json transcript. */
export function extractInvokedSkills(transcript) {
  return analyzeTranscript(transcript).invoked;
}
const pct = (n, d) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);
function rates(all, hit) {
  const records = all.filter((r) => !r.failed);
  const pos = records.filter((r) => r.kind === 'positive');
  const neg = records.filter((r) => r.kind === 'negative');
  return {
    positives: pos.length,
    negatives: neg.length,
    triggerRate: pct(pos.filter(hit).length, pos.length),
    falseTriggerRate: pct(neg.filter(hit).length, neg.length),
  };
}
/** Per-skill and overall trigger / false-trigger rates. */
export function summarize(records) {
  const hit = (r) => r.invoked.includes(r.skill);
  const names = [...new Set(records.map((r) => r.skill))].sort();
  return {
    overall: rates(records, hit),
    skills: names.map((skill) => ({
      skill,
      ...rates(
        records.filter((r) => r.skill === skill),
        hit,
      ),
    })),
  };
}
/** Violations of the absolute thresholds (overall and per skill). */
export function checkThresholds(s) {
  const out = [];
  const check = (label, r) => {
    if (r.positives > 0 && r.triggerRate < MIN_TRIGGER_RATE)
      out.push(`${label}: trigger rate ${r.triggerRate}% < ${MIN_TRIGGER_RATE}%`);
    if (r.negatives > 0 && r.falseTriggerRate > MAX_FALSE_TRIGGER_RATE)
      out.push(`${label}: false-trigger rate ${r.falseTriggerRate}% > ${MAX_FALSE_TRIGGER_RATE}%`);
  };
  check('overall', s.overall);
  for (const k of s.skills) check(k.skill, k);
  return out;
}
const round1 = (n) => Math.round(n * 10) / 10;
/** Overall rates recomputed from per-skill counts, restricted to the given skills. */
function overallOf(skills) {
  const sum = (f) => skills.reduce((acc, k) => acc + f(k), 0);
  const positives = sum((k) => k.positives);
  const negatives = sum((k) => k.negatives);
  return {
    positives,
    negatives,
    triggerRate: pct(
      sum((k) => (k.triggerRate * k.positives) / 100),
      positives,
    ),
    falseTriggerRate: pct(
      sum((k) => (k.falseTriggerRate * k.negatives) / 100),
      negatives,
    ),
  };
}
/**
 * Regressions versus a baseline: trigger rate drops or false-trigger rate rises by more than maxDrop points.
 * Only skills present in both summaries are compared, `overall` included.
 */
export function compareToBaseline(current, baseline, maxDrop = MAX_DROP) {
  const out = [];
  const cmp = (label, cur, base) => {
    if (round1(base.triggerRate - cur.triggerRate) > maxDrop)
      out.push(`${label}: trigger rate fell ${base.triggerRate}% -> ${cur.triggerRate}%`);
    if (round1(cur.falseTriggerRate - base.falseTriggerRate) > maxDrop)
      out.push(
        `${label}: false-trigger rate rose ${base.falseTriggerRate}% -> ${cur.falseTriggerRate}%`,
      );
  };
  const pairs = current.skills.flatMap((cur) => {
    const base = baseline.skills.find((b) => b.skill === cur.skill);
    return base ? [{ cur, base }] : [];
  });
  if (pairs.length > 0)
    cmp('overall', overallOf(pairs.map((p) => p.cur)), overallOf(pairs.map((p) => p.base)));
  for (const { cur, base } of pairs) cmp(cur.skill, cur, base);
  return out;
}
const isRates = (v) =>
  isObject(v) &&
  ['positives', 'negatives', 'triggerRate', 'falseTriggerRate'].every(
    (k) => typeof v[k] === 'number',
  );
/** Accepts a result file or a bare summary; throws a clear error when no usable summary is found. */
export function parseBaseline(data) {
  const summary = isObject(data) && isObject(data.summary) ? data.summary : data;
  if (
    !isObject(summary) ||
    !isRates(summary.overall) ||
    !Array.isArray(summary.skills) ||
    !summary.skills.every((k) => isObject(k) && typeof k.skill === 'string' && isRates(k))
  )
    throw new Error(
      'baseline has no usable summary (expected a result file with "summary" or a bare summary)',
    );
  const ctx = isObject(data) ? data : {};
  return {
    summary: summary,
    meta: isObject(ctx.meta) ? ctx.meta : undefined,
    notInstalled: Array.isArray(ctx.notInstalled) ? ctx.notInstalled : undefined,
  };
}
/** Differences between the baseline and the current run that make a comparison less meaningful. */
export function baselineWarnings(current, base) {
  const out = [];
  if (base.meta?.model && current.meta?.model && base.meta.model !== current.meta.model)
    out.push(`baseline model ${base.meta.model} differs from ${current.meta.model}`);
  if (
    base.meta?.runs !== undefined &&
    current.meta?.runs !== undefined &&
    base.meta.runs !== current.meta.runs
  )
    out.push(`baseline runs ${base.meta.runs} differ from ${current.meta.runs}`);
  const a = [...(base.notInstalled ?? [])].sort().join(',');
  const b = [...(current.notInstalled ?? [])].sort().join(',');
  if (base.notInstalled && a !== b)
    out.push(`baseline notInstalled set differs (${a || 'none'} vs ${b || 'none'})`);
  const have = new Set(current.summary.skills.map((k) => k.skill));
  for (const k of base.summary.skills)
    if (!have.has(k.skill)) out.push(`${k.skill} is in the baseline but not in this run`);
  return out;
}
export function score(records, baseline, ctx = {}) {
  const summary = summarize(records);
  const base = baseline ? ('summary' in baseline ? baseline : { summary: baseline }) : undefined;
  const failed = records.filter((r) => r.failed).length;
  const ok = records.length - failed;
  const runs = ctx.meta?.runs && ctx.meta.runs > 0 ? ctx.meta.runs : 1;
  return {
    summary,
    meta: ctx.meta,
    notInstalled: ctx.notInstalled ?? [],
    sampleSize: { prompts: Math.round(ok / runs), runs: ok, failed },
    failedRuns: failed,
    warnings: base ? baselineWarnings({ ...ctx, summary }, base) : [],
    records,
    thresholdFailures: checkThresholds(summary),
    regressions: base ? compareToBaseline(summary, base.summary) : [],
  };
}
/** Share of failed sessions above which a run is not trusted. */
export const MAX_FAILED_SHARE = 0.1;
const readJson = (file, what) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`cannot read ${what} ${file}: ${e.message}`);
  }
};
function parseRecords(data) {
  const list = Array.isArray(data) ? data : isObject(data) ? data.records : undefined;
  if (!Array.isArray(list))
    throw new Error('records must be an array (or an object with a "records" array)');
  for (const r of list) {
    if (
      !isObject(r) ||
      typeof r.skill !== 'string' ||
      (r.kind !== 'positive' && r.kind !== 'negative') ||
      !Array.isArray(r.invoked)
    )
      throw new Error(
        'malformed record: expected { skill: string, kind: "positive"|"negative", invoked: string[] }',
      );
  }
  const ctx = isObject(data)
    ? {
        meta: isObject(data.meta) ? data.meta : undefined,
        notInstalled: Array.isArray(data.notInstalled) ? data.notInstalled : undefined,
      }
    : {};
  return { records: list, ctx };
}
/**
 * CLI (used by scripts/Invoke-TriggerEvals.ps1):
 *   extract <transcript.jsonl>                      prints {"invoked":[...],"completed":bool,"failed":bool}
 *   score <records.json> <out.json> [baseline.json] writes the result file
 * records.json is an array or { records, meta, notInstalled }.
 * Exit codes: 0 ok, 1 threshold or regression failure, 2 crash, bad input or too many failed sessions.
 */
export function main(argv) {
  const [cmd, a, b, c] = argv;
  try {
    if (cmd === 'extract' && a) {
      console.log(JSON.stringify(analyzeTranscript(fs.readFileSync(a, 'utf8'))));
      return 0;
    }
    if (cmd === 'score' && a && b) {
      const { records, ctx } = parseRecords(readJson(a, 'records'));
      const baseline = c ? parseBaseline(readJson(c, 'baseline')) : undefined;
      const result = score(records, baseline, ctx);
      fs.writeFileSync(b, JSON.stringify(result, null, 2));
      console.log(
        `trigger ${result.summary.overall.triggerRate}%  false-trigger ${result.summary.overall.falseTriggerRate}%`,
      );
      if (result.failedRuns > 0)
        console.log(
          `${result.failedRuns} of ${records.length} sessions failed (excluded from rates)`,
        );
      for (const w of result.warnings) console.log(`WARN ${w}`);
      if (records.length > 0 && result.failedRuns / records.length > MAX_FAILED_SHARE) {
        console.error(
          `ERROR more than ${MAX_FAILED_SHARE * 100}% of sessions failed; the result is not trustworthy`,
        );
        return 2;
      }
      for (const m of [...result.thresholdFailures, ...result.regressions])
        console.log(`FAIL ${m}`);
      return result.thresholdFailures.length + result.regressions.length > 0 ? 1 : 0;
    }
  } catch (e) {
    console.error(`ERROR ${e.message}`);
    return 2;
  }
  console.error('usage: extract <transcript> | score <records> <out> [baseline]');
  return 2;
}
if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
)
  process.exit(main(process.argv.slice(2)));
