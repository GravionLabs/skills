import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  AGENT_EVENTS_DIR,
  AGENT_EVENTS_TAG,
  CORE_EVENT_FIXTURES,
  DELIVER_FIXTURES,
  DELIVER_PROFILE_SCHEMA,
  checkRunFile,
} from '../../helpers/agent-events';

// ADR 0003: the core of the progress events (schema/v0/, fixtures/events/, fixtures/state/) lives in
// GravionLabs/agent-events. test/skills/delivery/agent-events/ is a copy of the tag in its VERSION file. To bump the pin:
// write the new tag to VERSION and replace schema/ and fixtures/ with the ones of the tag
//   gh api repos/GravionLabs/agent-events/tarball/<tag> > ae.tgz   (then copy schema/ and fixtures/ from the archive)
// The comparison uses the blob SHAs of one tree call. AGENT_EVENTS_VERIFY=1 makes it mandatory (CI); otherwise it is
// skipped when gh or the network is unavailable, so the suite does not hang offline.
const REPO = 'GravionLabs/agent-events';
const ROOT = path.resolve(__dirname, '../../..');

const walk = (dir: string, rel = ''): string[] =>
  fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((d) => {
    const p = rel ? `${rel}/${d.name}` : d.name;
    return d.isDirectory() ? walk(dir, p) : [p];
  });
