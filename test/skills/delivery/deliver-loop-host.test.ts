import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as proc from '../../../skills/delivery/deliver/scripts/loop/hosts/process.ts';
import * as records from '../../../skills/delivery/deliver/scripts/loop/records.ts';
import * as select from '../../../skills/delivery/deliver/scripts/loop/select-host.ts';
import { stdoutLines, TestHost } from '../../helpers/loop-test-host';

const loop = path.resolve(__dirname, '../../../skills/delivery/deliver/scripts/loop');
const fixture = (n: string) => fs.readFileSync(path.resolve(__dirname, 'fixtures', n), 'utf8');
const anyReq = { harness: 'claude', model: 'm', prompt: 'p', cwd: '.', env: {} } as const;

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const r of it) out.push(r);
  return out;
}

describe('record parsers', () => {
  it('parses the Claude stream-json fixture', async () => {
    const host = new TestHost([
      ...stdoutLines(fixture('claude-stream-json.jsonl')),
      { kind: 'exit', code: 0 },
    ]);
    const out = await collect(records.parseSession('claude', host.runSession(anyReq)));
    expect(out).toEqual([
      { kind: 'tool', prefix: '', name: 'Bash', what: 'Show status' },
      { kind: 'tool', prefix: '', name: 'Agent', what: 'Review the diff' },
      { kind: 'tool', prefix: '[Review the diff] ', name: 'Read', what: '/a/b.ts' },
      { kind: 'text', prefix: '[subagent] ', text: 'unknown parent' },
      { kind: 'tool-error', prefix: '', text: 'fatal: not a repo' },
      { kind: 'progress', prefix: '', issue: 614, step: 'implement', result: 'tests green' },
      { kind: 'text', prefix: '', text: 'working on it' },
      { kind: 'exit', code: 0 },
    ]);
  });

  it('parses the recorded Copilot fixture: tools, text, subagent prefix', async () => {
    const host = new TestHost(stdoutLines(fixture('copilot-cli-1.0.105.jsonl')));
    const out = await collect(
      records.parseSession('copilot', host.runSession({ ...anyReq, harness: 'copilot' })),
    );
    expect(out.some((r) => r.kind === 'tool' && r.name === 'bash')).toBe(true);
    expect(out.some((r) => r.kind === 'text')).toBe(true);
    expect(
      out.some(
        (r) => r.kind === 'tool' && r.prefix.startsWith('[') && !r.prefix.startsWith('[subagent]'),
      ),
    ).toBe(true);
  });

  it('parses Copilot failures, progress lines and stderr', () => {
    const p = new records.RecordParser('copilot', 'COPILOT_TASK_WAIT_TIMEOUT_SECONDS=3600');
    const line = (o: object) => p.parse({ kind: 'stdout', line: JSON.stringify(o) });
    expect(
      line({
        type: 'tool.execution_complete',
        data: { success: false, error: { message: 'boom' } },
      }),
    ).toEqual([{ kind: 'tool-error', prefix: '', text: 'boom' }]);
    expect(line({ type: 'tool.execution_complete', data: { success: true } })).toEqual([]);
    expect(line({ type: 'assistant.message', data: { content: '#7 review: clean' } })).toEqual([
      { kind: 'progress', prefix: '', issue: 7, step: 'review', result: 'clean' },
    ]);
    expect(line({ type: 'assistant.message', data: { content: '' } })).toEqual([]);
    expect(p.parse({ kind: 'stdout', line: 'not json' })).toEqual([
      { kind: 'unparsed', text: 'not json' },
    ]);
    expect(p.parse({ kind: 'stderr', text: 'warn' })).toEqual([{ kind: 'stderr', text: 'warn' }]);
  });

  it('flags the ceiling stop on stderr', () => {
    const p = new records.RecordParser('claude', 'CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0');
    const text = 'Background tasks still running (2), stopping them';
    expect(p.parse({ kind: 'stderr', text })).toEqual([
      { kind: 'stderr', text, ceilingStop: 'CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0' },
    ]);
  });

  it('cuts long text to the first line', () => {
    expect(records.short('x'.repeat(200))).toBe(`${'x'.repeat(120)}…`);
    expect(records.short('\n\n  \nfirst\nsecond')).toBe('first');
  });
});

