// The terminal state (OSC 7501) and the run folders of an Objective run (objective-report.mts).
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Report } from '../../../skills/delivery/deliver/scripts/program-status.mts';

const { objectiveFolders, objectiveStatus } = (await import(
  path.resolve(__dirname, '../../../skills/delivery/deliver/scripts/objective-report.mts')
)) as typeof import('../../../skills/delivery/deliver/scripts/objective-report.mts');

const title = 'objective x/app#1';

describe('objectiveStatus', () => {
  it('counts running and waiting repositories and stays blocked while a unit needs the owner', () => {
    const sent: Report[] = [];
    const status = objectiveStatus(title, (report) => sent.push(report));
    status.counts({ running: 2, waiting: 1 });
    expect(sent.at(-1)).toEqual({
      state: 'working',
      title,
      msg: 'repositories: 2 running, 1 waiting',
    });
    status.unit('x/lib M001', { state: 'blocked', kind: 'question', title: 'M001', msg: '#2' });
    // another repository going on does not hide it
    status.unit('x/app M001', { state: 'working', title: 'M001' });
    expect(sent.at(-1)).toEqual({
      state: 'blocked',
      kind: 'question',
      title,
      msg: 'repositories: 2 running, 1 waiting; #2',
    });
    status.unit('x/lib M001');
    expect(sent.at(-1)?.state).toBe('working');
    status.counts({ running: 0, waiting: 2 });
    expect(sent.at(-1)).toMatchObject({ state: 'blocked', msg: expect.stringContaining('2 wait') });
    status.finish(3, 2);
    expect(sent.at(-1)).toEqual({
      state: 'done',
      tone: 'warning',
      title,
      msg: 'needs you 2; repositories: 0 running, 2 waiting',
    });
  });
});

describe('objectiveFolders', () => {
  it('has a folder per repository below the events directory and finds those of earlier runs', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'objective-'));
    try {
      const folders = objectiveFolders(dir, 'unused', 'r2');
      expect(folders.repository('x/lib')).toBe(path.join(dir, 'deliver', 'r2', 'x', 'lib'));
      expect(folders.earlier('x/lib')).toEqual([]);
      mkdirSync(path.join(dir, 'deliver', 'r1'), { recursive: true });
      expect(folders.earlier('x/lib')).toEqual([path.join(dir, 'deliver', 'r1', 'x', 'lib')]);
      expect(objectiveFolders(undefined, dir, 'r2').run).toBe(path.join(dir, 'deliver', 'r2'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