const blobSha = (file: string) => {
  const body = fs.readFileSync(file);
  return createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${body.length}\0`), body]))
    .digest('hex');
};
const gh = (args: string[]) =>
  spawnSync('gh', ['api', ...args], { encoding: 'utf8', timeout: 15000, maxBuffer: 16 << 20 });

const must = process.env.AGENT_EVENTS_VERIFY === '1';
const online = (() => {
  if (spawnSync('gh', ['--version']).status !== 0) return false;
  return gh([`repos/${REPO}/git/ref/tags/${AGENT_EVENTS_TAG}`, '--jq', '.ref']).status === 0;
})();

describe('agent-events pin (#452)', () => {
  it('records the tag in one place: v0.2.0', () => {
    expect(fs.readFileSync(path.join(AGENT_EVENTS_DIR, 'VERSION'), 'utf8')).toBe('v0.2.0\n');
    expect(AGENT_EVENTS_TAG).toBe('v0.2.0');
  });

  it('the pre-core schemas are gone from skills and from the copy', () => {
    for (const f of ['progress-event.schema.json', 'deliver-run-state.schema.json']) {
      expect(fs.existsSync(path.join(ROOT, 'skills/delivery/deliver/schema', f)), f).toBe(false);
      expect(fs.existsSync(path.join(AGENT_EVENTS_DIR, 'schema', f)), f).toBe(false);
    }
  });

  it('CI sets AGENT_EVENTS_VERIFY=1 for the tests, so a missing tag or a differing copy fails', () => {
    const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toMatch(/AGENT_EVENTS_VERIFY: '?1'?/);
    expect(ci).toMatch(/GH_TOKEN: \$\{\{ (github\.token|secrets\.GITHUB_TOKEN) \}\}/);
  });

  it.skipIf(!online && !must)(
    'the copy equals schema/ and fixtures/ of the tag (offline: skipped; AGENT_EVENTS_VERIFY=1 fails instead)',
    () => {
      expect(online, `cannot reach ${REPO}@${AGENT_EVENTS_TAG} with gh api`).toBe(true);
      const r = gh([`repos/${REPO}/git/trees/${AGENT_EVENTS_TAG}?recursive=1`]);
      expect(r.status, r.stderr).toBe(0);
      const tree = JSON.parse(r.stdout) as {
        truncated: boolean;
        tree: { path: string; type: string; sha: string }[];
      };
      expect(tree.truncated).toBe(false);
      const remote = Object.fromEntries(
        tree.tree
          .filter((t) => t.type === 'blob' && /^(schema|fixtures)\//.test(t.path))
          .map((t) => [t.path, t.sha]),
      );
      const local = Object.fromEntries(
        ['schema', 'fixtures']
          .flatMap((sub) => walk(AGENT_EVENTS_DIR, sub))
          .map((p) => [p, blobSha(path.join(AGENT_EVENTS_DIR, p))]),
      );
      expect(local).toEqual(remote);
    },
    30000,
  );
});

describe('run file check of the tests (helpers/agent-events.ts)', () => {
  const cases = (kind: string) =>
    fs.readdirSync(path.join(CORE_EVENT_FIXTURES, kind)).filter((f) => f.endsWith('.jsonl'));
  const read = (kind: string, f: string) =>
    fs.readFileSync(path.join(CORE_EVENT_FIXTURES, kind, f), 'utf8');

  it.each(cases('valid'))('accepts the core fixture valid/%s', (f) => {
    expect(checkRunFile(read('valid', f))).toEqual([]);
  });

  it.each(cases('invalid'))('rejects the core fixture invalid/%s', (f) => {
    expect(checkRunFile(read('invalid', f))).not.toEqual([]);
  });

  it('with known types, a type before the core format fails', () => {
    const lines = read('valid', 'full-run.jsonl').split('\n');
    const old = JSON.parse(lines[1]);
    old.type = 'issue.started';
    old.seq = 2;
    const text = [lines[0], JSON.stringify(old), ''].join('\n');
    expect(checkRunFile(text)).toEqual([]);
    expect(checkRunFile(text, { known: true })).toEqual(['line 2: unknown type issue.started']);
  });
});

describe('deliver profile deliver@1 (#452)', () => {
  const profile = JSON.parse(fs.readFileSync(DELIVER_PROFILE_SCHEMA, 'utf8'));
  const fixtures = fs.readdirSync(DELIVER_FIXTURES).filter((f) => f.endsWith('.jsonl'));

  it('names its tone rules and declares the run.started URL as its $id', () => {
    expect(profile.description).toContain('Tone rules');
    for (const f of fixtures) {
      const first = JSON.parse(
        fs.readFileSync(path.join(DELIVER_FIXTURES, f), 'utf8').split('\n')[0],
      );
      expect(first.profiles, f).toEqual(['deliver@1']);
      expect(first.profileSchemas, f).toEqual({ 'deliver@1': profile.$id });
    }
  });

  it.each(fixtures)('%s: valid against the core and the profile, only known types', (f) => {
    const text = fs.readFileSync(path.join(DELIVER_FIXTURES, f), 'utf8');
    // running.jsonl keeps two unknown types on purpose (readers ignore them)
    expect(checkRunFile(text, { known: f !== 'running.jsonl', deliver: true })).toEqual([]);
  });

  it.each([
    ['attention without deliver.kind', { type: 'attention', deliver: {} }],
    ['ci_red attention with tone warning', { type: 'attention', deliver: { kind: 'ci_red' } }],
    ['needs_you attention without needsYou', { type: 'attention', needsYou: false }],
    ['blocked task.finished as succeeded', { type: 'task.finished', outcome: 'succeeded' }],
    ['task id outside issue-<nr>', { type: 'task.started', task: 't1' }],
    ['reason code without prefix', { type: 'attention', reason: 'ci-red' }],
  ])('rejects %s', (_name, change) => {
    const base: Record<string, Record<string, unknown>> = {
      attention: {
        type: 'attention',
        tone: 'warning',
        id: 'a1',
        reason: 'deliver.needs-you',
        needsYou: true,
        deliver: { kind: 'needs_you', issue: 1 },
      },
      'task.finished': {
        type: 'task.finished',
        tone: 'danger',
        task: 'issue-1',
        outcome: 'skipped',
        reason: 'deliver.blocked',
        deliver: { outcome: 'blocked' },
      },
      'task.started': {
        type: 'task.started',
        tone: 'neutral',
        task: 'issue-1',
        subject: { kind: 'github.issue', id: 'a/b#1', title: 'x' },
      },
    };
    const env = { v: 1, seq: 1, ts: '2026-11-08T10:00:00.000Z', run: 'r1' };
    const before = { ...env, ...base[change.type as string] };
    const run = (ev: object) =>
      [
        JSON.stringify({
          ...env,
          type: 'run.started',
          tone: 'neutral',
          profiles: ['deliver@1'],
          host: {},
          deliver: { source: 'loop' },
        }),
        JSON.stringify({ ...ev, seq: 2 }),
        '',
      ].join('\n');
    expect(checkRunFile(run(before), { deliver: true })).toEqual([]);
    expect(checkRunFile(run({ ...before, ...change }), { deliver: true })).not.toEqual([]);
  });
});