describe('process host', () => {
  const req = {
    harness: 'claude',
    model: 'haiku',
    prompt: '/deliver 5 --unattended --max 1',
    cwd: '.',
    env: { AGENT_EVENTS_RUN: 'r1', DELIVER_LOOP_DIR: '/x' },
  } as const;

  it('builds the argv of today for both harnesses', () => {
    expect(proc.buildArgv(req)).toEqual([
      '-p',
      req.prompt,
      '--model',
      'haiku',
      '--permission-mode',
      'auto',
      '--output-format',
      'stream-json',
      '--verbose',
    ]);
    expect(proc.buildArgv({ ...req, harness: 'copilot' })).toEqual([
      '-p',
      req.prompt,
      '--model',
      'haiku',
      '--allow-all-tools',
      '--allow-all-paths',
      '--allow-all-urls',
      '--no-ask-user',
      '--output-format',
      'json',
    ]);
  });

  it('sets the environment, keeps a user ceiling, leaves the caller env alone', () => {
    const base = { AGENT_EVENTS_OWNER: '1', PATH: '/bin' };
    const env = proc.buildEnv({ ...req }, base);
    expect(env).toMatchObject({
      AGENT_EVENTS_RUN: 'r1',
      AGENT_EVENTS_OWNER: '',
      DELIVER_LOOP_DIR: '/x',
      CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0',
      PATH: '/bin',
    });
    expect(base).toEqual({ AGENT_EVENTS_OWNER: '1', PATH: '/bin' });
    expect(
      proc.buildEnv({ ...req, harness: 'copilot' }, {}).COPILOT_TASK_WAIT_TIMEOUT_SECONDS,
    ).toBe('3600');
    expect(
      proc.buildEnv({ ...req }, { CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '5000' })
        .CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS,
    ).toBe('5000');
    expect(proc.ceilingText('claude', { CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '5000' })).toBe(
      'CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=5000',
    );
  });

  it.skipIf(process.platform === 'win32')(
    'runs a child process without a shell and ends with the exit code',
    async () => {
      const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'host-'));
      fs.writeFileSync(
        path.join(dir, 'claude'),
        '#!/bin/sh\necho "{\\"argc\\":$#}"\necho "$AGENT_EVENTS_RUN|$AGENT_EVENTS_OWNER|$1|$2" >&2\nexit 3\n',
        {
          mode: 0o755,
        },
      );
      const saved = process.env.PATH;
      process.env.PATH = `${dir}${path.delimiter}${saved}`;
      try {
        const out = await collect(
          new proc.ProcessHost().runSession({ ...req, cwd: dir, prompt: '$(touch pwned); x' }),
        );
        expect(out).toEqual([
          { kind: 'stdout', line: '{"argc":9}' },
          { kind: 'stderr', text: 'r1||-p|$(touch pwned); x' },
          { kind: 'exit', code: 3 },
        ]);
        expect(fs.existsSync(path.join(dir, 'pwned'))).toBe(false);
        expect(process.env.AGENT_EVENTS_RUN).not.toBe('r1');
      } finally {
        process.env.PATH = saved;
      }
    },
  );

  it('reports a missing harness as stderr plus exit 127', async () => {
    const saved = process.env.PATH;
    process.env.PATH = path.join(os.tmpdir(), 'no-such-bin-dir');
    try {
      const out = await collect(new proc.ProcessHost().runSession(req));
      expect(out.at(-1)).toEqual({ kind: 'exit', code: 127 });
    } finally {
      process.env.PATH = saved;
    }
  });
});

describe('DELIVER_HOST', () => {
  it('unset means process, a name selects the module', async () => {
    expect(await select.selectHost({})).toBeInstanceOf(proc.ProcessHost);
    expect(await select.selectHost({ DELIVER_HOST: 'process' })).toBeInstanceOf(proc.ProcessHost);
  });

  it('an unknown name or a path-like name is rejected with 64', async () => {
    for (const name of ['nope', '../host', 'a/b']) {
      await expect(select.selectHost({ DELIVER_HOST: name })).rejects.toMatchObject({
        exitCode: 64,
      });
    }
  });

  it('exits 64 with a message in a real process', () => {
    // own process: process.exit
    const r = spawnSync(
      process.execPath,
      [
        '-e',
        `import(${JSON.stringify(path.join(loop, 'select-host.ts'))}).then(m => m.selectHostOrExit())`,
      ],
      {
        env: { ...process.env, DELIVER_HOST: 'nope' },
        encoding: 'utf8',
      },
    );
    expect(r.status).toBe(64);
    expect(r.stderr).toContain("unknown DELIVER_HOST 'nope'");
  });
});

describe('test host', () => {
  it('yields scripted records and records the request', async () => {
    const host = new TestHost([
      { kind: 'stdout', line: '{}' },
      { kind: 'exit', code: 0 },
    ]);
    const out = await collect(host.runSession(anyReq));
    expect(out.at(-1)).toEqual({ kind: 'exit', code: 0 });
  });
});
