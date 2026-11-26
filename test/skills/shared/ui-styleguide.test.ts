import * as fs from 'fs';
import * as path from 'path';

const dir = path.resolve(__dirname, '../../../skills/shared/ui-styleguide');
const read = (p: string): string => fs.readFileSync(path.join(dir, p), 'utf8');
const lineCount = (s: string): number => s.trimEnd().split(/\r?\n/).length;

const SECTIONS = [
  'Tokens',
  'Color',
  'Typography',
  'Radius and elevation',
  'Components',
  'UX rules',
  'Cross-platform',
  'When this guide is silent',
];
const DEEP_DIVES = ['color.md', 'components.md', 'ux-rules.md', 'ux-review-rubric.md'];

describe('ui-styleguide', () => {
  it('SKILL.md is at most 100 lines', () => {
    expect(lineCount(read('SKILL.md'))).toBeLessThanOrEqual(100);
  });

  it('ships the core template and the deep-dive templates', () => {
    for (const f of [
      'STYLEGUIDE.md',
      'agents-styleguide.md',
      ...DEEP_DIVES.map((d) => `styleguide/${d}`),
    ]) {
      expect(fs.existsSync(path.join(dir, 'templates', f)), f).toBe(true);
    }
  });

  describe('templates/STYLEGUIDE.md', () => {
    const core = read('templates/STYLEGUIDE.md');

    it('is at most 100 lines', () => {
      expect(lineCount(core)).toBeLessThanOrEqual(100);
    });

    it.each(SECTIONS)('has the section %s', (s) => {
      expect(core).toMatch(new RegExp(`^## ${s}$`, 'm'));
    });

    it.each(DEEP_DIVES)('links %s with a reading condition', (d) => {
      expect(core).toMatch(
        new RegExp(`^- Read \\[styleguide/${d}\\]\\(styleguide/${d}\\) when `, 'm'),
      );
    });
  });

  it('ux-review-rubric.md prescribes the five output headings in a fixed order', () => {
    const rubric = read('templates/styleguide/ux-review-rubric.md');
    const headings = [
      'Top fixes',
      'Friction notes',
      'Suggested changes',
      'Keyboard and speed check',
      'Follow-up states (loading, empty, error, partial)',
    ];
    const positions = headings.map((h) =>
      rubric.search(new RegExp(`^### ${h.replace(/[()]/g, '\\$&')}$`, 'm')),
    );
    expect(positions.every((i) => i >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('ux-rules.md has the field and dialog anatomy', () => {
    const rules = read('templates/styleguide/ux-rules.md');
    for (const h of ['Field anatomy', 'Dialog anatomy']) {
      expect(rules).toMatch(new RegExp(`^### ${h}$`, 'm'));
    }
    for (const s of ['aria-invalid', 'aria-describedby', 'input group', '<platform order>']) {
      expect(rules).toContain(s);
    }
    expect(rules).toMatch(/exactly one primary action/);
    expect(rules).toMatch(/Cancel never uses the danger role/);
  });

  it('components.md has the form and dialog rows and the button hierarchy', () => {
    const components = read('templates/styleguide/components.md');
    for (const row of ['FormField', 'InputGroup', 'DialogFooter']) {
      expect(components).toMatch(new RegExp(`^\\| \`<${row}>\` +\\|`, 'm'));
    }
    expect(components).toMatch(/^## Button hierarchy$/m);
    for (const v of ['primary', 'secondary', 'quiet / toolbar', 'icon-only', 'link', 'danger']) {
      expect(components).toMatch(new RegExp(`^\\| ${v} +\\|`, 'm'));
    }
  });

  it('fill.md reads the form and dialog components and leaves gaps open', () => {
    const step = read('references/fill.md')
      .split('\n')
      .find((l) => l.includes('**Read the form and dialog components.**'));
    for (const s of ['field wrapper', 'footer', 'button variants', 'Open: …', 'never invented']) {
      expect(step).toContain(s);
    }
  });

  it('agents-styleguide.md holds the binding paragraph', () => {
    const p = read('templates/agents-styleguide.md');
    expect(p).toContain('docs/STYLEGUIDE.md');
    expect(p).toMatch(/binding/);
    expect(p).toMatch(/deviation needs a reason in the PR/);
  });

  it('fill.md is linked from SKILL.md, names the eight sections and forbids invention', () => {
    expect(read('SKILL.md')).toContain('references/fill.md');
    const fill = read('references/fill.md');
    for (const s of SECTIONS) expect(fill).toContain(s);
    expect(fill).toMatch(/Nothing is invented/);
  });

  it('SKILL.md names the sync mode with its trigger words and links references/sync.md', () => {
    const skill = read('SKILL.md');
    const modes = skill.split(/^## Modes$/m)[1]?.split(/^## /m)[0];
    expect(modes).toContain('/ui-styleguide sync');
    expect(modes).toContain('"update the style guide"');
    expect(modes).toContain('(references/sync.md)');
    expect(skill.match(/^description: .*$/m)?.[0]).toContain('"update the style guide"');
  });

  describe('references/sync.md', () => {
    const sync = read('references/sync.md');

    it('reads the core file and the deep dives', () => {
      expect(sync).toContain('docs/STYLEGUIDE.md');
      expect(sync).toContain('docs/styleguide/*.md');
    });

    it.each(['Stale references', 'Missing components', 'Missing template parts', 'Broken rules'])(
      'has the check %s',
      (check) => {
        expect(sync).toMatch(new RegExp(`^\\d\\. \\*\\*${check}\\.\\*\\*`, 'm'));
      },
    );

    it('finds components like fill.md step 4 and counts broken rules with examples', () => {
      expect(sync).toMatch(/\(fill\.md\) step 4/);
      expect(sync).toContain('more than one screen');
      expect(sync).toContain('the count and up to five examples');
      expect(sync).toContain('file and evidence');
    });

    it('outputs a list and a diff and writes only after approval', () => {
      expect(sync).toMatch(/^1\. \*\*List\*\*/m);
      expect(sync).toMatch(/^2\. \*\*Proposed diff\*\*/m);
      expect(sync).toContain('Write nothing before the user approves');
      expect(sync).toContain('Apply an approved diff as shown');
    });
  });

  it('SKILL.md names the audit mode with its trigger words and links references/audit.md', () => {
    const skill = read('SKILL.md');
    const modes = skill.split(/^## Modes$/m)[1]?.split(/^## /m)[0];
    expect(modes).toContain('/ui-styleguide audit [<names>…]');
    expect(modes).toContain('"audit the UI against the style guide"');
    expect(modes).toContain('(references/audit.md)');
    expect(skill.match(/^description: .*$/m)?.[0]).toContain(
      '"audit the UI against the style guide"',
    );
  });

  describe('references/audit.md', () => {
    const audit = read('references/audit.md');

    it('resolves the input without driving a browser', () => {
      expect(audit).toContain('screenshot folder');
      expect(audit).toContain('pnpm screenshots');
      expect(audit).toContain('package.json');
      expect(audit).toContain('No browser is driven');
    });

    it('looks up the project rubric before the template and does not copy it', () => {
      const project = audit.indexOf('docs/styleguide/ux-review-rubric.md');
      const template = audit.indexOf('(../templates/styleguide/ux-review-rubric.md)');
      expect(project).toBeGreaterThanOrEqual(0);
      expect(template).toBeGreaterThan(project);
      expect(audit).not.toContain('What is the one thing the user came to do');
    });

    it('reports the five rubric headings per view in the rubric order', () => {
      const rubric = read('templates/styleguide/ux-review-rubric.md');
      const headings = rubric.match(/^### .+$/gm) ?? [];
      expect(headings).toHaveLength(5);
      const positions = headings.map((h) => audit.indexOf(`\`${h}\``));
      expect(positions.every((i) => i >= 0)).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
      expect(audit).toContain('Write "None"');
      expect(audit).toContain('names the file and the section');
      expect(audit).toContain('only from the markup');
    });

    it('ranks the top fixes and creates drafts only after approval', () => {
      expect(audit).toContain('`## Top fixes across views`, ranked');
      expect(audit).toContain('PBI draft');
      expect(audit).toContain('`github-issue` format');
      expect(audit).toContain('Show every draft in full');
      expect(audit).toContain('Create nothing before the user approves');
    });
  });
});
