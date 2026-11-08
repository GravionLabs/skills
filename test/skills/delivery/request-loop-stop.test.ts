import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PwshWorker } from '../../helpers/pwsh-worker';

const script = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Request-LoopStop.ps1',
);

describe('Request-LoopStop.ps1', () => {
  let tmp: string;
  let worker: PwshWorker;
  const repo = (name: string, records: string[] | null) => {
    const root = path.join(tmp, name);
    const runDir = path.join(root, '.agents/deliver-loop/run1');
    fs.mkdirSync(runDir, { recursive: true });
    if (records) {
      fs.writeFileSync(
        path.join(runDir, 'progress.jsonl'),
        records.map((e) => `{"event":"${e}"}`).join('\n') + '\n',
      );
      fs.writeFileSync(path.join(root, '.agents/deliver-loop/latest.txt'), runDir);
    }
    return { root, stop: path.join(runDir, 'stop') };
  };
  // the stderr line is written through [Console]::Error, which the in-process worker does not capture: a real spawn
  const spawn = (root: string) => {
    const r = spawnSync('pwsh', ['-NoProfile', '-File', script], { cwd: root, encoding: 'utf8' });
    return { status: r.status, stderr: r.stderr.trim() };
  };
  const run = (root: string, args: string[] = []) => worker.run(args, { cwd: root });

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loopstop-'));
    worker = new PwshWorker(script);
  });
  afterAll(() => {
    worker.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('writes an empty stop file for a running run', async () => {
    const r = repo('running', ['start', 'iteration-start']);
    const out = await run(r.root);
    expect(out.status).toBe(0);
    expect(out.stdout.trim()).toBe('stop requested for run run1: after the current PBI');
    expect(fs.readFileSync(r.stop, 'utf8')).toBe('');
  });

  it('-Now writes "now"', async () => {
    const r = repo('now', ['start']);
    const out = await run(r.root, ['-Now']);
    expect(out.stdout.trim()).toBe('stop requested for run run1: after the current step');
    expect(fs.readFileSync(r.stop, 'utf8')).toBe('now');
  });

  it('-Cancel deletes the stop file', async () => {
    const r = repo('cancel', ['start']);
    fs.writeFileSync(r.stop, '');
    const out = await run(r.root, ['-Cancel']);
    expect(out.status).toBe(0);
    expect(out.stdout.trim()).toBe('stop cancelled');
    expect(fs.existsSync(r.stop)).toBe(false);
  });

  it('-Run selects a run without latest.txt', async () => {
    const r = repo('byrun', null);
    const out = await run(r.root, ['-Run', 'run1']);
    expect(out.status).toBe(0);
    expect(fs.existsSync(r.stop)).toBe(true);
  });

  it('a finished run: exit 1, one stderr line, nothing written', async () => {
    const r = repo('finished', ['start', 'result']);
    const out = spawn(r.root);
    expect(out.status).toBe(1);
    expect(out.stderr.split('\n')).toHaveLength(1);
    expect(out.stderr).not.toBe('');
    expect(fs.existsSync(r.stop)).toBe(false);
  });

  it('no latest.txt: exit 1, nothing written', async () => {
    const root = path.join(tmp, 'none');
    fs.mkdirSync(root, { recursive: true });
    const out = spawn(root);
    expect(out.status).toBe(1);
    expect(out.stderr).not.toBe('');
    expect(fs.existsSync(path.join(root, '.agents'))).toBe(false);
  });
});
