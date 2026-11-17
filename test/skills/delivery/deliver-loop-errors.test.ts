import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const LOOP = path.resolve(__dirname, '../../../skills/delivery/deliver/scripts/deliver-loop.mts');

// #712: a user error ends with one line on stderr and exit code 1, never a stack trace.
const loop = (args: string[], cwd: string) =>
  spawnSync(process.execPath, [LOOP, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(cwd) },
  });

describe('deliver-loop user errors', () => {
  it('outside a git repository: one line, exit 1', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'deliver-nogit-'));
    const r = loop(['--milestone', 'M1'], dir);
    expect(r.status).toBe(1);
    expect(r.stderr.trim().split('\n')).toHaveLength(1);
    expect(r.stderr).toContain('deliver-loop: not a git repository. Run it from');
  });

  it('unknown option: one line naming it and the valid options, exit 1', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'deliver-opt-'));
    const r = loop(['--help'], dir);
    expect(r.status).toBe(1);
    expect(r.stderr.trim().split('\n')).toHaveLength(1);
    expect(r.stderr).toContain("Unknown option '--help'");
    expect(r.stderr).toContain('--milestone');
    expect(r.stderr).not.toContain('    at ');
  });
});
