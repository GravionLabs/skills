// Arguments of Invoke-DeliverLoop.ps1 in the same spelling (-Milestone, -Target, ...), case-insensitive.
export const HARNESSES = ['claude', 'copilot'] as const;
export const MIN_NODE_MAJOR = 24;

export type LoopArgs = {
  targets: number[];
  milestone: string;
  max: number;
  model: string;
  harness: string;
  context: string;
  objective: string;
  logPane: boolean;
  noColor: boolean;
  noPreflight: boolean;
  dryRun: boolean;
};
export type ParseResult = { ok: true; args: LoopArgs } | { ok: false; code: 64; message: string };

const SWITCHES = ['logpane', 'nopane', 'nocolor', 'nonotify', 'dryrun', 'nopreflight'];
const VALUES = ['milestone', 'max', 'model', 'harness', 'context', 'objective'];

export function checkNodeVersion(version: string): string | null {
  const major = Number.parseInt(version.replace(/^v/, ''), 10);
  if (Number.isFinite(major) && major >= MIN_NODE_MAJOR) return null;
  return `deliver-loop needs Node.js ${MIN_NODE_MAJOR} or newer (found ${version}).`;
}

const fail = (message: string): ParseResult => ({ ok: false, code: 64, message });

export function parseArgs(argv: string[]): ParseResult {
  const values: Record<string, string> = {};
  const on = new Set<string>();
  const rawTargets: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const name = /^--?([A-Za-z]+)$/.exec(a)?.[1].toLowerCase();
    if (name === 'target') continue; // the numbers after it are collected below
    if (name && SWITCHES.includes(name)) {
      on.add(name);
    } else if (name && VALUES.includes(name)) {
      if (i + 1 >= argv.length) return fail(`Missing value for ${a}.`);
      values[name] = argv[++i];
    } else if (a.startsWith('-') && !/^-\d/.test(a)) {
      return fail(`Unknown parameter ${a}.`);
    } else {
      rawTargets.push(a); // -Target values and remaining arguments
    }
  }

  const harness = values.harness ?? 'claude';
  if (!(HARNESSES as readonly string[]).includes(harness)) {
    return fail(`Unknown -Harness '${harness}'. Supported: ${HARNESSES.join(', ')}.`);
  }
  let max = 0;
  if (values.max !== undefined) {
    max = /^\d+$/.test(values.max) ? Number(values.max) : Number.NaN;
    if (!(max >= 1 && max <= 10000)) return fail('-Max must be a number from 1 to 10000.');
  }
  const names = rawTargets.flatMap((t) => t.split(/[,\s]+/)).filter(Boolean);
  const milestone = values.milestone ?? '';
  const objective = values.objective ?? '';
  if (objective && (names.length || milestone)) {
    return fail('-Objective is not combined with -Target or -Milestone.');
  }
  const dryRun = on.has('dryrun');
  const noPreflight = on.has('nopreflight');
  if ((dryRun || noPreflight) && !objective) {
    return fail('-DryRun and -NoPreflight need -Objective.');
  }
  if (!objective && (names.some((n) => !/^\d+$/.test(n)) || (names.length === 0 && !milestone))) {
    return fail('Give -Target <nr...> (issue numbers) and/or -Milestone <name>.');
  }
  let model = values.model ?? '';
  if (harness === 'copilot' && !model) model = 'auto';
  return {
    ok: true,
    args: {
      targets: names.map(Number),
      milestone,
      max,
      model,
      harness,
      context: values.context ?? '',
      objective,
      logPane: on.has('logpane'),
      noColor: on.has('nocolor'),
      noPreflight,
      dryRun,
    },
  };
}
