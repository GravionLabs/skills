# UI prototype

For a question about layout, flow or which of several designs fits.

- Build the variants on one route of the app (or one HTML file when there is no app). The URL parameter `?variant=a|b|c` picks the variant; no parameter shows a list of links to all of them.
- Each variant is one small component or function with the same fake data; share nothing else, so deleting a variant deletes only it.
- Fake the data in code. No backend calls, no persistence.
- Vary one thing that matters per question (structure, density, flow), not colors and fonts.
- Show the state of the variant (selected item, open panel, form values) in a plain block under it after every action.
- Add a small fixed label with the variant name so a screenshot says which one it is.
- In an Angular or Tauri app, put it in a route that production does not link (`/prototype`) on the `prototype/<name>` branch only.
- Done when each variant has been used for the main flow and the verdict can name the winner and why, or what to combine.
