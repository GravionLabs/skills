// Gate `guard`: the merge guard of delivery (ADR 0012, references/gates.md). A pull request that changes a protected
// path, or whose risk is above `mergeRisk`, is handed to the owner; the loop never merges it. `guardCheck` is the
// check every executor calls in-process; the CLI below wraps it:
//   node scripts/gates/guard.mts <pr> [--head <sha>] [--risk <level> | --result-file <file>] [--merge-risk <level>]
//     [--tracker <name>]
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { cargoTomlKeys } from '../cargo-toml.mts';
import { directoryPackagesPropsKeys } from '../directory-packages-props.mts';
import { goModKeys } from '../go-mod.mts';
import { MANIFESTS, exceptedManifest, protectedHits, protectedList } from '../protected-paths.mts';
import { pyprojectTomlKeys } from '../pyproject-toml.mts';
import { pnpmWorkspaceKeys } from '../pnpm-workspace.mts';
import { RISK_LEVELS } from '../review.mts';
import { loadTracker } from '../tracker.mts';
import { type GateResult, UsageError, gateMain } from './result.mts';

/** The end of every reason the owner decides on: the loop hands the pull request over. */
export const HANDS_OFF = ', merge it yourself';
/** How often the changed files are read before the guard gives up and hands over. */
export const GUARD_READS = 3;

// A `package.json` whose difference is only in these keys is no hit. A fixed list: a repository cannot widen it.
const DEPENDENCY_KEYS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];
const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

/** The message of a failed command: its stderr, else the error itself, first line only. */
const firstLine = (error: unknown): string =>
  String((error as { stderr?: string }).stderr || (error as Error).message || error)
    .trim()
    .split('\n')[0];

/** How the guard reads the two sides of a manifest: the tracker of the pull request. */
export type Compare = {
  /** The merge base and the judged commit; read only when a manifest is hit. Throws when unknown. */
  refs(): { base: string; head: string };
  /** The content of the file at the commit, `undefined` when it does not exist there. Any other failure throws. */
  fileAt(sha: string, file: string): string | undefined;
};
type Refs = { base: string; head: string };
type Comparator = (compare: Compare, file: string, refs: Refs) => string[] | undefined;

/**
 * The keys outside the dependency maps in which `package.json` differs between the merge base and `head`;
 * `undefined` when unknown (added, deleted, renamed, not JSON), then the file is a plain hit.
 * Throws when a read fails: the caller treats that as unknown too.
 */
const packageJsonKeys: Comparator = (compare, file, refs) => {
  const before = compare.fileAt(refs.base, file);
  const after = compare.fileAt(refs.head, file);
  if (before === undefined || after === undefined) return undefined;
  let a: unknown;
  let b: unknown;
  try {
    a = JSON.parse(before);
    b = JSON.parse(after);
  } catch {
    return undefined;
  }
  const isObject = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  if (!isObject(a) || !isObject(b)) return undefined;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((key) => !DEPENDENCY_KEYS.includes(key) && !sameJson(a[key], b[key]))
    .sort();
};
/**
 * A comparator from a strict parser of both sides: the parts outside the allowed entries that differ; `undefined`
 * when unknown (added, deleted, a file the parser does not understand), then the file is a plain hit.
 */
const parsed =
  (keys: (before: string, after: string) => string[]): Comparator =>
  (compare, file, refs) => {
    const before = compare.fileAt(refs.base, file);
    const after = compare.fileAt(refs.head, file);
    if (before === undefined || after === undefined) return undefined;
    try {
      return keys(before, after);
    } catch {
      return undefined;
    }
  };
/** The files with a comparator, by lower-case name: what differs outside the allowed parts, `undefined` when unknown. */
const COMPARATORS: Record<(typeof MANIFESTS)[number], Comparator> = {
  'package.json': packageJsonKeys,
  // outside the dependency entries
  'cargo.toml': parsed(cargoTomlKeys),
  // the top-level parts outside the catalog entries
  'pnpm-workspace.yaml': parsed(pnpmWorkspaceKeys),
  // outside the requirement lists
  'pyproject.toml': parsed(pyprojectTomlKeys),
  // the directives other than `require`
  'go.mod': parsed(goModKeys),
  // outside the `PackageVersion` items
  'directory.packages.props': parsed(directoryPackagesPropsKeys),
};

