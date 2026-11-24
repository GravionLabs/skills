# Logic prototype

For a question about a state model, rules, a sequence or an algorithm.

- One HTML file with inline script (no build, no dependencies), or one script run with `node`. Prefer the HTML file: buttons make the cases repeatable.
- Model the logic as plain data plus one pure function `step(state, action) -> state`. The UI only calls it.
- Render the full state as formatted JSON after every action, plus the last action and a list of the actions so far.
- One button per action, and a button per hard case that replays a fixed action sequence: a cancel during a retry, the same action twice, an action in the wrong state, an empty input, two actions in a different order.
- Make an illegal transition visible (a red line with the reason) instead of ignoring or throwing it.
- A reset button restores the initial state. No saving to storage.
- Done when each hard case has been run and the verdict can say which ones the model survives.
