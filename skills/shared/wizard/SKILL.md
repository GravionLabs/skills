---
name: wizard
description: 'Generate an interactive script (bash or PowerShell) that walks a human through steps only a human can take: create a GitHub App and key, set CI secrets, a third-party dashboard, a one-off migration. Not for steps the agent can do itself. Use for "write a setup wizard" or "walk me through the setup".'
---

A wizard is a script that walks a human through a manual procedure: one stage per step, the URL opened, the value captured, written to `.env` or a GitHub secret, a confirmation before anything irreversible. Adapted from mattpocock/skills `wizard` (MIT). The UX is solved in the templates; your job is to scope the procedure and author its stages.

Do not use it for steps the agent can run itself (a CLI call, a file edit, `gh secret set` with a value it already has). Only the steps that need the human's browser, account or clipboard belong in a wizard.

## Steps

1. Scope the procedure from the repository first, do not ask cold:
   - Setup: `.env`, `.env.example`, `.env.*`, README, `docker-compose*`, framework config, and every `secrets.*` and `vars.*` reference in `.github/workflows/*` (each is a value a stage must produce).
   - Migration or cutover: current state, target state and the irreversible actions between them.
2. Show the user the ordered stages with, per captured value: where the human gets it, where it is written (`.env`, a GitHub secret, both, nowhere) and whether it is secret. Confirm; the user may add, drop or reorder.
3. Map each stage to a concrete path ("Settings → Developers → API keys → copy"). Never invent UI steps: where you do not know the current UI or the command, check the docs or ask the user.
4. Author the wizard: copy `templates/wizard.sh` (bash; macOS, Linux, WSL) or `templates/wizard.ps1` (Windows, PowerShell 7+) to the target path, replace the example stage with one stage per step, set the stage total. Offer both when the team works on both. Never edit the library between the `BEGIN` and `END wizard library` markers.
5. Verify and hand off: `bash -n` and `shellcheck` for the `.sh`, PSScriptAnalyzer for the `.ps1`. Do not run it end to end (it opens browsers and waits for input). Trace it: every value of step 2 is captured and lands where step 2 said, and every secret name matches a `secrets.*` reference exactly. Tell the user how to run it.

## Rules

- Open the URL before asking for its value.
- Secret values are read hidden (`ask_secret`, `Read-SecretValue`), never echoed, never logged, never put on a command line (secrets go to `gh` through stdin). Everything else uses `ask`.
- Write every persisted value to `.env` (created with mode 0600; make sure `.env` is gitignored) and set only the secrets CI needs.
- `confirm` before any irreversible action (delete, rotate, cut over).
- One focused task per stage: each stage clears the screen.
- A wizard is ephemeral by default (scratch path, deleted after the run). Commit it only when the user wants a repeatable setup path, and link it from the README.

## Templates

- `templates/wizard.sh`, `templates/wizard.ps1`: same helpers (`stage`, `say`, `step`, `open_url`, `ask`, `ask_secret`, `write_env`, `set_secret`, `set_var`, `pause`, `confirm`, `finish`; the `.ps1` uses PowerShell verbs). Both carry the MIT notice of the upstream template.
