import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { groupSkills } from '../../helpers/marketplace';

const root = path.resolve(__dirname, '../../../skills');
const skillDir = path.join(root, 'delivery/deliver');
const text = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
const roles = fs.readFileSync(path.join(skillDir, 'references/roles.md'), 'utf8');
const permissions = fs.readFileSync(path.join(skillDir, 'references/permissions.md'), 'utf8');
const herdr = fs.readFileSync(path.join(skillDir, 'references/herdr.md'), 'utf8');
const claim = fs.readFileSync(path.join(skillDir, 'references/claim.md'), 'utf8');

describe('deliver SKILL.md', () => {
  const body = text.slice(text.indexOf('\n---', 3) + 4);

  it('is user-invoked only', () => {
    expect(text).toContain('disable-model-invocation: true');
    expect(text).toContain("opencode/autoinvoke: 'false'");
  });

  it('stays under 100 lines', () => {
    expect(text.split('\n').length).toBeLessThan(100);
  });

  it('names no harness-specific tool in its body', () => {
    for (const tool of [
      'Workflow',
      'scriptPath',
      'AskUserQuestion',
      'Agent tool',
      'Task tool',
      'general-purpose',
    ]) {
      expect(body).not.toContain(tool);
    }
    expect(body).toContain('A subagent with a fresh context');
  });

  it('runs every step in order', () => {
    const steps = [
      '**Select.**',
      '**Resume.**',
      '**Implement.**',
      '**Review.**',
      '**Fix.**',
      '**PR.**',
      '**CI.**',
      '**Merge.**',
    ];
    const at = steps.map((s) => body.indexOf(s));
    for (const i of at) expect(i).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('delegates implementation and review to subagents with the existing skills', () => {
    expect(body).toContain('Load `implementation`');
    expect(body).toContain('Load `code-review`');
    expect(body).toContain('at most 10 lines');
    expect(body).toContain('At most 2 fix rounds per PBI, shared by review and CI');
    expect(body).toContain('`github-pull-request`');
  });

  it('names the lessons role in the subagent prompts (#25)', () => {
    const step = (a: string, b: string) => body.slice(body.indexOf(a), body.indexOf(b));
    expect(step('**Implement.**', '**Review.**')).toContain(
      'Load `implementation`, role `implement`.',
    );
    expect(step('**Review.**', '**Fix.**')).toContain('Load `code-review`, role `review`.');
    expect(step('**Fix.**', '**PR.**')).toContain('loads `implementation` with role `fix`');
  });

  it('puts Get-Lessons.ps1 on every allowlist (#25)', () => {
    expect(permissions).toContain('`pwsh` with `Get-Lessons.ps1` of the `lessons` skill');
    expect(permissions).toContain('"Bash(pwsh .claude/skills/lessons/scripts/Get-Lessons.ps1:*)"');
    expect(permissions).toContain('"pwsh *lessons/scripts/Get-Lessons.ps1*": "allow"');
    const settings = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../.claude/settings.json'), 'utf8'),
    );
    expect(settings.permissions.allow).toEqual(
      expect.arrayContaining([
        'Bash(pwsh .claude/skills/lessons/scripts/Get-Lessons.ps1:*)',
        'Bash(pwsh ~/.claude/skills/lessons/scripts/Get-Lessons.ps1:*)',
      ]),
    );
  });

  it('takes several numbers and a milestone, skips needs-refinement, reports per number', () => {
    expect(body).toContain(
      '`/deliver <nr> [<nr> …] [--milestone <name>] [--unattended] [--max <n>]`',
    );
    expect(body).toContain('gh issue list --milestone <name> --label pbi --state open');
    expect(body).toContain('drop duplicates');
    expect(body).toContain('ties keep the order of the arguments');
    expect(body).toContain('#<nr> select: needs refinement, skipped');
    expect(body).toContain('planner refine <nr>');
    expect(body).toContain('#<nr> select: interactive, skipped');
    expect(body).toContain('`interactive` with `/deliver <nr>` in a session');
    expect(body).toContain(
      'interactive mode delivers it, also through a Feature, Epic or milestone',
    );
    expect(body).toContain('per given number');
  });

  it('works on the PBI branch without switching its own checkout', () => {
    expect(body).toContain('`branch: <branch>`');
    expect(body).toContain('`git switch -C <branch> origin/<branch>`');
    expect(body).toContain('never switches its own checkout');
  });

  it('waits for the required checks and squash-merges', () => {
    expect(body).toContain('`gh pr checks <pr> --watch --required`');
    expect(body).toContain('gh pr merge <pr> --squash');
    expect(body).toContain('gh issue close <nr>');
  });

  it('warns when release/next has no required status checks', () => {
    expect(body).toContain('rules/branches/release/next');
    expect(body).toContain('`required_status_checks`');
  });

  it('pauses by asking or, unattended, by comment and needs-decision', () => {
    expect(body).toContain('`--unattended`');
    expect(body).toContain('## Pause rules');
    for (const rule of ['No guessing', 'Name extra work', 'Done means merged'])
      expect(body).toContain(rule);
    expect(body).toContain('adds the label `needs-decision` and continues with the next PBI');
  });

  it('plans a missing breakdown with planner and grill-me in the same session', () => {
    expect(body).toContain('load `planner` (interactive) and `grill-me` in this session');
  });

  it('prints one progress line per step', () => {
    expect(body).toContain('`#<nr> <step>: <result>`');
  });

  it('no longer starts workflow.js', () => {
    expect(body).toContain('this skill does not start it');
    expect(fs.existsSync(path.join(skillDir, 'workflow.js'))).toBe(true);
  });

  describe('herdr progress (#855)', () => {
    const start = body.slice(body.indexOf('## Start'), body.indexOf('## Steps'));
    const herdrCalls = [...herdr.matchAll(/^(herdr .+)$/gm)].map((m) => m[1]);

    it('loads the herdr reference only when HERDR_ENV is 1', () => {
      expect(start).toContain(
        '`printenv HERDR_ENV`. Only when it prints `1`, follow `references/herdr.md`',
      );
      expect(herdr).toContain('Only when `printenv HERDR_ENV` prints `1`');
    });

    it('names no herdr command in SKILL.md itself', () => {
      expect(body).not.toMatch(/`herdr /);
    });

    it('reads the pane id once, sets the progress line per step and clears it at the end', () => {
      expect(herdr).toContain('`printenv HERDR_PANE_ID` once');
      expect(herdrCalls).toEqual([
        'herdr pane report-metadata <pane> --source deliver --display-agent "#12 review ✗1"',
        'herdr pane report-metadata <pane> --source deliver --clear-display-agent',
      ]);
      expect(herdr.indexOf('--clear-display-agent')).toBeGreaterThan(herdr.indexOf('## End'));
    });

    it('keeps the sidebar text short', () => {
      expect(herdr).toContain('no `deliver` prefix, no transient states');
    });

    it('never expands a variable in a herdr call', () => {
      for (const c of herdrCalls) expect(c).not.toContain('$');
    });
  });

  describe('cleanup after the merge (#858)', () => {
    const merge = body.slice(body.indexOf('**Merge.**'), body.indexOf('## Pause rules'));
    const report = body.slice(body.indexOf('## Report'), body.indexOf('## Rules'));

    it('runs the cleanup script after the merge and reports what it left', () => {
      expect(merge).toContain(
        '`pwsh <skill-dir>/scripts/Remove-PbiWorktrees.ps1 -Pr <pr> -Issue <nr>`',
      );
      expect(merge).toContain('`~/.claude/skills/deliver/`');
      expect(merge).toContain('`.claude/skills/deliver/`');
      expect(fs.existsSync(path.join(skillDir, 'scripts/Remove-PbiWorktrees.ps1'))).toBe(true);
      expect(merge.indexOf('Remove-PbiWorktrees')).toBeGreaterThan(merge.indexOf('gh pr merge'));
      expect(report).toContain('Worktrees or branches the cleanup left, each with its command');
    });

    it('puts the cleanup script on every allowlist', () => {
      expect(permissions).toContain('`pwsh` with `scripts/Remove-PbiWorktrees.ps1`');
      expect(permissions).toContain(
        '"Bash(pwsh .claude/skills/deliver/scripts/Remove-PbiWorktrees.ps1:*)"',
      );
      expect(permissions).toContain('"pwsh *deliver/scripts/Remove-PbiWorktrees.ps1*": "allow"');
      expect(permissions).toContain("--allow-tool 'shell(pwsh)'");
    });
  });

  describe('claim for parallel runs (#868)', () => {
    const select = body.slice(body.indexOf('**Select.**'), body.indexOf('**Resume.**'));
    const merge = body.slice(body.indexOf('**Merge.**'), body.indexOf('## Pause rules'));
    const pause = body.slice(body.indexOf('## Pause rules'), body.indexOf('## Report'));
    const delivery = fs.readFileSync(path.resolve(__dirname, '../../../docs/delivery.md'), 'utf8');

    it('claims the announced PBI by assigning it', () => {
      expect(select).toContain(
        'Announce the PBI that is next and claim it: `gh issue edit <nr> --add-assignee @me`',
      );
      expect(claim).toContain('gh issue edit <nr> --add-assignee @me');
    });

    it('skips a fresh claim and takes over a stale one, each with a progress line', () => {
      expect(select).toContain('`#<nr> select: claimed, skipped`');
      expect(select).toContain('`references/claim.md`');
      expect(claim).toContain('Skip the PBI with `#<nr> select: claimed, skipped`');
      expect(claim).toContain('with `#<nr> select: stale claim, taken over`');
      expect(claim).toContain('within the last hour');
    });

    it('dates the branch through the GitHub API, not git ls-remote', () => {
      expect(claim).toContain(
        'gh api repos/{owner}/{repo}/branches/<branch> --jq .commit.commit.committer.date',
      );
      expect(claim).toContain('gh pr list --head <branch> --state open --json number,updatedAt');
    });

    it('continues a PBI named directly regardless of the claim', () => {
      expect(select).toContain(
        '`/deliver <nr>` on the PBI itself continues it regardless of the claim',
      );
      expect(claim).toContain('Only selection through a Feature or Epic skips');
    });

    it('releases the claim on merge, block and pause', () => {
      expect(merge).toContain('`gh issue edit <nr> --remove-assignee @me`');
      expect(pause).toContain('A blocked or paused PBI releases its claim');
      expect(claim).toContain('When the PBI is merged (step 8), blocked or paused');
    });

    it('documents parallel runs in docs/delivery.md', () => {
      expect(delivery).toContain('## Parallel runs');
      expect(delivery).toContain('one worktree per session');
      expect(delivery).toContain('independent issues');
    });

    it('contains no quoted $(…) substitution in its commands', () => {
      expect(claim).not.toMatch(/["'][^"'\n]*\$\(/);
    });
  });

  it('contains no command with a quoted $(…) substitution', () => {
    const commands = [...body.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    for (const c of commands) expect(c).not.toMatch(/["'][^"']*\$\(/);
  });

  it('is listed in the delivery group of marketplace.json', () => {
    expect(groupSkills('delivery')).toContain('deliver');
  });

  it('documents the role defaults and the override key', () => {
    expect(roles).toContain('deliver.roles');
    expect(roles).toContain('`fast` haiku/low, `standard` sonnet/medium, `strong` opus/high');
  });
});

describe('deliver permissions.md (#862)', () => {
  const section = (heading: string) => {
    const start = permissions.indexOf(`\n## ${heading}\n`);
    expect(start).toBeGreaterThan(-1);
    const next = permissions.indexOf('\n## ', start + 1);
    return permissions.slice(start, next === -1 ? undefined : next);
  };
  const json = (text: string) => JSON.parse(/```json\n([\s\S]+?)```/.exec(text)![1]);

  it('is referenced from the unattended start check', () => {
    expect(text).toContain('`references/permissions.md`');
  });

  it('names the command groups deliver needs', () => {
    for (const c of [
      '`AGENTS.md`',
      '`git`',
      '`gh`',
      '`printenv HERDR_ENV`',
      '`printenv HERDR_PANE_ID`',
      '`herdr pane report-metadata`',
    ])
      expect(permissions).toContain(c);
  });

  it('Claude Code: permissions.allow in .claude/settings.json', () => {
    const claude = section('Claude Code');
    expect(claude).toContain('`.claude/settings.json`');
    const allow: string[] = json(claude).permissions.allow;
    expect(allow).toEqual(
      expect.arrayContaining([
        'Bash(git:*)',
        'Bash(gh pr:*)',
        'Bash(herdr pane report-metadata:*)',
      ]),
    );
  });

  it('OpenCode: permission.bash in opencode.json, catch-all first', () => {
    const opencode = section('OpenCode');
    expect(opencode).toContain('`opencode.json`');
    const bash: Record<string, string> = json(opencode).permission.bash;
    expect(Object.keys(bash)[0]).toBe('*');
    expect(bash['git *']).toBe('allow');
    expect(bash['git push --force*']).toBe('deny');
  });

  it('Copilot CLI: --allow-tool shell entries', () => {
    const copilot = section('Copilot CLI');
    for (const flag of [
      "--allow-tool 'shell(git)'",
      "--allow-tool 'shell(gh pr)'",
      "--deny-tool 'shell(git push --force)'",
    ])
      expect(copilot).toContain(flag);
    expect(copilot).not.toContain("'shell(pnpm)'");
  });

  it('contains no quoted $(…) substitution in its examples', () => {
    const blocks = [...permissions.matchAll(/```\w*\n([\s\S]+?)```/g)].map((m) => m[1]);
    expect(blocks.length).toBe(3);
    for (const b of blocks) expect(b).not.toMatch(/["'][^"'\n]*\$\(/);
  });
});

describe('config schema deliver key', () => {
  const schema = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../../../skills/shared/implementation/schema/config.schema.json'),
      'utf8',
    ),
  );
  const roleNames = Object.keys(schema.properties.deliver.properties.roles.properties);

  it('knows exactly the roles the workflow uses', () => {
    expect(roleNames.sort()).toEqual(
      ['ci', 'create', 'fix', 'gate', 'implement', 'plan', 'pr', 'review', 'select'].sort(),
    );
  });

  it('allows tiers only on implement and fix', () => {
    const tiered = roleNames.filter(
      (r) => schema.properties.deliver.properties.roles.properties[r].$ref === '#/$defs/tieredRole',
    );
    expect(tiered.sort()).toEqual(['fix', 'implement']);
  });
});