/** The protected hits, a `package.json`, `Cargo.toml`, `pnpm-workspace.yaml`, `pyproject.toml`, `go.mod` or `Directory.Packages.props` that differs only in its dependencies dropped, the others named with their parts. */
function judgeHits(files: string[], compare: Compare, list: string[]): string[] {
  const hits = protectedHits(files, list);
  if (
    !hits.some((file) =>
      (MANIFESTS as readonly string[]).includes(path.posix.basename(file.toLowerCase())),
    )
  )
    return hits;
  let refs: Refs;
  try {
    refs = compare.refs();
  } catch {
    return hits;
  }
  const out: string[] = [];
  for (const file of hits) {
    // the case-folded name matches the manifest; the file itself is read under its own name
    const manifest = exceptedManifest(file, list);
    if (!manifest) {
      out.push(file);
      continue;
    }
    let keys: string[] | undefined;
    try {
      keys = COMPARATORS[manifest](compare, file, refs);
    } catch {
      keys = undefined;
    }
    if (keys === undefined) out.push(file);
    else if (keys.length > 0) out.push(`${file}: ${keys.join(', ')}`);
  }
  return out;
}

/** The changed files of a pull request, or why they could not be read. */
export type ChangedFiles = string[] | { error: string };

/**
 * Reads the changed files up to `GUARD_READS` times: a read that fails once (server load, rate limit) is asked
 * again after `pause`, unless `stopped`. The last error is the answer then.
 */
export async function readChangedFiles(
  read: () => string[],
  { pause, stopped = () => false }: { pause: () => Promise<void>; stopped?: () => boolean },
): Promise<ChangedFiles> {
  for (let attempt = 1; ; attempt++) {
    try {
      return read();
    } catch (error) {
      if (attempt < GUARD_READS && !stopped()) {
        await pause();
        continue;
      }
      return { error: firstLine(error) };
    }
  }
}

/** The level of `risk.level` in an implementer result file; `undefined` when missing or not a level. */
export function riskOf(file: string): string | undefined {
  try {
    const level = JSON.parse(readFileSync(file, 'utf8'))?.risk?.level;
    return RISK_LEVELS.includes(level) ? level : undefined;
  } catch {
    return undefined;
  }
}

export type GuardInput = {
  /** The changed files (`readChangedFiles`); without them the paths are not checked. */
  files?: ChangedFiles;
  /** The two sides of a hit manifest. */
  compare?: Compare;
  /** `deliver.protectedPaths` (`protectedList`). */
  protectedList?: string[];
  /** The risk level of the pull request; a missing level counts as medium. */
  risk?: string;
  /** The highest level that is merged; without it the risk is not checked. */
  mergeRisk?: string;
};

const NO_COMPARE: Compare = {
  refs: () => {
    throw new Error('no compare');
  },
  fileAt: () => {
    throw new Error('no compare');
  },
};

/**
 * Whether the pull request may be merged as it is now: `pass`, else `owner` with the reason the loop hands over with.
 * Unknown is not safe: changed files that could not be read are `owner` too. Paths are checked before the risk.
 */
export function guardCheck({
  files,
  compare = NO_COMPARE,
  protectedList: list = [],
  risk,
  mergeRisk,
}: GuardInput): GateResult {
  if (files !== undefined) {
    if (!Array.isArray(files))
      return {
        result: 'owner',
        reason: `could not read the changed files (${files.error})${HANDS_OFF}`,
        evidence: { error: files.error },
      };
    let hits: string[];
    try {
      hits = judgeHits(files, compare, list);
    } catch (error) {
      // a protected list the matcher cannot read (an entry that is no string): unknown is not safe
      const message = firstLine(error);
      return {
        result: 'owner',
        reason: `could not read the changed files (${message})${HANDS_OFF}`,
        evidence: { error: message },
      };
    }
    if (hits.length > 0)
      return {
        result: 'owner',
        reason: `changes protected paths (${hits.slice(0, 3).join(', ')}${hits.length > 3 ? ', …' : ''})${HANDS_OFF}`,
        evidence: { hits },
      };
  }
  if (mergeRisk !== undefined) {
    const level = risk ?? 'medium';
    if (RISK_LEVELS.indexOf(level) > RISK_LEVELS.indexOf(mergeRisk))
      return {
        result: 'owner',
        reason: `risk ${level}${HANDS_OFF}`,
        evidence: { risk: level, mergeRisk },
      };
  }
  return { result: 'pass', reason: 'no protected path, risk within mergeRisk', evidence: {} };
}

// Tests only: the length of one second of waiting, as in the loop.
const TICK_MS = Number(process.env.DELIVER_TICK_MS ?? 1000);

const level = (value: string | undefined, flag: string): string | undefined => {
  if (value !== undefined && !RISK_LEVELS.includes(value))
    throw new UsageError(`${flag} is one of ${RISK_LEVELS.join(', ')}, not "${value}"`);
  return value;
};

/** The project config as the guard reads it: from the merge base of the pull request, never from its head. */
type ProjectConfig = {
  deliver?: { tracker?: unknown; protectedPaths?: string[]; mergeRisk?: unknown };
};
const CONFIG_FILE = '.agents/config.json';

