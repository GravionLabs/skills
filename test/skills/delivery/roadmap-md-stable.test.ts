import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../../helpers/pwsh-worker';

const root = path.resolve(__dirname, '../../..');
const script = path.join(root, 'skills/delivery/roadmap/scripts/New-Roadmap.ps1');
const biome = path.join(root, 'node_modules/@biomejs/biome/bin/biome');

const issue = (
  number: number,
  level: string,
  title: string,
  extra: Record<string, unknown> = {},
) => ({
  number,
  level,
  title,
  size: null,
  labels: [level],
  parent: null,
  blockedBy: [],
  milestone: null,
  url: null,
  ...extra,
});

// cells of different widths, an escaped pipe, wide characters (CJK, emoji) and an em dash
const state = {
  latestTag: 'v1.5.0',
  issues: [
    issue(1, 'epic', '[Epic] short', { milestone: 'M2' }),
    issue(2, 'pbi', '[PBI] a much longer title with a | pipe', { milestone: 'M2', blockedBy: [3] }),
    issue(3, 'pbi', '[PBI] 日本語 title', { milestone: 'M2', size: 'S' }),
    issue(4, 'pbi', '[PBI] emoji 🚀 and — dash'),
    issue(5, 'pbi', '[PBI] x', { labels: ['pbi', 'needs-decision'] }),
  ],
  milestones: [
    {
      number: 1,
      title: 'M1 (1.0.0)',
      state: 'closed',
      open: 0,
      closed: 2,
      progress: 100,
      issues: [
        { number: 7, title: '[PBI] ü 🚀 日本' },
        { number: 120, title: '[PBI] a | b' },
      ],
    },
    { number: 2, title: 'M2', state: 'open', open: 3, closed: 0, progress: 0 },
  ],
};

describe('ROADMAP.md is stable under the generator and Biome', () => {
  let worker: PwshWorker;
  let dir: string;
  beforeAll(() => {
    worker = new PwshWorker(script);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-stable-'));
  });
  afterAll(() => worker.close());

  const run = (args: string[] = []) =>
    worker.run(
      ['-State', JSON.stringify(state), '-Path', 'ROADMAP.md', '-Date', '2026-11-04', ...args],
      { cwd: dir },
    );
  const file = () => path.join(dir, 'ROADMAP.md');

  it('writes tables that Biome leaves unchanged', async () => {
    const r = await run(['-Write']);
    expect(r.status).toBe(0);
    const text = fs.readFileSync(file(), 'utf8');
    const formatted = spawnSync(
      process.execPath,
      [biome, 'format', '--stdin-file-path=ROADMAP.md'],
      {
        input: text,
        encoding: 'utf8',
      },
    );
    expect(formatted.status).toBe(0);
    expect(formatted.stdout).toBe(text);
  });

  it('pads columns to the widest cell, counts wide characters as two and keeps the escaped pipe', () => {
    const text = fs.readFileSync(file(), 'utf8');
    expect(text).toContain('| #7    | [PBI] ü 🚀 日本 |');
    expect(text).toContain('| #120  | [PBI] a \\| b    |');
    expect(text).toContain('| ----- | --------------- |');
  });

  it('a second run is byte-identical', async () => {
    const before = fs.readFileSync(file(), 'utf8');
    const r = await run(['-Write']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('ROADMAP.md is current');
    expect(fs.readFileSync(file(), 'utf8')).toBe(before);
  });
});

describe('the committed ROADMAP.md carries the generator markers', () => {
  const text = fs.readFileSync(path.join(root, 'ROADMAP.md'), 'utf8');
  const keys = [...text.matchAll(/<!-- roadmap:begin (.+?) -->/g)].map((m) => m[1]);

  it.each(['intro', 'where', 'later', 'plan 1.6.0'])('has the block %s', (key) => {
    expect(keys).toContain(key);
  });

  it('has one done block per closed milestone and no hand-written duplicate heading', () => {
    for (const v of ['1.0.2', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0']) {
      expect(keys.filter((k) => k === `done ${v}`)).toHaveLength(1);
      expect(text.match(new RegExp(`^## .*\\b${v.replace(/\./g, '\\.')}\\b`, 'gm'))).toHaveLength(
        1,
      );
    }
  });

  it('has both slots', () => {
    expect(text).toContain('<!-- roadmap:slot done -->');
    expect(text).toContain('<!-- roadmap:slot plan -->');
  });
});
