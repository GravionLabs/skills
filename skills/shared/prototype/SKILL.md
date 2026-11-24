---
name: prototype
description: 'Build throwaway code that answers one design question: one HTML file for a state model or logic, or UI variants on one route. Use for "prototype this", "try it before we plan", "compare UI variants".'
---

A prototype is throwaway code that answers one design question before a Feature is planned. Adapted from mattpocock/skills `prototype` (MIT). The output is a verdict, not a component.

## Steps

1. Write the question in one sentence ("Does this state model survive a cancel during a retry?"). No question, no prototype: ask the user.
2. Pick the branch from the question:
   - State, rules, ordering, edge cases, "does this logic hold": read `references/logic.md`.
   - Look, layout, flow, "which variant feels right": read `references/ui.md`.
   - Both: logic first, then the UI on top of it.
3. Build it under the rules below, run it, drive it through the hard cases and note what it showed.
4. Finish as described in "When done".

## Rules

- Mark it as a prototype: a banner in the page or output and a header comment (`PROTOTYPE: throwaway, answers <question>`).
- One command runs it (`node proto.mjs`, `open proto.html`, `pnpm dev`). Put the command in the header comment.
- No persistence by default: state lives in memory, a reload starts fresh.
- No polish: no design system, no accessibility pass, no error handling beyond what the question needs.
- Show the full state after every action, in the page or the output, so a wrong state is seen at once.
- No tests for prototype code and no production-ready components. Do not import it from the app.
- Use the project's own stack only where the question depends on it; otherwise the fewest dependencies.

## When done

1. Write the verdict: the question, what the prototype showed, the decision, and what stays open. Put it in the issue as a comment or under `## Decisions`.
2. Commit the code on the branch `prototype/<name>` and push it. Never merge it and never open a pull request into the base.
3. Link the branch from the issue (`prototype/<name>` with the commit URL).
4. Do not copy prototype code into the product: the Feature that follows is planned and built from the verdict.
