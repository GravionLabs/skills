// deliver: the leaf driver (leaf-driver.mts) and the child-process host (process-host.mts) of `deliver.leafFlow`
// `step` (#1194). The driver executes the verbs the step script returns and passes each outcome back unchanged; the
// host runs real child processes. The loop in both modes: deliver-run-repository.test.ts.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Action,
  BACKOFF_S,
  STAGE_TIMEOUT_S,
  type StepResult,
} from '../../../skills/delivery/deliver-lead/scripts/leaf.mts';
import { driveLeaf } from '../../../skills/delivery/deliver/scripts/leaf-driver.mts';
import {
  commandOf,
  processHost,
  resultLine,
} from '../../../skills/delivery/deliver/scripts/process-host.mts';

const scripts = path.resolve(__dirname, '../../../skills/delivery/deliver/scripts');

/** A `wait-any` action of the step script. */
const wait = (handles: string[], timeout: number): Action => ({ do: 'wait-any', handles, timeout });

describe('the leaf driver', () => {
  const start: Extract<Action, { do: 'start-worker' }> = {
    do: 'start-worker',
    role: 'implementer',
    name: 'issue-7-implement',
    brief: 'Deliver issue #7 in this worktree: run `/deliver 7 --base main`.',
    branch: 'feat/7-x',
    base: 'main',
    model: 'sonnet',
    env: {},
  };

  it('executes each action as its verb and passes every outcome back unchanged', async () => {
    const actions: Action[] = [
      start,
      wait(['h1'], STAGE_TIMEOUT_S),
      { do: 'read-result', handle: 'h1', question: 'which one?' },
      wait([], BACKOFF_S.min),
      { do: 'read-result', handle: 'h1' },
      { do: 'end', report: { issue: 7, outcome: 'merged', reason: 'merged' } },
    ];
    const outcomes: StepResult[] = [
      { handle: 'h1', name: 'issue-7-implement' },
      { handle: 'h1', state: 'done' },
      { handle: 'h1', answer: 'refused' },
      { state: 'timeout' },
      { handle: 'h1', report: '/r.md' },
    ];
    const verbs: string[] = [];
    const seen: (StepResult | undefined)[] = [];
    const host = {
      startWorker: async () => (verbs.push('start-worker'), outcomes[0]!),
      waitAny: async (handles: string[]) => (
        verbs.push(`wait-any ${handles.length}`),
        outcomes[handles.length ? 1 : 3]!
      ),
      readResult: () => (verbs.push('read-result'), outcomes[4]!),
      answerWorker: () => (verbs.push('answer-worker'), outcomes[2]!),
      askOwner: () => (verbs.push('ask-owner'), { answer: 'deferred' as never }),
    };
    const out = await driveLeaf({
      step: async (result) => {
        seen.push(result);
        return actions[seen.length - 1]!;
      },
      host,
      stopped: () => false,
    });
    expect(out).toEqual({ report: { issue: 7, outcome: 'merged', reason: 'merged' } });
    expect(verbs).toEqual([
      'start-worker',
      'wait-any 1',
      'answer-worker',
      'wait-any 0',
      'read-result',
    ]);
    // the very objects the host returned, in order
    expect(seen).toEqual([undefined, ...outcomes]);
    seen.slice(1).forEach((result, i) => expect(result).toBe(outcomes[i]));
  });

  it('asks for no further action after a stop request', async () => {
    let stop = false;
    let calls = 0;
    const out = await driveLeaf({
      step: async () => {
        calls += 1;
        return start;
      },
      host: {
        startWorker: async () => {
          stop = true;
          return { error: 'stopped' };
        },
      } as never,
      stopped: () => stop,
    });
    expect(out).toEqual({ stopped: true });
    expect(calls).toBe(1);
  });

  it.each(['leaf-driver.mts', 'process-host.mts'])(
    '%s imports nothing from gates/ and sets no stage',
    (file) => {
      const source = readFileSync(path.join(scripts, file), 'utf8');
      const imports = [...source.matchAll(/^import[\s\S]*?from '([^']+)';/gm)].map((m) => m[1]!);
      expect(imports.length).toBeGreaterThan(0);
      for (const from of imports) expect(from).not.toMatch(/gates\//);
      expect(source).not.toMatch(/setStage|mergeApproved|\.merge\(/);
    },
  );
});

describe('the child-process host', () => {
  let dir: string;
  let root: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'process-host-'));
    const origin = path.join(dir, 'origin.git');
    root = path.join(dir, 'repo');
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        cwd,
        stdio: 'ignore',
      });
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
    execFileSync('git', ['init', '-q', '-b', 'main', root]);
    git(root, 'commit', '-q', '--allow-empty', '-m', 'a');
    git(root, 'remote', 'add', 'origin', origin);
    git(root, 'push', '-q', 'origin', 'main');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /**
   * A host whose session is `node -e <script>`; the prompt is passed as its argument. One second of waiting lasts
   * 1 ms (`tickMs`): a wait that expects the session to end gets the stage timeout of the leaf (5.4 s here), since a
   * node process takes longer than a few dozen ms to start on a loaded runner.
   */
  const hostOf = (script: string, sessionMs = 10_000) =>
    processHost({
      root,
      runDir: path.join(dir, 'run'),
      command: ({ prompt }) => ['node', '-e', script, prompt],
      env: async () => ({ ...process.env, DELIVER_RESULT_FILE: 'leaked' }),
      acquire: async () => () => {},
      stopped: () => false,
      enlist: () => () => {},
      sessionMs,
      graceMs: 50,
      tickMs: 1,
    });
  const start = (name: string) => ({
    role: 'implementer' as const,
    name,
    brief: 'Deliver issue #5 in this worktree: run `/deliver 5 --base main`.',
    branch: 'feat/5-x',
    base: 'main',
    model: 'sonnet',
    env: { DELIVER_RESULT_FILE: path.join(dir, 'result.json') },
  });

  it('starts a session in the worktree of the issue, waits for it and reads its result line', async () => {
    const host = hostOf(
      "require('fs').writeFileSync(process.env.DELIVER_RESULT_FILE, process.argv[1]); console.log('result: pr https://x/pull/1')",
    );
    const started = await host.startWorker(start('issue-5-implement'));
    expect(started).toEqual({ handle: 'issue-5-implement.1', name: 'issue-5-implement' });
    expect(await host.waitAny([started.handle!], STAGE_TIMEOUT_S)).toEqual({
      handle: started.handle,
      state: 'done',
    });
    // the prompt is the command of the brief; the session gets only the file of its start
    expect(readFileSync(path.join(dir, 'result.json'), 'utf8')).toBe('/deliver 5 --base main');
    const read = host.readResult(started.handle!);
    expect(readFileSync(read.report!, 'utf8')).toContain('outcome: result: pr https://x/pull/1');
    expect(host.sessions()).toMatchObject([{ role: 'implementer', exit: 0 }]);
    // a second start of the same step gets a new handle
    expect((await host.startWorker(start('issue-5-implement'))).handle).toBe('issue-5-implement.2');
    await host.stop();
  });

  it('reports error for a session without a result line, timeout for one that runs on', async () => {
    const quiet = hostOf("console.log('done, no result')");
    const ended = await quiet.startWorker(start('issue-5-fix-1'));
    expect(await quiet.waitAny([ended.handle!], STAGE_TIMEOUT_S)).toMatchObject({
      state: 'error',
    });
    expect(quiet.readResult(ended.handle!)).toEqual({ handle: ended.handle, report: '' });
    const long = hostOf('setInterval(() => {}, 1000)');
    const running = await long.startWorker(start('issue-5-review-1'));
    expect(await long.waitAny([running.handle!], 20)).toEqual({
      handle: running.handle,
      state: 'timeout',
    });
    await long.stop();
    expect(await long.waitAny([running.handle!], 20)).toMatchObject({ state: 'error' });
  });

  it('refuses an answer, defers the owner, and names an unknown handle an error', async () => {
    const host = hostOf('');
    expect(host.answerWorker('h', 'q?')).toEqual({
      handle: 'h',
      answer: 'refused',
      question: 'q?',
    });
    expect(host.askOwner()).toEqual({ answer: 'deferred' });
    expect(await host.waitAny(['nope'], 1)).toEqual({ handle: 'nope', state: 'error' });
    expect(await host.waitAny([], 2)).toEqual({ state: 'timeout' });
    expect(host.wake).toBe('block');
  });

  it('frees the slot and refuses the start when the harness cannot be launched', async () => {
    let held = 0;
    const host = processHost({
      root,
      runDir: path.join(dir, 'run'),
      command: () => [],
      env: async () => ({ ...process.env }),
      acquire: async () => {
        held += 1;
        return () => {
          held -= 1;
        };
      },
      stopped: () => false,
      enlist: () => () => {},
      sessionMs: 10_000,
      graceMs: 50,
      tickMs: 1,
    });
    const out = await host.startWorker(start('issue-5-implement'));
    expect(out.error).toMatch(/^the harness did not start: /);
    expect(out.handle).toBeUndefined();
    expect(held).toBe(0);
    expect(host.sessions()).toEqual([]);
  });

  it('returns an error instead of a handle when the brief names no command', async () => {
    const host = hostOf('');
    expect(await host.startWorker({ ...start('issue-5-implement'), brief: 'nothing' })).toEqual({
      error: 'no command in the brief of issue-5-implement',
    });
  });

  it('reads the result line of plain and stream-json output', () => {
    expect(resultLine('result: reviewed approve')).toBe('result: reviewed approve');
    expect(
      resultLine(JSON.stringify({ type: 'result', is_error: false, result: 'x\nresult: pr u' })),
    ).toBe('result: pr u');
    expect(
      resultLine(JSON.stringify({ type: 'result', is_error: true, result: 'result: pr u' })),
    ).toBeUndefined();
    expect(resultLine('working')).toBeUndefined();
    expect(commandOf('Review it: run `/deliver-review 5 --base main --pr u`.')).toBe(
      '/deliver-review 5 --base main --pr u',
    );
  });
});
