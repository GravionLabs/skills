// deliver: the loop of one repository is a module (run-repository.mts), the stop request a shared object
// (stop-signal.mts). The loop itself is tested through deliver-loop.mts in deliver.test.ts.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const scripts = path.resolve(__dirname, '../../../skills/delivery/deliver/scripts');
const { StopSignal } = (await import(
  path.join(scripts, 'stop-signal.mts')
)) as typeof import('../../../skills/delivery/deliver/scripts/stop-signal.mts');

describe('StopSignal', () => {
  const watched: InstanceType<typeof StopSignal>[] = [];
  afterEach(() => {
    vi.useRealTimers();
    for (const signal of watched.splice(0)) {
      process.removeListener('SIGINT', signal.request);
      process.removeListener('SIGBREAK', signal.request);
    }
  });

  it('ends every enlisted session of every repository that shares it', () => {
    const signal = new StopSignal();
    const ended: string[] = [];
    signal.enlist(() => ended.push('a'));
    const unlist = signal.enlist(() => ended.push('b'));
    signal.enlist(() => ended.push('c'));
    unlist();
    expect(signal.stopped).toBe(false);
    signal.request();
    expect(signal.stopped).toBe(true);
    expect(ended).toEqual(['a', 'c']);
  });

  it('listens to Ctrl-C once and sees the stop file of any run folder it watches', () => {
    vi.useFakeTimers();
    const signal = new StopSignal();
    watched.push(signal);
    const dir = mkdtempSync(path.join(tmpdir(), 'stop-signal-'));
    try {
      const before = process.listenerCount('SIGINT');
      signal.watch(path.join(dir, 'one', 'stop'));
      signal.watch(path.join(dir, 'stop'));
      expect(process.listenerCount('SIGINT')).toBe(before + 1);
      let ended = false;
      signal.enlist(() => {
        ended = true;
      });
      vi.advanceTimersByTime(500);
      expect(signal.stopped).toBe(false);
      writeFileSync(path.join(dir, 'stop'), '');
      vi.advanceTimersByTime(500);
      expect(signal.stopped).toBe(true);
      expect(ended).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('deliver-loop.mts', () => {
  const cli = readFileSync(path.join(scripts, 'deliver-loop.mts'), 'utf8');

  it('runs the repository once through runRepository and exits with its code', () => {
    expect(cli).toContain("from './run-repository.mts'");
    expect(cli.match(/await runRepository\(/g)).toHaveLength(1);
    expect(cli).toContain('process.exit(result.exitCode)');
  });

  it('keeps no mutable state at module level', () => {
    expect(cli).not.toMatch(/^(let|var) /m);
  });
});
