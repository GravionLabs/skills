import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../../helpers/pwsh-worker';

const root = path.resolve(__dirname, '../../..');
const skill = path.join(root, 'skills/delivery/roadmap');
const script = path.join(skill, 'scripts/New-Roadmap.ps1');

const issue = (number: number, level: string, extra: Record<string, unknown> = {}) => ({
  number,
  level,
  title: `[${level}] title ${number}`,
  size: 'M',
  labels: [level],
  parent: null,
  blockedBy: [],
  milestone: null,
  url: null,
  ...extra,
});
const ms = (number: number, title: string, extra: Record<string, unknown> = {}) => ({
  number,
  title,
  state: 'open',
  open: 2,
  closed: 1,
  progress: 33,
  ...extra,
});

describe('New-Roadmap.ps1', () => {
  let worker: PwshWorker;
  let dir: string;
  beforeAll(() => {
    worker = new PwshWorker(script);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-md-'));
  });
  afterAll(() => worker.close());

  const run = (state: unknown, args: string[] = []) =>
    worker.run(
      ['-State', JSON.stringify(state), '-Path', 'ROADMAP.md', '-Date', '2026-11-04', ...args],
      { cwd: dir },
    );
  const file = () => path.join(dir, 'ROADMAP.md');
  const reset = () => fs.rmSync(file(), { force: true });

  const open = {
    latestTag: 'v1.5.0',
    issues: [
      issue(1, 'epic'),
      issue(2, 'feature', { parent: 1, milestone: 'M3 Roadmap' }),
      issue(5, 'pbi', { parent: 2, milestone: 'M3 Roadmap', blockedBy: [4] }),
      issue(4, 'pbi', { parent: 2, milestone: 'M3 Roadmap', size: null }),
      issue(9, 'pbi', { labels: ['pbi', 'needs-decision'] }),
    ],
    milestones: [ms(3, 'M3 Roadmap')],
  };

  it('creates a fresh file from the template with all generated tables', async () => {
    reset();
    const r = await run(open, ['-Write']);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const text = fs.readFileSync(file(), 'utf8');
    expect(text).toContain('Updated 2026-11-04. Last release `v1.5.0`.');
    expect(text).toContain('| #1 [epic] title 1 | open: #2 | not scheduled |');
    expect(text).toContain('## M3 Roadmap');
    expect(text).toContain('| Order | Issue | Title | Size | Depends on / decision |');
    // blocker #4 comes before #5 although its number is higher in the list order
    expect(text.indexOf('| 1 | #4 |')).toBeGreaterThan(-1);
    expect(text).toContain('| 2 | #5 | [pbi] title 5 | M | blocked by #4 |');
    expect(text).toContain('| 1 | #4 | [pbi] title 4 | ? |');
    expect(text).toContain('| #9 | [pbi] title 9 | `needs-decision` |');
    expect(text).toContain('## Risks');
    expect(r.stdout).toContain('wrote ROADMAP.md');
  });

  it('keeps hand-written text and replaces only the generated blocks', async () => {
    const before = fs
      .readFileSync(file(), 'utf8')
      .replace('## Risks', 'Hand-written note about M3.\n\n## Risks')
      .replace('Order of work', 'My own intro. Order of work');
    fs.writeFileSync(file(), before);
    const next = { ...open, issues: open.issues.filter((i) => i.number !== 4) };
    const r = await run(next, ['-Write']);
    expect(r.status).toBe(0);
    const text = fs.readFileSync(file(), 'utf8');
    expect(text).toContain('Hand-written note about M3.');
    expect(text).toContain('My own intro.');
    expect(text).not.toContain('title 4');
    expect(text.match(/<!-- roadmap:begin plan M3 -->/g)).toHaveLength(1);
  });

  it('moves a closed milestone from the plan to Done with its issues', async () => {
    const closed = {
      latestTag: 'v1.6.0',
      issues: [issue(9, 'pbi', { milestone: 'M4' })],
      milestones: [
        ms(3, 'M3 Roadmap (1.6.0)', {
          state: 'closed',
          open: 0,
          closed: 2,
          progress: 100,
          issues: [
            { number: 4, title: '[PBI] four' },
            { number: 5, title: '[PBI] five | piped' },
          ],
        }),
        ms(4, 'M4'),
      ],
    };
    const r = await run(closed, ['-Write']);
    expect(r.status).toBe(0);
    const text = fs.readFileSync(file(), 'utf8');
    expect(text).not.toContain('roadmap:begin plan M3');
    expect(text).toContain('<!-- roadmap:begin done M3 -->\n## Done in M3 Roadmap (1.6.0)');
    expect(text).toContain('| #4 | [PBI] four |');
    expect(text).toContain('| #5 | [PBI] five \\| piped |');
    expect(text).toContain('## M4');
    expect(text.indexOf('done M3')).toBeLessThan(text.indexOf('plan M4'));
    expect(text).toContain('Hand-written note about M3.');
    expect(text).toContain('Last release `v1.6.0`');
  });

  it('shows the diff and writes nothing without -Write', async () => {
    const before = fs.readFileSync(file(), 'utf8');
    const r = await run({ ...open, latestTag: 'v9.9.9' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('+Updated 2026-11-04. Last release `v9.9.9`.');
    expect(r.stdout).toContain('dry run');
    expect(fs.readFileSync(file(), 'utf8')).toBe(before);
  });

  it('does not create the file without -Write and reports a current file', async () => {
    reset();
    const dry = await run(open);
    expect(dry.status).toBe(0);
    expect(fs.existsSync(file())).toBe(false);
    await run(open, ['-Write']);
    const again = await run(open);
    expect(again.stdout).toContain('is current');
  });

  it('rejects state that is not JSON', async () => {
    const r = await worker.run(['-State', 'not json', '-Path', 'ROADMAP.md'], { cwd: dir });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('not valid JSON');
  });
});
