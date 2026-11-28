// `deliver-loop --objective <owner>/<repo>#<nr>` without `--dry-run`: one frontier over the repositories of the
// Objective (objective-run.mts). Each repository is cloned from DELIVER_REPOS_DIR; the fake tracker works the
// milestone of a unit from `repositories`.
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Scenario,
  type Span,
  fixture,
  git,
  lines,
  loop,
  repo,
  root,
} from './deliver/run-loop';

const overlap = (a: Span, b: Span) => a.at < b.end && b.at < a.end;
const implementer = (spans: Span[], id: number) => spans.find((s) => s.id === id && !s.review);

/** An Objective in `x/app` over `x/app`, `x/lib` and `x/cli`; `features` by repository. */
function objective(
  features: Record<
    string,
    { body?: string; milestone?: string; labels?: string[]; work: number[] }[]
  >,
  extra: Record<
    string,
    { number: number; title: string; labels?: string[]; addedAfter?: number }[]
  > = {},
  milestones: Record<string, { title: string; closed: boolean }[]> = {},
): Scenario {
  let next = 100;
  const repositories: Record<string, { issues: unknown[]; milestones?: unknown[] }> = {};
  const children: string[] = [];
  for (const name of ['x/app', 'x/lib', 'x/cli']) {
    const issues: unknown[] =
      name === 'x/app' ? [{ number: 1, title: '[Objective] o', labels: ['objective'] }] : [];
    for (const feature of features[name] ?? []) {
      next += 1;
      children.push(`${name}#${next}`);
      issues.push({
        number: next,
        title: '[Feature] f',
        milestone: feature.milestone ?? 'M001',
        body: feature.body ?? '',
        labels: ['feature', ...(feature.labels ?? [])],
        subIssues: [...feature.work, ...(extra[name] ?? []).map((i) => i.number)],
      });
      for (const nr of feature.work)
        issues.push({ number: nr, title: `[PBI] feat: work ${nr}`, labels: ['pbi'] });
    }
    for (const issue of extra[name] ?? []) issues.push({ labels: ['pbi'], ...issue });
    repositories[name] = {
      issues,
      milestones: milestones[name] ?? [{ title: 'M001', closed: false }],
    };
  }
  const objectiveIssue = repositories['x/app']?.issues[0] as Record<string, unknown>;
  objectiveIssue.body = '## Affected repos\n- x/app\n- x/lib\n- x/cli';
  objectiveIssue.subIssues = children;
  return { items: [], repositories };
}

