# Fill the guide from an existing UI repository

Derive the first guide from what the code does. Nothing is invented: every rule comes from a file you read. A point the code does not settle is written as a question for the owner (`Open: <question>`), never as a guess.

## Steps

1. **Find the token file.** CSS custom properties (`:root { --… }`), a theme object or a Tailwind/design-token config. Put its path in `## Tokens`. Record the path only, no values.
2. **List the roles that exist.** Group the tokens by job: background, surface, border, text, muted text, primary action, danger, focus, plus any others the file has (success, warning). Use the role names of the code. A role the code lacks is not added; write `Open: no <role> token, intended?`.
3. **Read the type, radius and elevation scales.** Name the font families, the number of sizes, the radius steps and the elevation levels as they appear in the token file. Fill `## Typography` and `## Radius and elevation`.
4. **Find shared components.** List components that appear in more than one screen and name the primitive used for each job (button, input, dialog, menu, table). Fill `## Components` with the component directory and one line per job. Where two primitives do the same job, write `Open: which one is the standard?`.
5. **Copy measurable rules from the code.** Transition durations, minimum target sizes, breakpoints, the supported browsers (from the build config), keyboard shortcuts. Copy the number or the check as the code has it. Fill `## UX rules` and `## Cross-platform`.
6. **Fill `## Color`** from step 2 and the contrast the tokens give; run a contrast check on the text and surface pairs and state only a result you measured.
7. **Drop what the project lacks.** A deep-dive file or section with nothing real to say is removed together with its link; do not pad it.
8. **End with `## When this guide is silent`.** Keep the three steps of the template unchanged.
9. **Collect the open points.** List every `Open:` line in the PR description for the owner to answer; remove each line from the guide once it is answered.

## Check

- Every `<placeholder>` of `templates/STYLEGUIDE.md` is filled or its line removed.
- The core file has the eight sections and at most 100 lines.
- No hex value, pixel size or font name is repeated that the token file already holds, except a measurable minimum.
