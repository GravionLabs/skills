---
name: skill-manage
description: 'Obsolete: /skill-manage is renamed to /skills-manage. Install it with npx skills add GravionLabs/skills --skill skills-manage.'
disable-model-invocation: true
metadata:
  opencode/autoinvoke: 'false'
---

# skill-manage (obsolete)

`skill-manage` was renamed to `skills-manage` and is removed in the next major release. This skill only points there: tell the user and stop.

## Switch to skills-manage

```powershell
npx skills remove skill-manage
npx skills add GravionLabs/skills --skill skills-manage
```

## Old command to new command

| Old                                         | New                                          |
| :------------------------------------------ | :------------------------------------------- |
| `/skill-manage [dry-run] [<group>...] [-g]` | `/skills-manage [dry-run] [<group>...] [-g]` |
| `/skill-manage update [-g]`                 | `/skills-manage update [-g]`                 |
| `/skill-manage help`                        | `/skills-manage help`                        |
