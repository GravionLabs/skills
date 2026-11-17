// GitHub tracker: issues, sub-issue dependencies, pull requests and checks through the gh CLI.
import { execFileSync } from 'node:child_process';
import type { Gate, Item, Pull, Subject, Tracker, TrackerContext } from '../tracker.mts';

const HOLD = ['needs-decision', 'needs-refinement', 'interactive', 'release-test'];
// only these can change the text of an issue they wrote; anyone can write a comment
const TRUSTED = ['OWNER', 'MEMBER', 'COLLABORATOR'];

type Issue = {
  number: number;
  title: string;
  state: string;
  html_url: string;
  body: string | null;
  author_association: string;
  labels: { name: string }[];
  pull_request?: unknown;
};
type Milestone = { number: number; title: string; html_url: string };
type PullRecord = {
  number: number;
  title: string;
  html_url: string;
  head: { ref: string; repo: { full_name: string } | null };
};
type Check = { name: string; bucket: string };

/**
 * The verdict of the checks of a pull request. The loop decides this itself and does not rely on the
 * ruleset: a login that may bypass the ruleset (an admin) merges through the API although a required
 * check is missing. Every required check must have reported and passed; a required check that has not
 * reported yet is pending, never green. Without required checks every reported check counts.
 */
export function checkVerdict(
  required: string[],
  checks: Check[],
): { state: 'red'; detail: string } | { state: 'pending' | 'green' } {
  const gating = required.length > 0 ? checks.filter((c) => required.includes(c.name)) : checks;
  const red = gating.filter((c) => c.bucket === 'fail');
  if (red.length > 0)
    return { state: 'red', detail: [...new Set(red.map((c) => c.name))].join(', ') };
  const passed = (c: Check) => c.bucket === 'pass' || c.bucket === 'skipping';
  const missing = required.some((name) => !gating.some((c) => c.name === name));
  return { state: missing || !gating.every(passed) ? 'pending' : 'green' };
}

