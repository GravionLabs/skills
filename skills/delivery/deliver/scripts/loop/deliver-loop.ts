// Entry of the TypeScript deliver loop: `node scripts/loop/deliver-loop.ts -Milestone M4 ...`.
// The core only: arguments, state from GitHub, stop rules. No session is started yet.
import { dirname, resolve } from 'node:path';
import { checkNodeVersion, parseArgs } from './args.ts';
import { exitCodeFor, getStopReason } from './stop.ts';
import { findMilestoneScript, getState, processGh } from './state.ts';

async function main(argv: string[]): Promise<number> {
  const nodeError = checkNodeVersion(process.versions.node);
  if (nodeError) {
    console.error(nodeError);
    return 64;
  }
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    console.error(parsed.message);
    return parsed.code;
  }
  const { args } = parsed;
  const state = await getState(processGh, {
    targets: args.targets,
    milestone: args.milestone,
    milestoneScript: findMilestoneScript(dirname(resolve(process.argv[1]))),
  });
  const result = getStopReason(state) ?? 'ready';
  console.log(JSON.stringify({ result, state }));
  return result === 'ready' ? 0 : exitCodeFor(result);
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
