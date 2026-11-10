import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { groupSkills } from '../../helpers/marketplace';
import { expectSkillHelp } from '../../helpers/skill-help';

const root = path.resolve(__dirname, '../../../skills');
const skillDir = path.join(root, 'delivery/deliver');
const text = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
const roles = fs.readFileSync(path.join(skillDir, 'references/roles.md'), 'utf8');
const permissions = fs.readFileSync(path.join(skillDir, 'references/permissions.md'), 'utf8');
const herdr = fs.readFileSync(path.join(skillDir, 'references/terminal-backends.md'), 'utf8');
const claim = fs.readFileSync(path.join(skillDir, 'references/claim.md'), 'utf8');

describe('deliver SKILL.md', () => {
  const body = text.slice(text.indexOf('\n---', 3) + 4);
  const herdrCalls = [...herdr.matchAll(/^(herdr .+)$/gm)].map((m) => m[1]);

  it('is user-invoked only', () => {
    expect(text).toContain('disable-model-invocation: true');
    expect(text).toContain("opencode/autoinvoke: 'false'");
  });

  it('emits the attention kinds the loop notifications depend on (#400)', () => {
    const steps = body.slice(body.indexOf('## Steps'), body.indexOf('1. **Select.**'));
    for (const kind of ['pr_opened', 'review_fix', 'ci_red', 'paused', 'blocked', 'needs_you']) {
      expect(steps).toMatch(new RegExp('-Kind[^)]*\\b' + kind + '\\b'));
    }
    expect(steps).toContain('only from these events');
  });

  it('has the stop now rule (#476)', () => {
    const rules = body.slice(body.indexOf('## Rules'));
    expect(rules).toContain('`STOP requested`');
    expect(rules).toContain('gh issue edit <nr> --remove-assignee @me');
    expect(rules).toContain('#<nr> stop: stopped after <step>, continue with /deliver <nr>');
    expect(rules).toContain('-Outcome skipped -Reason "stop requested"');
    expect(rules).toContain('A running subagent is not interrupted');
  });

  it('names PRs and issues as full URLs, the release PR included', () => {
    expect(body).toContain('full URL');
    expect(body).toContain('not as a bare `#<n>`');
    const report = body.slice(body.indexOf('## Report'));
    expect(report).toContain('the release PR of step 9 as a full URL');
  });

  it('shows the tier and model in the select line, the report and the loop docs (#325)', () => {
    const select = body.slice(body.indexOf('**Select.**'), body.indexOf('**Resume.**'));
    expect(select).toContain('(tier standard → sonnet/medium)');
    expect(select).toContain('`tier from size M` or `default`');
    expect(body.slice(body.indexOf('## Report'))).toMatch(/tier: fast 2 · standard 5 · strong 1/);
    expect(roles).toContain('The tier is shown before and during a run');
    const loop = fs.readFileSync(path.join(skillDir, 'references/loop.md'), 'utf8');
    expect(loop).toContain('## Model per PBI (tier)');
    expect(loop).toMatch(/Without `-Model`[\s\S]*haiku[\s\S]*sonnet[\s\S]*opus/);
  });

  it('turns feedback during a run into issues instead of code (#324)', () => {
    const feedback = fs.readFileSync(path.join(skillDir, 'references/feedback.md'), 'utf8');
    expect(body).toContain('## Feedback during a run');
    expect(body).toContain('references/feedback.md');
    for (const part of [
      'at most 6 lines',
      '`Tier:`',
      '`Size:`',
      '`needs-refinement`',
      'planner refine <nr>',
      'one draft per finding',
      'implements nothing',
      'Fix it now',
      'Screenshots',
    ]) {
      expect(feedback).toContain(part);
    }
    expect(text.split('\n').length).toBeLessThanOrEqual(100);
    expect(
      fs.readFileSync(path.resolve(__dirname, '../../../site/guides/deliver.md'), 'utf8'),
    ).toContain('## Feedback during a run');
  });

  it('does not pin the session model on the loop by default (#348)', () => {
    const control = fs.readFileSync(path.join(skillDir, 'references/control.md'), 'utf8');
    const step = control.split('\n').find((l) => l.startsWith('2. Start the loop')) ?? '';
    expect(step).not.toContain("this session's model");
    expect(step).toContain('no `-Model`');
    expect(step).toContain('tier');
  });

  it('a control session opens no run of its own next to the loop run (#517)', () => {
    const control = fs.readFileSync(path.join(skillDir, 'references/control.md'), 'utf8');
    const loop = fs.readFileSync(path.join(skillDir, 'references/loop.md'), 'utf8');
    const start4 =
      fs
        .readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8')
        .split('\n')
        .find((l) => l.startsWith('4. Progress events')) ?? '';
    expect(start4).toContain('a control session that hands the set to the loop opens no run');
    expect(start4).toContain('only when it delivers a PBI itself');
    expect(control).toContain('writes no run of its own');
    expect(loop).toContain('opens no run of its own');
  });

  it('hands interactive runs over many PBIs to a control session over the loop (#321)', () => {
    const control = fs.readFileSync(path.join(skillDir, 'references/control.md'), 'utf8');
    expect(body).toContain('--inline');
    expect(body).toContain('references/control.md');
    expect(body).toContain('deliver.loopThreshold');
    for (const part of [
      'progress.jsonl',
      'needs-decision',
      '`interactive`',
      'step 9',
      'deliver.controlContextTokens',
      '200000',
      'Get-DeliverStatus',
      '--unattended',
    ]) {
      expect(control + body).toContain(part);
    }
    expect(control).toContain('status block');
    expect(control).toContain('resume command');
    expect(fs.readFileSync(path.join(skillDir, 'references/loop.md'), 'utf8')).toContain(
      '`--inline`',
    );
    expect(fs.readFileSync(path.join(skillDir, 'references/help.md'), 'utf8')).toContain(
      '--inline',
    );
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

  it('asks the implementer for notes[] incl. the spec note in step 3 (#97)', () => {
    const step3 = body.slice(body.indexOf('**Implement.**'), body.indexOf('**Review.**'));
    expect(step3).toContain('`notes[]` (one per line)');
    expect(step3).toContain('`no spec change needed: <spec> — <reason>`');
    expect(step3).toContain('`specMap`');
  });

  it('writes the review result file per schema in step 4 (#53)', () => {
    const step4 = body.slice(body.indexOf('**Review.**'), body.indexOf('**Fix.**'));
    expect(step4).toContain('<git-common-dir>/.agents/state/review-<nr>.json');
    expect(step4).toContain('schema/deliver-review.schema.json');
    expect(step4).toContain('`review.schema.json`');
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
      '`/deliver <nr> [<nr> …] [--milestone <name>] [--unattended] [--inline] [--max <n>]`',
    );
    expect(body).toContain('Get-Milestones.ps1 -Mode issues -Name <name> -State open');
    expect(body).toContain('filter the returned list by label');
    expect(body).not.toContain('gh issue list');
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

  it('reads issues and the open PR of a branch over REST, not GraphQL (#117)', () => {
    expect(body).toContain(
      "`gh api repos/{owner}/{repo}/issues/<nr> --jq '{number,title,state,labels:[.labels[].name],body}'`",
    );
    expect(body).toContain(
      '`gh api "repos/{owner}/{repo}/pulls?head=<owner>:<branch>&state=open" --jq \'.[].number\'`',
    );
    // a porcelain read with an argument (the rule text names them without one)
    expect(body).not.toMatch(/gh (issue view|pr list|pr view) </);
  });

  it('waits for the required checks and squash-merges', () => {
    expect(body).toContain('`gh pr checks <pr> --watch --required --interval 60`');
    expect(body).toContain('gh pr merge <pr> --squash');
    expect(body).toContain('gh issue close <nr>');
  });

  it('merges into release/next without asking, only on a clean review and green checks (#78)', () => {
    const merge = body.slice(body.indexOf('**Merge.**'), body.indexOf('**Release.**'));
    expect(merge).toContain('Without asking, in both modes');
    expect(merge).toContain('no blocking finding or unmet criterion');
    expect(merge).toContain('the required checks are green');
    expect(body).not.toContain('ask before merging');
  });

  it('ends a fully delivered milestone with the release PR for human review (#78)', () => {
    const release = body.slice(body.indexOf('**Release.**'), body.indexOf('## Pause rules'));
    expect(release).toContain('Only with `--milestone`');
    expect(release).toContain('No open issue labeled `pbi` or `bug` in it');
    expect(release).not.toContain('gh issue list');
    expect(release).toContain('`github-release` and run `finish`');
    expect(release).toContain('`auto_merge: false`');
    expect(release).toContain('never merge it');
    expect(body).toContain('Never merge the release PR into `main`');
    expect(body).toContain('the release PR of step 9');
  });

  describe('release review (#100)', () => {
    const release = body.slice(body.indexOf('**Release.**'), body.indexOf('## Pause rules'));
    const ref = fs.readFileSync(path.join(skillDir, 'references/release-review.md'), 'utf8');
    const docs = fs.readFileSync(path.resolve(__dirname, '../../../site/delivery.md'), 'utf8');

    it('takes criteria and round markers from one batched milestone list (#127)', () => {
      expect(ref).toContain('Get-Milestones.ps1 -Mode issues -Name <name> -State all');
      expect(ref).toContain('Collect the criteria from that list');
      expect(ref).not.toContain('gh issue list');
      expect(ref).not.toContain('--search');
    });

    it('step 9 and the reference share one -State all read, marker picked by closed_at (#155)', () => {
      const read = 'Get-Milestones.ps1 -Mode issues -Name <name> -State all';
      expect(release).toContain(read);
      expect(ref).toContain(read);
      expect(ref).toContain('the one `-State all` read of the milestone');
      expect(release).toContain('the marker, the round count and the criteria');
      expect(ref).toContain('highest `closed_at`');
      expect(ref).not.toContain('closedAt');
    });

    it('reviews the release diff with a fresh subagent before github-release finish', () => {
      const review = release.indexOf('**Release review**');
      expect(review).toBeGreaterThan(-1);
      expect(review).toBeLessThan(release.indexOf('`github-release` and run `finish`'));
      expect(release).toContain(
        'a subagent with a fresh context loads `code-review`, role `review`',
      );
      expect(release).toContain('`git diff origin/main...origin/release/next`');
      expect(release).toContain("acceptance criteria of the milestone's closed PBIs and Bugs");
      expect(release).toContain('consistency across PBIs');
      expect(release).toContain('`review.schema.json`');
      expect(release).toContain('`references/release-review.md`');
    });

    it('skips the governance rules in the release review (#131)', () => {
      expect(ref).toContain(
        'Skip the governance rules (`references/governance.md` of `code-review`): do not run `Get-GovernanceMatches.ps1`, report no finding with `rule: "adr-missing"` or `rule: "spec-drift"`.',
      );
      expect(ref).toContain("Each PBI's own review (step 4) already applied the rules");
    });

    it('writes the release review file next to the review file of #53', () => {
      expect(release).toContain('`<git-common-dir>/.agents/state/release-review-<key>.json`');
      expect(ref).toContain('schema/deliver-release-review.schema.json');
      expect(ref).toContain('git rev-parse --git-common-dir');
    });

    it('files one bug per blocking finding and opens no release PR', () => {
      expect(release).toContain('one `[Bug] fix: …` issue per finding in the milestone');
      expect(release).toContain('no release PR');
      expect(release).toContain('`release: <n> blocking → #a, #b`');
      for (const section of [
        '## Description',
        '## Reproduction',
        '## Expected / Actual',
        '## Acceptance Criteria',
        'Related: #<PBI>',
        'Found in release review round <round>',
      ])
        expect(ref).toContain(section);
      expect(ref).toContain('--label bug --milestone <name>');
      expect(ref).toContain('runs step 9 again');
    });

    it('links the bug to the PBI, not the PR GitHub appends to the squash subject', () => {
      expect(ref).toContain('`fix: x (#103) (#116)`');
      expect(ref).toContain('the first of the last two is the PBI');
      expect(ref).not.toContain('the `(#<nr>)` at the end of the subject');
      expect(ref).toContain(
        'Only one → it may be the PR: `gh api repos/{owner}/{repo}/pulls/<nr>`',
      );
      expect(ref).toContain('`Closes #<nr>` of its body');
      expect(ref).toContain('not found (404) → `<nr>` is the PBI');
    });

    it('caps the rounds at 2 by the marker in the bug bodies, a third pauses', () => {
      expect(release).toContain('At most 2 release-review rounds per milestone');
      expect(release).toContain('a third with blocking findings is a pause');
      expect(ref).toContain(
        '`round` = 1 + the highest `<n>` of a line `Found in release review round <n>`',
      );
      expect(ref).toContain('`round` ≤ 2: file one bug per finding');
      expect(ref).toContain('`round` > 2: a pause instead of more bugs');
      expect(ref).toContain("the milestone's last closed one");
      expect(ref).toContain('`gh issue edit <nr> --add-label needs-decision`');
    });

    it('asks before filing in interactive mode, files without asking unattended', () => {
      expect(release).toContain('interactive: show them and ask first');
      expect(ref).toContain('Interactive: show the findings first and ask');
      expect(ref).toContain('Unattended: file them without asking');
    });

    it('passes up to 5 notes to the release PR when nothing blocks', () => {
      expect(release).toContain('`finish` with `release_review_notes` (the `notes[]`, up to 5)');
      expect(ref).toContain('`## Release review notes`');
    });

    it('skips the release review when the needs-decision marker exists and names the two ways on in the pause comment', () => {
      expect(release).toContain('release: paused in round 3, waits for a decision');
      expect(release).toContain('labeled `needs-decision`');
      expect(ref).toContain('## Pause marker');
      expect(ref).toContain(
        'skip the review, print `release: paused in round 3, waits for a decision`',
      );
      expect(ref).toContain(
        'remove the marker (`gh issue edit <nr> --remove-label needs-decision`) and run `/deliver --milestone <key>`',
      );
      expect(ref).toContain('run `github-release` `finish` with them as `release_review_notes`');
      expect(ref).toContain(
        'Interactive: ask the user with the findings; the user defers the decision: record the pause',
      );
    });

    it('uses the release-review role for the subagent', () => {
      expect(body).toContain('`release-review` entries of `deliver.roles`');
      expect(ref).toContain('role `release-review`');
      expect(roles).toMatch(/\| `release-review` +\| opus +\| high +\|/);
    });

    it('site/delivery.md describes the release review', () => {
      expect(docs).toContain('## Release review');
      expect(docs).toContain('`release-review`');
      expect(docs).toContain('Found in release review round <n>');
      expect(docs).toContain('`## Release review notes`');
    });
  });

  it('keeps CI watch output unbuffered', () => {
    const ci = body.slice(body.indexOf('**CI.**'), body.indexOf('**Merge.**'));
    expect(ci).toContain('without a pipe or output filter');
    for (const filter of ['tail', 'head', 'grep']) expect(ci).toContain(filter);
    expect(ci).toContain('watch progress reaches the session');
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

  it('ships no workflow.js and does not mention it (#57)', () => {
    expect(fs.existsSync(path.join(skillDir, 'workflow.js'))).toBe(false);
    expect(text).not.toContain('workflow.js');
    expect(roles).not.toContain('workflow.js');
  });

  describe('progress through Report-Progress (#373)', () => {
    const start = body.slice(body.indexOf('## Start'), body.indexOf('## Steps'));
    const steps = body.slice(body.indexOf('## Steps'), body.indexOf('1. **Select.**'));
    const report = body.slice(body.indexOf('## Report'), body.indexOf('## Rules'));

    it('contains no herdr, HERDR or backend command', () => {
      expect(body).not.toMatch(/herdr/i);
      expect(body).not.toContain('report-metadata');
      expect(body).not.toContain('poimen-server');
    });

    it('Start 4 starts a session run and keeps the run id', () => {
      expect(start).toContain('`AGENT_EVENTS_RUN`');
      expect(start).toContain('Report-Progress.ps1 -Type run.started -Source session');
      expect(start).toContain('keep the printed run id');
    });

    it('Start 4 hands the run id to every later call with -Run <id>', () => {
      const line = start.split('\n').find((l) => l.includes('keep the printed run id')) ?? '';
      expect(line).toContain('Add `-Run <id>` to every later call');
      for (const t of ['step.finished', 'attention', 'issue.finished', 'run.finished'])
        expect(line).toContain(t);
    });

    it('every progress-line rule names Report-Progress with its type', () => {
      expect(steps).toContain(
        'Report-Progress.ps1 -Type step.finished -Issue <nr> -Step <step> -Result "<result>" [-Pr <url>]',
      );
      expect(steps).toContain('`-Type attention`');
      expect(steps).toContain('-Type issue.finished');
      expect(report).toContain('Report-Progress.ps1 -Type run.finished');
    });

    it('run.finished is sent only when Start 4 created the run (#397)', () => {
      expect(report).toContain('only when Start 4 created the run');
      expect(report).toContain('never closes the loop');
    });

    it('the herdr reference no longer has Start, Per step or End steps', () => {
      for (const h of ['## Start', '## Per step', '## End']) expect(herdr).not.toContain(h);
      expect(herdr).not.toContain('`printenv HERDR_PANE_ID` once');
      expect(herdrCalls).toEqual([]);
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
    const delivery = fs.readFileSync(path.resolve(__dirname, '../../../site/delivery.md'), 'utf8');

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
      expect(claim).toContain(
        `gh api "repos/{owner}/{repo}/pulls?head=<owner>:<branch>&state=open" --jq '.[] | {number, updated_at}'`,
      );
      expect(claim).not.toContain('gh pr list --head');
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

    it('documents parallel runs in site/delivery.md', () => {
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
    for (const c of ['`AGENTS.md`', '`git`', '`gh`', '`scripts/Report-Progress.ps1`'])
      expect(permissions).toContain(c);
    expect(permissions).not.toContain('report-metadata');
    expect(permissions).not.toContain('printenv HERDR');
  });

  it('Claude Code: permissions.allow in .claude/settings.json', () => {
    const claude = section('Claude Code');
    expect(claude).toContain('`.claude/settings.json`');
    const allow: string[] = json(claude).permissions.allow;
    expect(allow).toEqual(
      expect.arrayContaining([
        'Bash(git:*)',
        'Bash(gh pr:*)',
        'Bash(pwsh .claude/skills/deliver/scripts/Report-Progress.ps1:*)',
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
    for (const sub of [
      'fetch',
      'switch',
      'worktree',
      'add',
      'commit',
      'rebase',
      'push',
      'diff',
      'ls-remote',
      'branch',
    ])
      expect(copilot).toContain(`--allow-tool 'shell(git ${sub})'`);
    expect(copilot).not.toContain("--allow-tool 'shell(git)'");
    for (const flag of [
      "--allow-tool 'shell(gh pr)'",
      "--allow-tool 'shell(gh label)'",
      "--allow-tool 'shell(gh repo view)'",
      "--deny-tool 'shell(git push --force)'",
    ])
      expect(copilot).toContain(flag);
    expect(copilot).not.toContain("'shell(pnpm)'");
  });

  it('Copilot CLI: notes on git subcommands, deny lines, timeout, model and herdr', () => {
    const copilot = section('Copilot CLI');
    expect(copilot).toContain('`shell(git)` covered read-only subcommands only');
    expect(copilot).toContain('did not block `git push --force --dry-run origin release/next`');
    expect(copilot).toContain('`COPILOT_TASK_WAIT_TIMEOUT_SECONDS=3600`');
    expect(copilot).toContain('`copilot --resume=<id> -p "continue"`');
    expect(copilot).toContain(
      '`~/.copilot/settings.json` (`subagents.agents.general-purpose.model`)',
    );
  });

  it('the gh row of the table names label and repo view', () => {
    expect(permissions).toMatch(
      /`gh` \(`auth status`, `api`, `issue`, `pr`, `label`, `repo view`\)/,
    );
    expect(permissions).toMatch(/`ls-remote`, `branch`\)/);
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

  it('knows exactly the roles of references/roles.md', () => {
    expect(roleNames.sort()).toEqual(
      [
        'ci',
        'create',
        'fix',
        'gate',
        'implement',
        'plan',
        'pr',
        'release-review',
        'review',
        'select',
      ].sort(),
    );
  });

  it('allows tiers only on implement and fix', () => {
    const tiered = roleNames.filter(
      (r) => schema.properties.deliver.properties.roles.properties[r].$ref === '#/$defs/tieredRole',
    );
    expect(tiered.sort()).toEqual(['fix', 'implement']);
  });

  describe('governance (#87)', () => {
    const gov = fs.readFileSync(path.join(skillDir, 'references/governance.md'), 'utf8');
    const docs = fs.readFileSync(path.resolve(__dirname, '../../../site/delivery.md'), 'utf8');
    const body = text.slice(text.indexOf('\n---', 3) + 4);
    const sect = (a: string, b: string) => body.slice(body.indexOf(a), body.indexOf(b));

    it('points to the reference with one line', () => {
      expect(body).toMatch(/has `governance`: load `references\/governance\.md`/);
      expect(gov).toMatch(/Loaded only when `\.agents\/config\.json` has the `governance` key/);
    });

    it('the review prompt passes the branch as -Head (#98)', () => {
      expect(sect('4. **Review.**', '5. **')).toContain(
        '`Get-GovernanceMatches.ps1 -Head origin/<branch>`',
      );
    });

    it('the reference defines the decision PBI and the human steps', () => {
      expect(gov).toContain('`needs-decision`');
      expect(gov).toContain('ADR (the next free ADR number) with Status: Proposed');
      expect(gov).toMatch(/never writes the ADR/);
      expect(gov).toMatch(
        /writes the ADR with the `adr` skill, accepts it, removes `needs-decision` and merges/,
      );
      expect(gov).toContain('`gh issue close <nr> --comment "Decided in #<pr>"`');
      expect(docs).toContain('`gh issue close <nr> --comment "Decided in #<pr>"`');
      expect(gov).toContain('spec_notes');
    });

    it('Select reports the decision hint and the report lists it as paused', () => {
      expect(sect('1. **Select.**', '2. **Resume.**')).toContain(
        '`#<nr> select: decision, write the ADR with adr`',
      );
      expect(sect('## Report', '## Rules')).toContain('decision, write the ADR with adr');
    });

    it('step 4 passes labels and notes, step 6 passes spec_notes', () => {
      const s4 = sect('4. **Review.**', '5. **Fix.**');
      expect(s4).toMatch(/issue labels <labels> and implementer `notes\[\]`/);
      const s6 = sect('6. **PR.**', '7. **CI.**');
      expect(s6).toMatch(
        /`spec_notes` \(the implementer `notes\[\]` lines starting with `no spec change needed:`\)/,
      );
    });

    it('site/delivery.md describes the decision PBI and the spec note', () => {
      expect(docs).toContain('## Decision PBIs and spec notes');
      expect(docs).toContain('`## Spec`');
    });

    it('stays within 100 lines', () => {
      expect(text.split('\n').length).toBeLessThanOrEqual(100);
    });
  });
});

describe('deliver help', () => {
  it('follows the help convention', () => {
    expectSkillHelp(skillDir);
  });

  it('names the loop parameters and config keys', () => {
    const help = fs.readFileSync(path.join(skillDir, 'references/help.md'), 'utf8');
    for (const word of [
      '-Target',
      '-Milestone',
      '-Max',
      '-Model',
      'deliver.roles',
      'release-review',
      'governance',
      'needs-decision',
      'needs-refinement',
      'interactive',
    ]) {
      expect(help).toContain(word);
    }
  });
});

describe('M<nnn> milestones (#235)', () => {
  const body = text.slice(text.indexOf('\n---', 3) + 4);
  const release = body.slice(body.indexOf('**Release.**'), body.indexOf('## Pause rules'));
  const ref = fs.readFileSync(path.join(skillDir, 'references/release-review.md'), 'utf8');
  const loop = fs.readFileSync(path.join(skillDir, 'references/loop.md'), 'utf8');
  const help = fs.readFileSync(path.join(skillDir, 'references/help.md'), 'utf8');
  const guide = fs.readFileSync(path.resolve(__dirname, '../../../site/guides/deliver.md'), 'utf8');
  const schemaText = fs.readFileSync(
    path.join(skillDir, 'schema/deliver-release-review.schema.json'),
    'utf8',
  );

  it('resolves --milestone M4 through the github-milestone lookup, open and after close', () => {
    expect(body).toContain(
      'the `github-milestone` lookup resolves `M004` to the title `M004` or, after `close`, `M004 (0.2.0)`',
    );
    expect(body).toContain(
      '`<key>` is its unpadded `M<n>` or sub-number `M<n>.<m>` (`M003` → `M3`, `M011.1` → `M11.1`; `M3` and `M003` share one state file; legacy: the title)',
    );
    expect(body).toContain(
      'The `milestone.title` of that read is the title for `gh issue create --milestone`',
    );
    expect(loop).toContain(
      'resolves `M004` to the title `M004` or, after `/github-milestone close`, `M004 (0.2.0)`',
    );
  });

  it('keys the release-review state file by M<nnn>', () => {
    expect(release).toContain('release-review-<key>.json');
    expect(release).not.toContain('release-review-<milestone>');
    expect(ref).toContain(
      '`M3`, `M003`, `M3 Topic` and `M003 Topic (0.2.0)` share one file `release-review-M3.json`, `M1.1 Topic (0.2.0)` is `M1.1` and never `M1`; legacy: the title',
    );
    expect(ref).toContain('`milestone` = `<key>`');
    expect(ref).toContain('`<name>` the resolved `milestone.title`');
    expect(loop).toContain('`release-review-<key>.json`');
  });

  // #468: one key form in the docs, the schema and the state file names
  it('names the unpadded key form and one state file for M3 and M003 (#468)', () => {
    expect(loop).toContain(
      'is keyed by the unpadded `M<n>` (`M003` → `M3`, one file for both forms)',
    );
    expect(schemaText).toContain('M3 and M003 share one state file');
  });

  it('writes no zero-padded state file name in the skills and docs (#468)', () => {
    for (const f of [
      `${skillDir}/SKILL.md`,
      `${skillDir}/references/release-review.md`,
      `${skillDir}/references/loop.md`,
      `${skillDir}/schema/deliver-release-review.schema.json`,
      path.resolve(__dirname, '../../../site/delivery.md'),
      path.resolve(__dirname, '../../../site/guides/deliver.md'),
      path.resolve(__dirname, '../../../site/guides/release.md'),
      path.resolve(__dirname, '../../../skills/github/github-milestone/SKILL.md'),
    ]) {
      expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/release-review-M\d{3}/);
    }
  });

  it('ends step 9 with the hint to close the milestone after merge and tag', () => {
    expect(release).toContain(
      'End step 9 with the hint `after the release PR is merged and tagged: /github-milestone close M<nnn>`',
    );
  });

  it('help and the deliver guide name the M<nnn> form', () => {
    expect(help).toContain(
      '`M004` finds the title `M004` and, after `github-milestone close`, `M004 (0.2.0)`',
    );
    expect(help).toContain('/deliver --milestone M004');
    expect(help).toContain('-Milestone M004');
    expect(help).toContain('run `/github-milestone close M<nnn>`');
    expect(guide).toContain('/deliver --milestone M004');
    expect(guide).toContain('`M004 (0.2.0)`');
    expect(guide).toContain('deliver-loop -Milestone M004');
    expect(guide).toContain('`/github-milestone close M004`');
  });

  // #224: reviewers must not touch the user's checkouts
  it('review prompts of step 4, step 9 and the release review are read-only', () => {
    const ref = fs.readFileSync(path.join(skillDir, 'references/release-review.md'), 'utf8');
    const step4 = body.slice(body.indexOf('4. **Review.**'), body.indexOf('5. **Fix.**'));
    const step9 = body.slice(
      body.indexOf('9. **Release.**'),
      body.indexOf('After every step read'),
    );
    for (const t of [step4, step9, ref]) {
      expect(t).toMatch(/[Rr]ead-only/);
      expect(t).toContain('no stash, checkout, switch or commit in any existing checkout');
      expect(t).toContain('temporary worktree');
    }
  });
});
