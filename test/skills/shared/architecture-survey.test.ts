import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../..');
const dir = path.join(root, 'skills/shared/architecture-survey');
const read = (f: string): string => fs.readFileSync(path.join(dir, f), 'utf-8');
const skill = read('SKILL.md');
const vocab = read('references/vocabulary.md');
const report = read('templates/report.html');

describe('architecture-survey skill', () => {
  it('is within 100 lines and user-invoked', () => {
    expect(skill.trimEnd().split('\n').length).toBeLessThanOrEqual(100);
    expect(skill).toContain('disable-model-invocation: true');
    expect(skill).toContain("opencode/autoinvoke: 'false'");
  });

  it('scopes from git log hot spots unless an area is named, walked by a fresh subagent', () => {
    expect(skill).toContain('git log');
    expect(skill).toMatch(/<area>/);
    expect(skill).toMatch(/subagent with a fresh context/);
  });

  it('does not re-litigate ADRs', () => {
    expect(skill).toContain('docs/adr/');
    expect(skill).toMatch(/never propose to reverse it/);
  });

  it('reports a self-contained HTML file in the temp dir and prints its path', () => {
    expect(skill).toContain('GetTempPath');
    expect(skill).toMatch(/print the path/);
    expect(skill).toContain('templates/report.html');
  });

  it('creates the Feature only after approval, in the github-issue format', () => {
    expect(skill).toContain('[Feature]');
    expect(skill).toContain('`github-issue`');
    expect(skill).toMatch(/only after the owner approves/);
    expect(skill).toMatch(/never create an issue before approval/);
  });
});

describe('architecture-survey references and template', () => {
  it('vocabulary defines the terms and the deletion test', () => {
    for (const t of ['Module', 'Interface', 'Depth', 'Seam', 'Adapter', 'Leverage', 'Locality']) {
      expect(vocab).toContain(`**${t}**`);
    }
    expect(vocab).toContain('## Deletion test');
  });

  it('report template is self-contained and has before/after per candidate', () => {
    expect(report).not.toMatch(/<script|<link |src=|https?:\/\//);
    expect(report).toContain('<style>');
    expect(report).toContain('<h3>Before</h3>');
    expect(report).toContain('<h3>After</h3>');
    expect(report).toContain('<section');
  });

  it('is registered in marketplace.json, groups.json and the README', () => {
    const market = fs.readFileSync(path.join(root, '.claude-plugin/marketplace.json'), 'utf-8');
    const groups = JSON.parse(
      fs.readFileSync(
        path.join(root, 'skills/delivery/skills-manage/scripts/groups.json'),
        'utf-8',
      ),
    ) as Record<string, string[]>;
    expect(market).toContain('./skills/shared/architecture-survey');
    expect(groups.shared).toContain('architecture-survey');
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf-8')).toContain(
      '`architecture-survey`',
    );
  });
});
