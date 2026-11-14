import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

// #598: New-ReleaseReviewIssues.ps1 files the release-review notes[] as issues, once
const skillDir = path.resolve(__dirname, '../../../skills/delivery/deliver');
const script = path.join(skillDir, 'scripts/New-ReleaseReviewIssues.ps1');

const handler = `(call, ctx) => {
  const a = call.args;
  const data = JSON.parse(process.env.FAKE_GH || '[]');
  if (a.includes('POST')) {
    const n = 100 + ctx.count('post');
    return { rest: { number: n, html_url: 'https://github.com/o/r/issues/' + n } };
  }
  return { rest: [data] };
}`;

describe('New-ReleaseReviewIssues.ps1 (#598)', () => {
  let dir: string;
  let gh: ReturnType<typeof createFakeGh>;
  let worker: PwshWorker;
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rrn-'));
    gh = createFakeGh(dir, handler);
    worker = new PwshWorker(script);
  });
  afterAll(async () => {
    worker.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const run = async (notes: unknown[], existing: unknown[], extra: string[] = []) => {
    const f = path.join(dir, 'notes.json');
    fs.writeFileSync(f, JSON.stringify(notes));
    const r = await worker.run(
      ['-Notes', f, '-Key', 'M3', '-Round', '1', '-Repo', 'o/r', ...extra],
      {
        cwd: dir,
        env: gh.env({ ...process.env, FAKE_GH: JSON.stringify(existing), FAKE_DIR: dir }),
      },
    );
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout);
  };
  const posts = () =>
    gh
      .calls()
      .filter((c) => c.args.includes('POST'))
      .map((c) => c.body);

  it('files a bug, a PBI and an unclear note with labels, marker and Related', async () => {
    const out = await run(
      [
        { note: 'Parser drops the last row', defect: true, related: 12 },
        'Rename the helper for consistency',
        { note: 'Maybe unify the two modes', unclear: true },
      ],
      [],
    );
    const p = posts();
    expect(p.map((b: any) => [b.title, b.labels])).toEqual([
      ['[Bug] fix: Parser drops the last row', ['bug']],
      ['[PBI] feat: Rename the helper for consistency', ['pbi']],
      ['[PBI] feat: Maybe unify the two modes', ['pbi', 'needs-refinement']],
    ]);
    expect(p[0].body).toContain('Related: #12');
    expect(p[0].body).toContain('Found in release review M3 (round 1, note)');
    expect(p[1].body).not.toContain('Related:');
    expect(p[0]).not.toHaveProperty('milestone');
    expect(out.filed).toHaveLength(3);
    expect(out.urls).toHaveLength(3);
    expect(out.urls[0]).toMatch(/^https:\/\/github.com\/o\/r\/issues\/\d+$/);
  });

  it('skips a note whose title and marker exist, also from an earlier round', async () => {
    const before = posts().length;
    const out = await run(
      ['Rename the helper for consistency', 'A brand new note'],
      [
        {
          number: 41,
          html_url: 'https://github.com/o/r/issues/41',
          title: '[PBI] feat: Rename the helper for consistency',
          state: 'closed',
          body: 'x\n\nFound in release review M3 (round 2, note)',
        },
        { number: 42, title: '[PBI] feat: A brand new note', body: 'no marker' },
      ],
    );
    expect(out.existing.map((e: any) => e.number)).toEqual([41]);
    expect(out.filed.map((e: any) => e.title)).toEqual(['[PBI] feat: A brand new note']);
    expect(posts().length - before).toBe(1);
    expect(out.urls).toContain('https://github.com/o/r/issues/41');
  });

  it('-DryRun creates nothing; files at most 5 notes', async () => {
    const before = posts().length;
    const out = await run(['a', 'b', 'c', 'd', 'e', 'f'], [], ['-DryRun']);
    expect(out.filed).toHaveLength(5);
    expect(out.urls).toEqual([]);
    expect(posts().length).toBe(before);
  });
});

describe('deliver docs for release-review notes (#598)', () => {
  it('SKILL.md and release-review.md describe the filing; SKILL.md stays within 100 lines', () => {
    const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
    const ref = fs.readFileSync(path.join(skillDir, 'references/release-review.md'), 'utf8');
    expect(skill).toContain('New-ReleaseReviewIssues.ps1');
    expect(skill.split('\n').length).toBeLessThanOrEqual(100);
    expect(ref).toContain('## Notes as issues');
    expect(ref).toContain('Found in release review <key> (round <n>, note)');
  });
});