export function create({ cwd, base, selection, trustAuthors }: TrackerContext): Tracker {
  const gh = (...args: string[]): string =>
    execFileSync('gh', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // the default of 1 MB is too small for the lists of a large repository
      maxBuffer: 256 * 1024 * 1024,
    }).trim();
  const api = <T,>(route: string): T => JSON.parse(gh('api', route));
  const list = <T,>(route: string): T[] =>
    (JSON.parse(gh('api', route, '--paginate', '--slurp')) as T[][]).flat();
  const repo = gh('repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner');

  let milestoneCache: Milestone | undefined;
  const milestone = (): Milestone => {
    if (milestoneCache) return milestoneCache;
    const found = list<Milestone>(`repos/${repo}/milestones?state=all&per_page=100`).find(
      (m) => m.title === selection.milestone || m.title.startsWith(`${selection.milestone} `),
    );
    if (!found) throw new Error(`milestone ${selection.milestone} not found in ${repo}`);
    milestoneCache = found;
    return found;
  };

  const authors = new Map<number, string>();
  const toItem = (issue: Issue): Item => {
    authors.set(issue.number, issue.author_association);
    return {
      id: issue.number,
      title: issue.title,
      url: issue.html_url,
      labels: issue.labels.map((l) => l.name),
      body: issue.body ?? '',
    };
  };

  const checksOf = (id: number): Check[] => {
    try {
      return JSON.parse(gh('pr', 'checks', String(id), '--repo', repo, '--json', 'name,bucket'));
    } catch (error) {
      const { stdout, stderr } = error as { stdout?: string; stderr?: string };
      // gh exits non-zero for pending or failed checks and still prints the list
      try {
        return JSON.parse(String(stdout));
      } catch {
        if (/no checks reported/i.test(String(stderr))) return [];
        // a failed call is not "no checks": without required checks an empty list would count as green
        throw error;
      }
    }
  };

  let requiredCache: string[] | undefined;
  const required = (): string[] => {
    if (requiredCache) return requiredCache;
    const names: string[] = [];
    try {
      const rules = api<
        { type: string; parameters?: { required_status_checks?: { context: string }[] } }[]
      >(`repos/${repo}/rules/branches/${base}`);
      for (const rule of rules) {
        if (rule.type !== 'required_status_checks') continue;
        names.push(...(rule.parameters?.required_status_checks ?? []).map((c) => c.context));
      }
    } catch {
      // no rulesets readable
    }
    try {
      // classic branch protection
      const route = `repos/${repo}/branches/${encodeURIComponent(base)}/protection/required_status_checks`;
      names.push(...(api<{ contexts?: string[] }>(route).contexts ?? []));
    } catch {
      // none, or not readable with this login
    }
    requiredCache = [...new Set(names)];
    return requiredCache;
  };

  return {
    name: 'github',
    repo,

    subject(): Subject {
      if (selection.milestone) {
        const m = milestone();
        return { kind: 'github.milestone', id: m.title, title: m.title, url: m.html_url };
      }
      return {
        kind: 'github.repository',
        id: repo,
        title: `${repo} ${(selection.issues ?? []).map((nr) => `#${nr}`).join(', ')}`,
        url: `https://github.com/${repo}`,
      };
    },

    items(): Item[] {
      if (selection.issues) {
        return selection.issues
          .map((nr) => api<Issue>(`repos/${repo}/issues/${nr.trim()}`))
          .filter((issue) => issue.state === 'open' && !issue.pull_request)
          .map(toItem);
      }
      const number = milestone().number;
      return list<Issue>(`repos/${repo}/issues?milestone=${number}&state=open&per_page=100`)
        .filter(
          (i) => !i.pull_request && i.labels.some((l) => l.name === 'pbi' || l.name === 'bug'),
        )
        .sort((a, b) => a.number - b.number)
        .map(toItem);
    },

    itemSubject(item: Item): Subject {
      return {
        kind: 'github.issue',
        id: `${repo}#${item.id}`,
        title: `#${item.id} ${item.title}`,
        url: item.url,
      };
    },

    waitReason(item: Item): string | undefined {
      const held = item.labels.find((name) => HOLD.includes(name));
      if (held) return held;
      const author = authors.get(item.id) ?? 'NONE';
      if (!trustAuthors && !TRUSTED.includes(author)) {
        return `author has no write access (${author.toLowerCase()}), --trust-authors delivers it`;
      }
      const blockers = list<{ number: number; state: string; repository_url: string }>(
        `repos/${repo}/issues/${item.id}/dependencies/blocked_by`,
      ).filter((b) => b.state === 'open');
      if (blockers.length === 0) return undefined;
      return `blocked by ${blockers.map((b) => `${b.repository_url.split('/repos/')[1]}#${b.number}`).join(', ')}`;
    },

    needsDecision(item: Item): boolean {
      return api<Issue>(`repos/${repo}/issues/${item.id}`).labels.some(
        (l) => l.name === 'needs-decision',
      );
    },

    pullOf(item: Item): Pull | undefined {
      const found = list<PullRecord>(
        `repos/${repo}/pulls?state=open&base=${base}&per_page=100`,
      ).find(
        (p) =>
          p.head.repo?.full_name === repo && new RegExp(`^[a-z]+/${item.id}-`).test(p.head.ref),
      );
      return (
        found && {
          id: found.number,
          title: found.title,
          url: found.html_url,
          branch: found.head.ref,
        }
      );
    },

    gate(pull: Pull): Gate {
      const view = JSON.parse(
        gh('pr', 'view', String(pull.id), '--repo', repo, '--json', 'state,mergeable,headRefOid'),
      );
      if (view.state === 'MERGED') return { state: 'merged' };
      if (view.state === 'CLOSED') return { state: 'closed' };
      if (view.mergeable === 'CONFLICTING')
        return { state: 'conflict', detail: `conflict with ${base}` };
      const checks = checksOf(pull.id);
      const verdict = checkVerdict(required(), checks);
      if (verdict.state === 'red') return verdict;
      // mergeable is UNKNOWN while GitHub computes it
      const ready = verdict.state === 'green' && view.mergeable === 'MERGEABLE';
      return {
        state: ready ? 'ready' : 'pending',
        reported: checks.length > 0,
        head: view.headRefOid,
      };
    },

    merge(pull: Pull, head: string): void {
      try {
        gh(
          'api',
          '-X',
          'PUT',
          `repos/${repo}/pulls/${pull.id}/merge`,
          '-f',
          'merge_method=squash',
          '-f',
          `commit_title=${pull.title} (#${pull.id})`,
          // only the commit whose checks were read: a later push is refused
          '-f',
          `sha=${head}`,
        );
      } catch (error) {
        const stderr = String((error as { stderr?: string }).stderr ?? error);
        throw new Error(stderr.trim().split('\n')[0]);
      }
    },

    dropBranch(pull: Pull): void {
      try {
        gh('api', '-X', 'DELETE', `repos/${repo}/git/refs/heads/${pull.branch}`);
      } catch {
        // the repository may delete merged branches itself
      }
    },

    requiredChecks(): string[] {
      return required();
    },

    changedFiles(pull: Pull): string[] {
      // names only: the full records of a large pull request are many megabytes
      return gh(
        'api',
        `repos/${repo}/pulls/${pull.id}/files?per_page=100`,
        '--paginate',
        '--jq',
        '.[] | .filename, (.previous_filename // empty)',
      )
        .split('\n')
        .filter(Boolean);
    },

    defaultBranch(): string {
      return gh('repo', 'view', '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name');
    },

    releaseTests(): Item[] {
      if (!selection.milestone) return [];
      return list<Issue>(
        `repos/${repo}/issues?milestone=${milestone().number}&state=open&per_page=100`,
      )
        .filter((i) => !i.pull_request && i.labels.some((l) => l.name === 'release-test'))
        .sort((a, b) => a.number - b.number)
        .map(toItem);
    },

    releaseCommits(): number {
      const target = this.defaultBranch();
      return Number(gh('api', `repos/${repo}/compare/${target}...${base}`, '-q', '.ahead_by'));
    },

    ensureReleasePull(): Pull {
      const target = this.defaultBranch();
      const owner = repo.split('/')[0];
      const find = () =>
        list<PullRecord>(
          `repos/${repo}/pulls?state=open&base=${target}&head=${owner}:${base}&per_page=100`,
        )[0];
      let found = find();
      if (!found) {
        const url = gh(
          'pr',
          'create',
          '--repo',
          repo,
          '--base',
          target,
          '--head',
          base,
          '--title',
          `release: ${base}`,
          '--body',
          `Release pull request of ${selection.milestone ?? base}. Merged by a person, never by the loop.`,
        );
        found = find() ?? {
          number: Number(url.split('/').pop()),
          title: `release: ${base}`,
          html_url: url,
          head: { ref: base, repo: { full_name: repo } },
        };
      }
      return { id: found.number, title: found.title, url: found.html_url, branch: found.head.ref };
    },

    sessionEnv(token: string): Record<string, string> {
      // gh reads GH_TOKEN; git push must use it too, not a stored credential of the user
      const n = Number(process.env.GIT_CONFIG_COUNT ?? 0);
      return {
        GH_TOKEN: token,
        GITHUB_TOKEN: token,
        GIT_CONFIG_COUNT: String(n + 2),
        [`GIT_CONFIG_KEY_${n}`]: 'credential.helper',
        [`GIT_CONFIG_VALUE_${n}`]: '',
        [`GIT_CONFIG_KEY_${n + 1}`]: 'credential.helper',
        [`GIT_CONFIG_VALUE_${n + 1}`]: '!gh auth git-credential',
      };
    },
  };
}
