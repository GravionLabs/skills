import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const text = fs.readFileSync(
  path.resolve(__dirname, '../../../skills/delivery/retro/SKILL.md'),
  'utf8',
);

describe('retro SKILL.md', () => {
  it('gathers figures with agentlens and gh and names no dromos', () => {
    expect(text).toContain('agentlens cost --by issue --format json');
    expect(text).toContain('gh pr view');
    expect(text).not.toMatch(/dromos/i);
    expect(text).not.toContain('phase.finished');
  });

  it('marks estimates, handles a missing agentlens and repeated findings', () => {
    expect(text).toContain('`~`');
    expect(text).toMatch(/`agentlens` missing or failing[^\n]*not measured/);
    expect(text).toMatch(/same file and title in two or more PRs/);
  });

  it('takes escalation lines from the deliver report', () => {
    expect(text).toMatch(/Escalation lines[^\n]*final report of `deliver`/);
    expect(text).toContain('"no run report"');
  });

  it('names the source of every column in references/metrics-sources.md', () => {
    const ref = fs.readFileSync(
      path.resolve(__dirname, '../../../skills/delivery/retro/references/metrics-sources.md'),
      'utf8',
    );
    expect(text).toContain('references/metrics-sources.md');
    for (const col of [
      'cost',
      'main peak',
      'requests',
      'roles by cost',
      'review rounds',
      'fix rounds',
      'CI',
    ]) {
      expect(ref).toContain(col);
    }
    expect(ref).not.toMatch(/dromos/i);
  });

  it('stays within 100 lines', () => {
    expect(text.split('\n').length).toBeLessThanOrEqual(100);
  });

  it('keeps the seven columns and the approval rule', () => {
    expect(text).toContain('exactly these seven columns');
    expect(text).toContain("without the user's approval");
  });

  it('has draft PBIs name the skill file under skills/<group>/<name>/ and the rule', () => {
    expect(text).toMatch(
      /names the skill file \(path under `skills\/<group>\/<name>\/`\)[^\n]*the rule to change/,
    );
    expect(text).not.toContain('packages/');
  });

  describe('retiring ineffective lessons', () => {
    const ref = fs.readFileSync(
      path.resolve(__dirname, '../../../skills/delivery/retro/references/lessons.md'),
      'utf8',
    );
    const step = text.split('\n').find((l) => l.includes('**Retire lessons.**')) ?? '';
    const section = ref.split('## Retire ineffective lessons')[1] ?? '';

    it('has a step that checks approved lessons against runs after their created date', () => {
      expect(step).toContain('`approved` lessons');
      expect(step).toContain('`created` date');
      expect(step).toMatch(/repeated finding or fix rounds/);
      expect(step).toContain('`status: retired`');
      expect(step).toContain('references/lessons.md');
    });

    it('proposes retiring on a later repeated finding or fix rounds, with the run as evidence', () => {
      expect(section).toMatch(/`status: approved`/);
      expect(section).toMatch(/Runs before `created` are no evidence/);
      expect(section).toMatch(/fix rounds/);
      expect(section).toMatch(/evidence/);
    });

    it('shows the proposal as a draft and retires via a normal PR after approval', () => {
      expect(section).toMatch(/as a draft/);
      expect(section).toMatch(/normal PR/);
      expect(section).toMatch(/Nothing is edited before approval/);
      expect(section).toMatch(/Deleting lesson files is out of scope/);
    });
  });

  describe('lesson drafts', () => {
    const ref = fs.readFileSync(
      path.resolve(__dirname, '../../../skills/delivery/retro/references/lessons.md'),
      'utf8',
    );
    const step = text.split('\n').find((l) => l.includes('**Draft lessons.**')) ?? '';

    it('turns a repository-, language- or role-specific candidate into a proposed lesson draft', () => {
      expect(step).toMatch(/repository-, language- or role-specific/);
      expect(step).toContain('instead of or next to a draft PBI');
      expect(step).toContain("`lessons` skill's `references/contract.md`");
      expect(step).toContain('`status: proposed`');
      expect(step).toMatch(/`evidence` from the candidate/);
      expect(step).toContain('references/lessons.md');
    });

    it('checks the drafts with Get-Lessons.ps1 -Check and shows them as text', () => {
      expect(step).toContain('`Get-Lessons.ps1 -Check`');
      expect(step).toMatch(/show the drafts as text/);
      expect(ref).toMatch(/Get-Lessons\.ps1 -Check/);
      expect(ref).toMatch(/temporary folder outside any git repository/);
    });

    it('resolves the Get-Lessons.ps1 path before changing into the temporary folder', () => {
      const block = ref.match(/```powershell\n([\s\S]*?)```/)?.[1] ?? '';
      const resolve = block.indexOf(
        "$script = (Resolve-Path '<lessons-dir>/scripts/Get-Lessons.ps1').Path",
      );
      expect(resolve).toBeGreaterThanOrEqual(0);
      expect(block.indexOf('Push-Location $tmp')).toBeGreaterThan(resolve);
      expect(block).toContain('pwsh $script -Check');
      expect(block).not.toContain('pwsh <lessons-dir>');
      expect(block.indexOf('$checkExit = $LASTEXITCODE')).toBeLessThan(
        block.indexOf('Pop-Location'),
      );
      expect(block).toMatch(/finally \{\s*Pop-Location\s*Remove-Item -Recurse -Force \$tmp/);
    });

    it('writes no lesson file and opens no PR without approval', () => {
      expect(text).toMatch(/without the user's approval[^\n]*no PR[^\n]*no lesson file/);
      expect(ref).toMatch(/only after that approval/);
    });

    it('puts approved drafts into .agents/lessons/ on a branch with a normal PR; approval is status: approved', () => {
      expect(step).toMatch(
        /After approval they go into `\.agents\/lessons\/` on a branch with a normal PR/,
      );
      expect(step).toMatch(/approval of a lesson is setting `status: approved` in that PR/);
      expect(ref).toContain('github-pull-request');
      expect(ref).toMatch(/never sets `approved` itself/);
    });

    it('drafts frontmatter with every key of the contract, status proposed and version 1', () => {
      const fm = ref.match(/```markdown\n---\n([\s\S]*?)\n---/)?.[1] ?? '';
      for (const key of ['id', 'scope', 'evidence', 'status', 'version', 'created']) {
        expect(fm).toMatch(new RegExp(`^${key}: `, 'm'));
      }
      expect(fm).toMatch(/^status: proposed$/m);
      expect(fm).toMatch(/^version: 1$/m);
      expect(fm).not.toMatch(/approved/);
    });
  });

  it('names no ledger artefact', () => {
    for (const term of ['<state>', 'ledger', 'Get-RunMetrics']) {
      expect(text).not.toContain(term);
    }
  });
});
