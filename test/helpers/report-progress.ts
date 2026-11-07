import * as path from 'path';

export const REPORT_PROGRESS = path.resolve(
  __dirname,
  '../../skills/delivery/deliver/scripts/Report-Progress.ps1',
);

// Shell command of a fake harness that reports one event the way deliver does (AGENT_EVENTS_RUN comes from the loop).
export const reportEventCmd = (args: string[]): string =>
  `pwsh -NoProfile -File '${REPORT_PROGRESS}' ${args.map((a) => `'${a}'`).join(' ')}`;