describe('deliver-loop --objective', () => {
  fixture();
  let reposDir: string;
  beforeAll(() => {
    // every repository of the Objective is a copy of the fixture origin, with the head of the fake pull requests
    git(repo, 'push', '--quiet', 'origin', 'abc123');
    reposDir = path.join(root, 'remotes');
    for (const name of ['app', 'lib', 'cli']) {
      mkdirSync(path.join(reposDir, 'x'), { recursive: true });
      execFileSync('git', [
        'clone',
        '--quiet',
        '--bare',
        path.join(root, 'origin.git'),
        path.join(reposDir, 'x', `${name}.git`),
      ]);
    }
  });
  const run = (
    scenario: Scenario,
    extra: { parallel?: number; args?: string[]; env?: Record<string, string> } = {},
  ) =>
    loop(
      { sessionMs: 0, ...scenario },
      {
        args: ['--objective', 'x/app#1', '--no-retro', ...(extra.args ?? [])],
        parallel: extra.parallel ?? 2,
        env: { DELIVER_REPOS_DIR: reposDir, ...extra.env },
      },
    );

  it('runs two independent issues of different repositories at once', async () => {
    const out = await run({
      ...objective({ 'x/app': [{ work: [11] }], 'x/lib': [{ work: [21] }] }),
      sessionMs: 400,
    });
    expect(out.status, out.stdout + out.stderr).toBe(0);
    const [a, b] = [implementer(out.spans, 11), implementer(out.spans, 21)];
    expect(a && b && overlap(a, b)).toBe(true);
    expect(out.merges.map((m) => m.pull).sort((a, b) => a - b)).toEqual([111, 121]);
    expect(out.calls.filter((c) => c === 'releasePull')).toHaveLength(2);
    expect(out.stdout).toContain('done (2):');
    // a repository without a Feature has nothing to do
    expect(out.stdout).toMatch(/x\/cli \(no unit\)/);
  });

  it('never runs more than maxSessions across repositories nor more than parallel in one', async () => {
    const out = await run(
      {
        ...objective({
          'x/app': [{ work: [14, 15] }],
          'x/lib': [{ work: [27, 28] }],
          'x/cli': [{ work: [34, 35] }],
        }),
        sessionMs: 300,
      },
      { parallel: 1, args: ['--max-sessions', '2'] },
    );
    expect(out.status, out.stdout + out.stderr).toBe(0);
    // the sessions running at the start of each one: the highest number at the same moment
    const peak = (spans: Span[]) =>
      Math.max(0, ...spans.map((s) => spans.filter((o) => o.at <= s.at && s.at < o.end).length));
    expect(peak(out.spans)).toBe(2);
    for (const tens of [1, 2, 3])
      expect(peak(out.spans.filter((s) => Math.floor(s.id / 10) === tens))).toBe(1);
  });

  it('starts a repository with an unreleased upstream milestone after the release, never before', async () => {
    const out = await run({
      ...objective({
        'x/app': [{ work: [12], body: 'Requires: x/lib@M001 released' }],
        'x/lib': [{ work: [22] }],
      }),
      releaseOnPull: ['x/lib'],
    });
    expect(out.status, out.stdout + out.stderr).toBe(0);
    expect(out.stdout).toContain('x/app M001: upstream x/lib@M001 not released, waits');
    const [upstream, dependent] = [implementer(out.spans, 22), implementer(out.spans, 12)];
    expect(dependent?.at).toBeGreaterThanOrEqual(upstream?.end ?? Number.POSITIVE_INFINITY);
    expect(out.merges.map((m) => m.pull)).toEqual([122, 112]);
  });

  describe('with a GitHub App', () => {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    let server: Server;
    let apiUrl = '';
    // a fake API: the installation id and the token name the repository; `x/lib` has no installation in `missing`
    let missing: string[] = [];
    beforeAll(async () => {
      server = createServer((req, res) => {
        let raw = '';
        req.on('data', (chunk) => {
          raw += chunk;
        });
        req.on('end', () => {
          const installation = /^\/repos\/(.+)\/installation$/.exec(req.url ?? '')?.[1];
          res.setHeader('Content-Type', 'application/json');
          if (installation) {
            res.statusCode = missing.includes(installation) ? 404 : 200;
            res.end(JSON.stringify({ id: 77 }));
            return;
          }
          const name = (JSON.parse(raw) as { repositories: string[] }).repositories[0];
          res.end(
            JSON.stringify({
              token: `token-of-${name}`,
              expires_at: new Date(Date.now() + 3_600_000).toISOString(),
            }),
          );
        });
      });
      await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
      apiUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    });
    afterAll(() => {
      server.close();
    });
    const withApp = () => {
      const keyFile = path.join(root, 'app-key.pem');
      writeFileSync(keyFile, privateKey);
      return run(objective({ 'x/app': [{ work: [16] }], 'x/lib': [{ work: [29] }] }), {
        env: {
          DELIVER_APP_ID: '4242',
          DELIVER_APP_KEY_FILE: keyFile,
          DELIVER_APP_KEY_COMMAND: '',
          DELIVER_APP_API_URL: apiUrl,
        },
      });
    };

    it('gives each session the token of its repository and nothing to mint one', async () => {
      missing = [];
      const out = await withApp();
      expect(out.status, out.stdout + out.stderr).toBe(0);
      expect(Object.fromEntries(out.sessions.map((s) => [s.id, s.ghToken]))).toEqual({
        16: 'token-of-app',
        29: 'token-of-lib',
      });
      for (const session of out.sessions) {
        expect(session.mintingVariables).toEqual([]);
        expect(session.hasSessionTokenVariable).toBe(false);
      }
    });

    it('makes a failed mint a needs-you of that repository only', async () => {
      missing = ['x/lib'];
      const out = await withApp();
      expect(out.status, out.stdout + out.stderr).toBe(2);
      expect(out.sessions.map((s) => s.id)).toEqual([16]);
      expect(out.merges.map((m) => m.pull)).toEqual([116]);
      const needsYou = out.stdout.slice(out.stdout.lastIndexOf('needs you ('));
      expect(needsYou).toContain(
        'x/lib: clone failed: GitHub GET /repos/x/lib/installation: HTTP 404',
      );
      expect(needsYou).not.toContain('x/app');
    });
  });

  it('holds back only the dependents of a repository that waits for a person', async () => {
    const out = await run({
      ...objective({
        'x/app': [{ work: [13], body: 'Requires: x/lib@M001 released' }],
        'x/lib': [{ work: [23] }],
        'x/cli': [{ work: [33] }],
      }),
      // the release of x/lib waits for its release test: a person tests it and merges the release pull request
      releaseTests: [90],
    });
    expect(out.status, out.stdout + out.stderr).toBe(3);
    expect(out.merges.map((m) => m.pull).sort((a, b) => a - b)).toEqual([123, 133]);
    expect(implementer(out.spans, 13)).toBeUndefined();
    expect(out.stdout).toMatch(
      /needs you \(\d+\):[\s\S]*x\/app M001: upstream x\/lib@M001 not released/,
    );
    expect(out.stdout).toContain('x/lib M001: #90');
    expect(out.stdout.trim().split('\n').pop()).toBe('needs you: nothing else can start');
  });

  it('works an item added during the run and skips a deferred Feature', async () => {
    const out = await run(
      {
        ...objective(
          { 'x/lib': [{ work: [24] }, { work: [25], labels: ['deferred'] }] },
          { 'x/lib': [{ number: 26, title: '[PBI] feat: added later', addedAfter: 24 }] },
        ),
      },
      { parallel: 1 },
    );
    expect(out.status, out.stdout + out.stderr).toBe(0);
    expect(out.merges.map((m) => m.pull)).toEqual([124, 126]);
    expect(implementer(out.spans, 25)).toBeUndefined();
  });
});
