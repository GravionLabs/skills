# Group `statusline`

Skills of the `statusline` group and what each one does. Read before changing a skill of this group.

Skill `context-statusline` (user-invoked, Claude Code and Copilot CLI: `scripts/statusline.mjs`, `scripts/context-warning.sh` (context warning hook, registered by the installer, `-NoContextWarning` opts out), Node >= 22, plus `Install-Statusline.ps1 -Client <claude, copilot or all>`that points`statusLine`/`subagentStatusLine`in`~/.claude/settings.json`and`statusLine`+ the`STATUS_LINE`feature flag in`~/.copilot/settings.json`/`$COPILOT_HOME` at the installed skill's own scripts (`~/.claude/skills/...`resp.`~/.agents/skills/...`, no copy, so `npx skills update` refreshes them)).
