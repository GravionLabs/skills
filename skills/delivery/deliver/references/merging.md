# PRs waiting for auto-merge

With merge mode `auto` (step 8) the session no longer sees the CI result of a PBI. Step 1 therefore looks at the earlier PBIs of the set first. `pwsh <skill-dir>/scripts/Get-MergingPrs.ps1 -Issues <nr,…>` makes one REST call (`pulls?base=release/next&state=open`, `auto_merge != null`; the issue number is the `<nr>` of the head branch `<type>/<nr>-<slug>`), reads the check runs of each PR (only the required checks of `release/next` from the branch rules, all runs when none can be read; `cancelled` is not red) and prints a JSON array `{ issue, pr, url, state, reason }`.

| state        | meaning                                                              | step 1                                                                                                                       |
| :----------- | :------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| (not listed) | the PR is merged and the issue closed by `release-branch.yml`: done  | nothing                                                                                                                      |
| `waiting`    | checks running or green, auto-merge will merge                       | `#<nr> select: merging, waits for checks`; not open work for the next PBI                                                    |
| `red-change` | a check is red that is not red on `release/next`: red by this change | select the PBI first, fix round (step 5, shared limit of 2), then step 4; the push keeps auto-merge on                       |
| `red-other`  | red on `release/next` too (flake), or a merge conflict (unmergeable) | comment on the PR, the PBI is blocked (as step 7); the rulesets have `strict: false`, so a later PBI does not force a rebase |

A PBI whose open blocker is `merging` waits: `#<nr> select: waits for merge of #<blocker>`. `Invoke-DeliverLoop.ps1` then polls (REST, at most every 60 s, `DELIVER_MERGE_POLL_SECONDS` overrides; the merging set is also refreshed before every iteration, so a `red-change` PBI is selected first) instead of ending `blocked` or `no progress`; a merging PR that is no longer `waiting` leaves the merging set, so the next iteration selects its PBI again.

Step 9 starts only when `Get-MergingPrs.ps1` lists no PR of the milestone.

A PR that is no longer listed but merged, with its issue still open, stays in the merging set until the issue closes.
