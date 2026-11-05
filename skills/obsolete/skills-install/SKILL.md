---
name: skills-install
description: 'Obsolete: /skills-install is replaced by /skills-manage. Install it with npx skills add GravionLabs/skills --skill skills-manage.'
disable-model-invocation: true
metadata:
  opencode/autoinvoke: 'false'
---

# skills-install (obsolete)

`skills-install` is obsolete. It was replaced by `skills-manage` and is removed in the next major release. This skill only points there: tell the user and stop.

## Switch to skills-manage

```powershell
npx skills add GravionLabs/skills --skill skills-manage
```

## Old command to new command

| Old                                           | New                                          |
| :-------------------------------------------- | :------------------------------------------- |
| `/skills-install [dry-run] [<group>...] [-g]` | `/skills-manage [dry-run] [<group>...] [-g]` |
| `/skills-install update [-g]`                 | `/skills-manage update [-g]`                 |
| `/skills-install help`                        | `/skills-manage help`                        |
