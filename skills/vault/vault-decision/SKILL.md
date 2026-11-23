---
name: vault-decision
description: 'Write a decision record with context, options, outcome and consequences. Use when a decision was made or needs to be prepared and should stay traceable.'
---

# vault-decision

Arguments: `$ARGUMENTS` (title, optional project).

Resolve the vault first: `pwsh ../vault-inbox/scripts/Get-VaultRoles.ps1 -Vault <vault root>` prints the `language`, every folder role (`path`, `description`, `exists`) and the template folder. Use only these paths, never a fixed folder name. See `../vault-inbox/references/vault-config.md`.

## Steps

1. Read the `Decision` template of the template folder (fall back to: Context, Options, Decision, Consequences) and the notes the user names or that clearly relate.
2. Fill it from the material. Decision still open: `status: draft`, options with pros and cons, a recommendation clearly separated from the facts.
3. Save `YYYY-MM-DD Title.md` in the project (`projects` role) or area (`areas` role) folder, in the vault's `language`; link meeting, project and source notes.
4. Report missing information needed to complete it.

## Rules

- State the decision in one sentence at the top of "Decision".
- Options include "do nothing" when realistic.
- Record why alternatives were rejected; that is lost first.
- A decision that replaces an earlier one links both and sets the old record's `status: archived`.
- Frontmatter keys stay English (`type: decision`, `status`, `project`).
