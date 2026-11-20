import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(root, 'skills/shared/ratchet/scripts/baseline.mts');

describe('ratchet baseline.mts', () => {
  let tmp: string;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-'));
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const run = (kind: string, file: string, input: string, ...flags: string[]) => {
    const r = spawnSync(process.execPath, [SCRIPT, '--baseline', file, '--kind', kind, ...flags], {
      input,
      encoding: 'utf8',
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const mk = (name: string, content: string) => {
    const f = path.join(tmp, name);
    fs.writeFileSync(f, content);
    return f;
  };

  describe('entry baseline', () => {
    it('--init writes sorted unique keys and the check passes', () => {
      const f = path.join(tmp, 'e-init.txt');
      expect(run('entry', f, 'b\na\nb\n', '--init').status).toBe(0);
      expect(fs.readFileSync(f, 'utf8')).toBe('a\nb\n');
      expect(run('entry', f, 'a\nb\n').status).toBe(0);
    });

    it('a new entry fails and names the fix and the sign-off', () => {
      const f = mk('e-new.txt', 'a\n');
      const r = run('entry', f, 'a\nz\n');
      expect(r.status).toBe(1);
      expect(r.out).toContain('+ z');
      expect(r.out).toContain('Fix the violation');
      expect(r.out).toContain('reviewer sign-off');
    });

    it('a stale entry fails and names --prune', () => {
      const f = mk('e-stale.txt', 'a\nb\n');
      const r = run('entry', f, 'a\n');
      expect(r.status).toBe(1);
      expect(r.out).toContain('- b');
      expect(r.out).toContain('--prune');
    });

    it('--prune removes stale entries and never adds one', () => {
      const f = mk('e-prune.txt', 'a\nb\n');
      expect(run('entry', f, 'a\n', '--prune').status).toBe(0);
      expect(fs.readFileSync(f, 'utf8')).toBe('a\n');
      const g = mk('e-prune2.txt', 'a\nb\n');
      const r = run('entry', g, 'a\nnew\n', '--prune');
      expect(r.status).toBe(1);
      expect(fs.readFileSync(g, 'utf8')).toBe('a\n');
    });
  });

  describe('count baseline', () => {
    it('--init writes the counts and the check passes', () => {
      const f = path.join(tmp, 'c-init.json');
      expect(run('count', f, 'x.ts\t2\ny.ts\t1\n', '--init').status).toBe(0);
      expect(JSON.parse(fs.readFileSync(f, 'utf8'))).toEqual({ 'x.ts': 2, 'y.ts': 1 });
      expect(run('count', f, 'x.ts\t2\ny.ts\t1\n').status).toBe(0);
    });

    it('a higher count and a new key fail with the sign-off text', () => {
      const f = mk('c-high.json', '{"x.ts":2}');
      for (const input of ['x.ts\t3\n', 'x.ts\t2\nn.ts\t1\n']) {
        const r = run('count', f, input);
        expect(r.status).toBe(1);
        expect(r.out).toContain('reviewer sign-off');
      }
    });

    it('a lower count fails and names --prune', () => {
      const f = mk('c-low.json', '{"x.ts":2}');
      const r = run('count', f, 'x.ts\t1\n');
      expect(r.status).toBe(1);
      expect(r.out).toContain('--prune');
    });

    it('--prune lowers counts, drops zero, never raises', () => {
      const f = mk('c-prune.json', '{"x.ts":3,"y.ts":1}');
      expect(run('count', f, 'x.ts\t2\n', '--prune').status).toBe(0);
      expect(JSON.parse(fs.readFileSync(f, 'utf8'))).toEqual({ 'x.ts': 2 });
      expect(run('count', f, 'x.ts\t5\n', '--prune').status).toBe(1);
      expect(JSON.parse(fs.readFileSync(f, 'utf8'))).toEqual({ 'x.ts': 2 });
    });
  });

  it('usage errors exit 2: missing baseline file, bad count line, no kind', () => {
    expect(run('entry', path.join(tmp, 'none.txt'), 'a\n').status).toBe(2);
    expect(run('count', mk('c-bad.json', '{}'), 'no-tab\n').status).toBe(2);
    expect(spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' }).status).toBe(2);
  });
});