/**
 * The CLI: loads the tracker (`--tracker`, default github), reads `deliver.protectedPaths` and `deliver.mergeRisk` of
 * the project config at the merge base of the pull request and runs `guardCheck` on its current head. The reviewed
 * pull request never chooses its own guard: a config it changes counts from the next pull request on.
 */
export async function guardCli(args: string[]): Promise<GateResult> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      head: { type: 'string' },
      risk: { type: 'string' },
      'result-file': { type: 'string' },
      'merge-risk': { type: 'string' },
      tracker: { type: 'string' },
    },
  });
  const [pr, ...rest] = positionals;
  if (!pr || rest.length > 0 || !/^[1-9]\d*$/.test(pr))
    throw new UsageError(
      'usage: guard <pr> [--head <sha>] [--risk <level> | --result-file <file>] [--merge-risk <level>] [--tracker <name>]',
    );
  if (values.risk !== undefined && values['result-file'] !== undefined)
    throw new UsageError('--risk and --result-file exclude each other');
  const risk =
    level(values.risk, '--risk') ??
    (values['result-file'] === undefined ? undefined : riskOf(values['result-file']));
  level(values['merge-risk'], '--merge-risk');
  const trackerName = values.tracker ?? 'github';

  let root = process.cwd();
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // not a git checkout
  }
  // as in the loop: a tracker from inside the repository would let a merged pull request decide what the guard runs
  const trackerDir = process.env.DELIVER_TRACKER_DIR;
  if (trackerDir) {
    const real = (file: string) => {
      try {
        return realpathSync.native(path.resolve(file));
      } catch {
        return path.resolve(file);
      }
    };
    const rel = path.relative(real(root), real(trackerDir));
    if (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`))
      throw new UsageError('DELIVER_TRACKER_DIR must not be inside the repository');
  }

  let tracker;
  try {
    tracker = await loadTracker(trackerName, {
      cwd: root,
      base: '',
      selection: {},
      trustAuthors: false,
    });
  } catch (error) {
    return { result: 'fail', reason: `tracker: ${firstLine(error)}`, evidence: {} };
  }
  const id = Number(pr);
  const pull = { id, title: '', url: '', branch: '' };
  const owner = (reason: string, evidence: Record<string, unknown>): GateResult => ({
    result: 'owner',
    reason: `${reason}${HANDS_OFF}`,
    evidence: { pr: id, ...evidence },
  });

  // the commit that is judged is the current head of the pull request; another one is not judged
  let refs: Refs;
  try {
    refs = tracker.compareRefs(pull);
  } catch (error) {
    return owner(`could not read the head of the pull request (${firstLine(error)})`, {});
  }
  const head = refs.head;
  if (values.head !== undefined && values.head !== head)
    return owner(`head mismatch: asked for ${values.head}, the pull request is at ${head}`, {
      head,
      askedHead: values.head,
    });

  let config: ProjectConfig;
  try {
    const text = tracker.fileAt(refs.base, CONFIG_FILE);
    config = text === undefined ? {} : (JSON.parse(text) as ProjectConfig);
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new Error(`${CONFIG_FILE} is not an object`);
  } catch (error) {
    return owner(`could not read ${CONFIG_FILE} at the base ${refs.base} (${firstLine(error)})`, {
      head,
      base: refs.base,
    });
  }
  const configured = config.deliver?.tracker;
  if (configured !== undefined && configured !== trackerName)
    throw new UsageError(
      `the base config names tracker ${JSON.stringify(configured)}: run with --tracker ${String(configured)}`,
    );
  const mergeRisk = level(
    values['merge-risk'] ?? (config.deliver?.mergeRisk as string | undefined) ?? 'medium',
    '--merge-risk (deliver.mergeRisk)',
  ) as string;

  const files = await readChangedFiles(() => tracker.changedFiles(pull), {
    pause: () => new Promise((done) => setTimeout(done, 5 * TICK_MS)),
  });
  // a push while the files were read: they may belong to another commit
  let after: string;
  try {
    after = tracker.compareRefs(pull).head;
  } catch (error) {
    return owner(`could not read the head of the pull request (${firstLine(error)})`, { head });
  }
  if (after !== head)
    return owner(`pushed while guarded: judged ${head}, the pull request is at ${after}`, {
      head,
      prHead: after,
    });

  const result = guardCheck({
    files,
    compare: { refs: () => refs, fileAt: (sha, file) => tracker.fileAt(sha, file) },
    protectedList: protectedList(config.deliver?.protectedPaths),
    risk,
    mergeRisk,
  });
  result.evidence = { pr: id, head, base: refs.base, ...result.evidence };
  return result;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await gateMain(guardCli);
}
