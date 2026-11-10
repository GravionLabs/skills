import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  CORE_DEFAULT_NOW,
  CORE_STATE_FIXTURES,
  DELIVER_FIXTURES,
  validateCoreState,
  validateDeliverState,
} from '../../helpers/agent-events';
import { PwshWorker } from '../../helpers/pwsh-worker';

const ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(ROOT, 'skills/delivery/deliver/scripts/ConvertFrom-ProgressEvents.ps1');
// the deliver fixtures are folded with this "now" and without the pid test (the fixture pid is not a live process).
// Written with a space, not a T: the worker reads its request with ConvertFrom-Json, which would turn an ISO string
// into a DateTime and hand the script a local-time string.
const NOW = '2026-11-07 12:00:00Z';
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));
const casesOf = (dir: string) =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => f.replace(/\.jsonl$/, ''))
    .sort();
const coreCases = casesOf(CORE_STATE_FIXTURES);
const deliverCases = casesOf(DELIVER_FIXTURES);
const withoutDeliver = (s: Record<string, unknown>) => {
  const { deliver: _d, ...core } = s;
  return core;
};

describe('fixtures/progress-events: the deliver profile fixtures (#370, #452)', () => {
  it('has at least the cases of the PBIs', () => {
    for (const c of [
      'running',
      'done',
      'blocked',
      'paused-needs-you',
      'release-review-round',
      'rc-test-open',
      'abandoned',
      'incomplete-last-line',
      'merging',
    ])
      expect(deliverCases).toContain(c);
  });

  it.each(deliverCases)('%s: the state is a valid core state plus a valid deliver state', (c) => {
    const state = readJson(path.join(DELIVER_FIXTURES, `${c}.state.json`));
    expect(validateCoreState(state), JSON.stringify(validateCoreState.errors)).toBe(true);
    expect(validateDeliverState(state.deliver), JSON.stringify(validateDeliverState.errors)).toBe(
      true,
    );
  });
});

describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'ConvertFrom-ProgressEvents.ps1 (#370, #452)',
  () => {
    let worker: PwshWorker;
    let tmp: string;
    const fold = async (file: string, now = NOW, ...extra: string[]) => {
      const r = await worker.run(['-Path', file, '-Now', now, '-NoPidCheck', ...extra], {
        cwd: tmp,
      });
      return { ...r, state: r.status === 0 ? JSON.parse(r.stdout) : null };
    };
    const writeEvents = (name: string, text: string) => {
      const f = path.join(tmp, `${name}.jsonl`);
      fs.writeFileSync(f, text);
      return f;
    };
    const fixtureLines = (c: string) =>
      fs
        .readFileSync(path.join(DELIVER_FIXTURES, `${c}.jsonl`), 'utf8')
        .trimEnd()
        .split('\n');
    const ev = (seq: number, type: string, extra: object = {}) =>
      JSON.stringify({
        v: 1,
        seq,
        ts: '2026-11-07T11:50:00.000Z',
        run: 'r',
        type,
        tone: 'neutral',
        ...extra,
      });

    beforeAll(() => {
      tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'reducer-')));
      worker = new PwshWorker(SCRIPT);
    });
    afterAll(() => {
      worker?.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it.each(coreCases)(
      'core fixture %s: the core state of the pinned agent-events tag',
      async (c) => {
        const nowFile = path.join(CORE_STATE_FIXTURES, `${c}.now`);
        const now = fs.existsSync(nowFile)
          ? fs.readFileSync(nowFile, 'utf8').trim()
          : CORE_DEFAULT_NOW;
        const r = await fold(path.join(CORE_STATE_FIXTURES, `${c}.jsonl`), now.replace('T', ' '));
        expect(r.status, r.stderr).toBe(0);
        expect(withoutDeliver(r.state)).toEqual(
          readJson(path.join(CORE_STATE_FIXTURES, `${c}.state.json`)),
        );
      },
    );

    it.each(deliverCases)('deliver fixture %s: folds into %s.state.json', async (c) => {
      const r = await fold(path.join(DELIVER_FIXTURES, `${c}.jsonl`));
      expect(r.status, r.stderr).toBe(0);
      expect(r.state).toEqual(readJson(path.join(DELIVER_FIXTURES, `${c}.state.json`)));
    });

    it('yields the same state for the same events and Now', async () => {
      const f = path.join(DELIVER_FIXTURES, 'rc-test-open.jsonl');
      expect((await fold(f)).stdout).toBe((await fold(f)).stdout);
    });

    it.each(['done', 'paused-needs-you', 'rc-test-open'])(
      '%s: unknown fields never change the state, unknown types only lastSeq and updated',
      async (c) => {
        const lines = fixtureLines(c).map((l) => {
          const e = JSON.parse(l);
          e.futureField = { nested: [1, 2] };
          if (e.subject) e.subject.extra = 'x';
          return JSON.stringify(e);
        });
        const r = await fold(writeEvents(`noisy-${c}`, lines.join('\n') + '\n'));
        const expected = readJson(path.join(DELIVER_FIXTURES, `${c}.state.json`));
        // the subject copies of the state keep the extra field: compare without it
        expect(JSON.parse(JSON.stringify(r.state).replaceAll(',"extra":"x"', ''))).toEqual(
          expected,
        );
        const unknown = ev(lines.length + 1, 'future.thing', { task: 'issue-1', deliver: {} });
        const more = await fold(writeEvents(`more-${c}`, [...lines, unknown].join('\n') + '\n'));
        expect(more.state.deliver).toEqual(r.state.deliver);
        expect(more.state.lastSeq).toBe(lines.length + 1);
      },
    );

    it('old-format files: the types before the core format are ignored (#452, one minor of migration)', async () => {
      const old = (seq: number, type: string, extra: object) =>
        JSON.stringify({
          v: 1,
          seq,
          ts: '2026-11-07T11:00:00.000Z',
          run: 'old',
          type,
          tone: 'neutral',
          ...extra,
        });
      const issue = { number: 370, url: 'https://github.com/GravionLabs/skills/issues/370' };
      const r = await fold(
        writeEvents(
          'old',
          [
            old(1, 'run.started', { source: 'loop', milestone: { key: 'M5' }, pid: 4242 }),
            old(2, 'milestone.progress', { closed: 3, total: 9 }),
            old(3, 'issue.started', { issue }),
            old(4, 'step.finished', {
              issue,
              step: { name: 'pr', text: 'opened' },
              prUrl: 'https://x/pull/1',
            }),
            old(5, 'issue.finished', { issue, outcome: 'delivered' }),
          ].join('\n') + '\n',
        ),
      );
      expect(r.status, r.stderr).toBe(0);
      expect(r.state).toMatchObject({
        status: 'running',
        tasks: [],
        finished: { succeeded: [], skipped: [] },
        step: { name: 'pr', text: 'opened' },
        lastSeq: 5,
        deliver: { delivered: [], milestone: null, result: 'running' },
      });
      expect(r.state.progress).toBeUndefined();
    });

    it('depends only on the events up to the last complete line', async () => {
      const lines = fixtureLines('done');
      const head = lines.slice(0, -1).join('\n') + '\n';
      const cut = await fold(writeEvents('cut', head + lines.at(-1)!.slice(0, 40)));
      const whole = await fold(writeEvents('head', head));
      expect(cut.state).toEqual(whole.state);
      expect(cut.state.progress).toMatchObject({ done: 4, total: 9 });
      expect(cut.stderr).toBe('');
    });

    it('records a gap in seq and folds the events anyway', async () => {
      const lines = fixtureLines('done').filter((l) => JSON.parse(l).seq !== 2);
      const r = await fold(writeEvents('gap', lines.join('\n') + '\n'));
      expect(r.status).toBe(0);
      expect(r.state.gaps).toEqual([{ from: 2, to: 2 }]);
      expect(r.state.deliver.delivered).toEqual([
        {
          pbi: 370,
          url: 'https://github.com/GravionLabs/skills/issues/370',
          prUrl: 'https://github.com/GravionLabs/skills/pull/380',
        },
      ]);
    });

    // #511: no pull-request link seen for a delivered PBI → prUrl null, not the issue URL
    it('a delivered PBI without a pull-request link has prUrl null', async () => {
      const lines = fixtureLines('done').map((l) => {
        const e = JSON.parse(l);
        if (Array.isArray(e.links))
          e.links = e.links.filter((k: { rel: string }) => k.rel !== 'pull-request');
        return JSON.stringify(e);
      });
      const r = await fold(writeEvents('no-pr', lines.join('\n') + '\n'));
      expect(r.state.deliver.delivered).toEqual([
        { pbi: 370, url: 'https://github.com/GravionLabs/skills/issues/370', prUrl: null },
      ]);
    });

    it('a run without run.finished is running within the hour and abandoned after it', async () => {
      const f = path.join(DELIVER_FIXTURES, 'running.jsonl');
      expect((await fold(f, '2026-11-07 12:50:00Z')).state.status).toBe('running');
      const late = (await fold(f, '2026-11-07 12:50:01Z')).state;
      expect([late.status, late.deliver.result]).toEqual(['abandoned', 'abandoned']);
    });

    it('a run whose jsonl-file.pid no longer lives is abandoned, a live pid keeps it running', async () => {
      const dead = spawn('true');
      await new Promise((res) => dead.on('exit', res));
      const withPid = (pid: number) =>
        fixtureLines('running')
          .map((l) => {
            const e = JSON.parse(l);
            if (e.type === 'run.started') e.host['jsonl-file.pid'] = String(pid);
            return JSON.stringify(e);
          })
          .join('\n') + '\n';
      const status = async (name: string, pid: number) =>
        JSON.parse(
          (await worker.run(['-Path', writeEvents(name, withPid(pid)), '-Now', NOW], { cwd: tmp }))
            .stdout,
        ).status;
      expect(await status('dead', dead.pid!)).toBe('abandoned');
      expect(await status('alive', process.pid)).toBe('running');
    });

    it('a delivered PBI without a seen PR URL has prUrl null, not the issue URL', async () => {
      const [start] = fixtureLines('running');
      const subject = { kind: 'github.issue', id: 'GravionLabs/skills#380', title: 'x' };
      const r = await fold(
        writeEvents(
          'no-pr',
          [
            start,
            ev(2, 'task.started', { task: 'issue-380', subject }),
            ev(3, 'task.finished', {
              task: 'issue-380',
              outcome: 'succeeded',
              deliver: { outcome: 'delivered' },
            }),
          ].join('\n') + '\n',
        ),
      );
      expect(r.state.deliver.delivered).toHaveLength(1);
      expect(r.state.deliver.delivered[0].pbi).toBe(380);
      expect(r.state.deliver.delivered[0].prUrl).toBeNull();
    });

    it('a later attempt of an issue replaces its earlier outcome; merging waits until delivered', async () => {
      const [start] = fixtureLines('running');
      const subject = { kind: 'github.issue', id: 'GravionLabs/skills#380', title: 'x' };
      const pr = [{ rel: 'pull-request', url: 'https://github.com/GravionLabs/skills/pull/9' }];
      const r = await fold(
        writeEvents(
          'attempts',
          [
            start,
            ev(2, 'task.started', { task: 'issue-380', subject }),
            ev(3, 'task.finished', {
              task: 'issue-380',
              outcome: 'skipped',
              reason: 'deliver.blocked',
              text: 'open blocker',
              deliver: { outcome: 'blocked' },
            }),
            ev(4, 'task.started', { task: 'issue-380.2', subject }),
            ev(5, 'deliver.merging', { task: 'issue-380.2', links: pr, deliver: { issue: 380 } }),
          ].join('\n') + '\n',
        ),
      );
      expect(r.state.deliver).toMatchObject({
        blocked: [],
        delivered: [],
        merging: [{ number: 380, prUrl: pr[0].url }],
      });
      expect(r.state.tasks.map((t: { task: string }) => t.task)).toEqual(['issue-380.2']);
      const done = await fold(
        writeEvents(
          'attempts-done',
          fs.readFileSync(path.join(tmp, 'attempts.jsonl'), 'utf8') +
            ev(6, 'task.finished', {
              task: 'issue-380.2',
              outcome: 'succeeded',
              deliver: { outcome: 'delivered' },
            }) +
            '\n',
        ),
      );
      expect(done.state.deliver).toMatchObject({
        merging: [],
        delivered: [{ pbi: 380, prUrl: pr[0].url }],
      });
    });

    it('a needs-you attention stays after its PBI pauses and leaves with attention.resolved', async () => {
      // the fixture without its run.finished (which closes every attention)
      const lines = fixtureLines('paused-needs-you').slice(0, -1);
      const paused = await fold(writeEvents('paused', lines.join('\n') + '\n'));
      expect(paused.state).toMatchObject({
        needsYou: true,
        attentions: [{ id: 'a5', reason: 'deliver.needs-you' }],
        deliver: { needsYou: [{ number: 372 }], paused: [{ number: 372 }] },
      });
      const resolved = [...lines, ev(7, 'attention.resolved', { id: 'a5' })];
      const r = await fold(writeEvents('resolved', resolved.join('\n') + '\n'));
      expect([r.state.needsYou, r.state.attentions, r.state.deliver.needsYou]).toEqual([
        false,
        [],
        [],
      ]);
    });

    it('a new RC test issue replaces the older one in needsYou', async () => {
      const gh = 'https://github.com/GravionLabs/skills';
      const lines = [
        ...fixtureLines('rc-test-open').slice(0, 5),
        ev(6, 'deliver.release.updated', {
          deliver: { rcVersion: '3.3.0-rc.1', testIssue: { number: 410, url: `${gh}/issues/410` } },
        }),
      ];
      const r = await fold(writeEvents('replace', lines.join('\n') + '\n'));
      expect(r.state.deliver.needsYou).toEqual([
        { number: 410, url: `${gh}/issues/410`, reason: 'RC test' },
      ]);
      expect(r.state.deliver.release).toMatchObject({
        rcVersion: '3.3.0-rc.1',
        testIssue: { number: 410 },
      });
    });

    it('fails with one stderr line when there is no event', async () => {
      const empty = await worker.run(['-Path', writeEvents('empty', ''), '-Now', NOW], {
        cwd: tmp,
      });
      expect(empty.status).toBe(1);
      expect(empty.stderr).toContain('no progress events');
      const missing = await worker.run(['-Path', path.join(tmp, 'nope.jsonl')], { cwd: tmp });
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain('no event file');
    });

    it('reads the events from the pipeline', () => {
      // own process: pipeline input from Get-Content
      const f = path.join(DELIVER_FIXTURES, 'blocked.jsonl');
      const r = spawnSync(
        'pwsh',
        [
          '-NoProfile',
          '-Command',
          `Get-Content -LiteralPath '${f}' | & '${SCRIPT}' -Now '${NOW}' -NoPidCheck`,
        ],
        { encoding: 'utf8' },
      );
      expect(r.status, r.stderr).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual(
        readJson(path.join(DELIVER_FIXTURES, 'blocked.state.json')),
      );
    });
  },
);
