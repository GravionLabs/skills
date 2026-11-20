# Budget

A root `AGENTS.md` has at most **8 000 characters**. A nested `AGENTS.md` has the same limit.

## Why characters

Line counts say little. A table row can be 20 000 characters on one line: `AGENTS.md` of one repository had 91 lines and 56 195 bytes, another 107 lines and 96 366 bytes, a third 292 lines and 14 895 bytes. The file is loaded into the context of every session, so its size in characters is its cost.

## How to count

```powershell
(Get-Content AGENTS.md -Raw).Length
```

```sh
wc -m AGENTS.md
```

Both count characters of the whole file, including line breaks and Markdown syntax.

## At the limit

1. Do not raise the limit.
2. Remove rules that the admission rule would not admit today (obvious, seen once, vague).
3. Move task-specific sections to reference files (`ref-files.md`).
4. Shorten long table rows: a table cell that lists details belongs in a reference file.
