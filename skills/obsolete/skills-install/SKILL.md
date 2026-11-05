---
name: skills-install
description: 'Obsolete: /skills-install is replaced by /skill-manage. Install it with npx skills add GravionLabs/skills --skill skill-manage.'
disable-model-invocation: true
metadata:
  opencode/autoinvoke: 'false'
---

# skills-install (obsolete)

`skills-install` is obsolete. It was replaced by `skill-manage` and is removed in the next major release. This skill only points there: tell the user and stop.

## Switch to skill-manage

```powershell
npx skills add GravionLabs/skills --skill skill-manage
```

## Old command to new command

| Old                                           | New                                         |
| :-------------------------------------------- | :------------------------------------------ |
| `/skills-install [dry-run] [<group>...] [-g]` | `/skill-manage [dry-run] [<group>...] [-g]` |
| `/skills-install update [-g]`                 | `/skill-manage update [-g]`                 |
| `/skills-install help`                        | `/skill-manage help`                        |
