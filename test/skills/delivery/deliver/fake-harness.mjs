// The agent CLI of the tests of the deliver loop (DELIVER_HARNESS): `node fake-harness.mjs <dir> <prompt>`.
// It records the session in <dir>/sessions.jsonl, "opens" the pull request by writing <dir>/pr-<id> (unless the
// scenario says noPull) and exits with the code the scenario names for this session.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [dir, prompt] = process.argv.slice(2);
const [, command, id] = /^\/(deliver|deliver-review) (\d+)/.exec(prompt) ?? [];
const scenario = JSON.parse(readFileSync(path.join(dir, 'scenario.json'), 'utf8'));
if (command === 'deliver-review') {
  // a review session is recorded in reviews.jsonl; scenario.verdicts (by review index, default approve):
  // 'approve', 'changes', 'invalid', 'none' (no file) or 'fail' (exit 1 without a file)
  const reviews = path.join(dir, 'reviews.jsonl');
  const nr = existsSync(reviews) ? readFileSync(reviews, 'utf8').trim().split('\n').length : 0;
  appendFileSync(
    reviews,
    `${JSON.stringify({
      id: Number(id),
      prompt,
      cwd: process.cwd(),
      hasResultFileVariable: 'DELIVER_RESULT_FILE' in process.env,
    })}\n`,
  );
  const verdict = scenario.verdicts?.[nr] ?? 'approve';
  if (verdict === 'fail') process.exit(1);
  const finding = { severity: 'blocking', file: 'src/a.ts', summary: 'broken' };
  const answers = {
    approve: { verdict: 'approve', findings: [], unmet: [] },
    changes: { verdict: 'changes', findings: [finding], unmet: ['it works'] },
    invalid: { verdict: 'maybe' },
  };
  if (verdict !== 'none')
    writeFileSync(process.env.DELIVER_REVIEW_FILE, JSON.stringify(answers[verdict]));
  console.log(`result: reviewed ${verdict}`);
  process.exit(0);
}
const log = path.join(dir, 'sessions.jsonl');
const index = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').length : 0;
appendFileSync(
  log,
  `${JSON.stringify({
    id: Number(id),
    prompt,
    cwd: process.cwd(),
    run: process.env.DELIVER_RUN ?? null,
    ghToken: process.env.GH_TOKEN ?? null,
    hasSessionTokenVariable: 'DELIVER_SESSION_TOKEN' in process.env,
  })}\n`,
);
// per session (by index): { exit, noPull, hangs } overrides the scenario-wide fields for that session
const own = scenario.plan?.[index] ?? {};
if (own.hangs ?? scenario.hangs) {
  // a session that never ends: only the loop's stop request ends it
  console.log('working');
  setInterval(() => {}, 1000);
} else {
  // the implementer result of the scenario (risk by issue id), written where the loop says
  const level = scenario.risks?.[id];
  if (level && process.env.DELIVER_RESULT_FILE)
    writeFileSync(
      process.env.DELIVER_RESULT_FILE,
      JSON.stringify({ status: 'done', risk: { level, what: 'x', backout: 'revert' } }),
    );
  if (!(own.noPull ?? scenario.noPull)) writeFileSync(path.join(dir, `pr-${id}`), '');
  const final = scenario.blocked
    ? `result: blocked ${scenario.blocked}`
    : `result: pr https://example.test/pull/${100 + Number(id)}`;
  if (scenario.lingers) {
    // like a session with a pending wakeup: the final result record, then the process stays alive
    console.log(JSON.stringify({ type: 'result', is_error: false, result: `done\n${final}` }));
    setTimeout(() => {}, 60_000);
  } else {
    console.log(final);
    process.exit(own.exit ?? scenario.exits?.[index] ?? 0);
  }
}
