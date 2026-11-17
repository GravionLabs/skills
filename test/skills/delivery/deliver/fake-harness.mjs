// The agent CLI of the tests of the deliver loop (DELIVER_HARNESS): `node fake-harness.mjs <dir> <prompt>`.
// It records the session in <dir>/sessions.jsonl, "opens" the pull request by writing <dir>/pr-<id> (unless the
// scenario says noPull) and exits with the code the scenario names for this session.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [dir, prompt] = process.argv.slice(2);
const id = /^\/deliver (\d+)/.exec(prompt)?.[1];
const scenario = JSON.parse(readFileSync(path.join(dir, 'scenario.json'), 'utf8'));
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
if (!scenario.noPull) writeFileSync(path.join(dir, `pr-${id}`), '');
const final = `result: pr https://example.test/pull/${100 + Number(id)}`;
if (scenario.lingers) {
  // like a session with a pending wakeup: the final result record, then the process stays alive
  console.log(JSON.stringify({ type: 'result', is_error: false, result: `done\n${final}` }));
  setTimeout(() => {}, 60_000);
} else {
  console.log(final);
  process.exit(scenario.exits?.[index] ?? 0);
}
