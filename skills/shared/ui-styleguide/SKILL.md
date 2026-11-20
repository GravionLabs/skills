---
name: ui-styleguide
description: 'Add a short UI style guide (docs/STYLEGUIDE.md) with deep-dive files and a binding AGENTS.md paragraph to a project. Use for "add a style guide", "UI conventions", "design rules for agents".'
---

Gives a project a short core style guide and deep-dive files that an agent reads only when a task touches the topic. Framework-neutral.

## When to use

- A project with a UI has no `docs/STYLEGUIDE.md`, or agents drift from its look and behavior.
- Not for generating the design itself: the skill copies and fills a template with the project's real rules.

## Steps

1. Look for `docs/STYLEGUIDE.md`. If it exists, diff against `templates/STYLEGUIDE.md` and propose additions; never overwrite.
2. Copy `templates/STYLEGUIDE.md` to `docs/STYLEGUIDE.md` and `templates/styleguide/*.md` to `docs/styleguide/`.
3. Fill every `<placeholder>` from the project: the token file, the real components, the real rules. Drop a deep-dive file and its link when the project has nothing to say there.
4. Add the paragraph of `templates/agents-styleguide.md` to the project's `AGENTS.md`.
5. Keep the core file at ≤ 100 lines; move detail into a deep-dive file.

## Design rules

- Document roles, not values: the guide says "primary action", the CSS token file holds the hex value. A value in the guide goes stale.
- Rules are measurable: "buttons are at least 32px high" can be checked, "buttons feel balanced" cannot.
- End with what to do when the guide is silent (`## When this guide is silent`): follow the nearest existing component, then ask or record the decision.

## Templates

- `templates/STYLEGUIDE.md`: core file, eight sections, each deep-dive linked with its reading condition.
- `templates/styleguide/color.md`, `components.md`, `ux-rules.md`: deep dives.
- `templates/agents-styleguide.md`: the binding `AGENTS.md` paragraph.
