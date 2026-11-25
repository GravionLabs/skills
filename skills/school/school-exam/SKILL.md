---
name: school-exam
description: 'Prepare an exam: create the exam note with scope and study plan and a mock exam with marking scheme. Use when an exam date is coming up.'
---

# school-exam

Details: `$ARGUMENTS` (`<subject> <date> <topics>`).

Resolve the vault first and read the profile: `pwsh ../vault-inbox/scripts/Get-VaultRoles.ps1 -Vault <vault root>` prints `language`, the roles and `files.school-profile`. Roles, profile fields, file name patterns and the rules every note follows: `../school-summary/references/school-vault.md` (read it).

Needed: subject, date and topics. Ask for duration, task formats and the teacher's focus when not given; when unknown, assume usual values for grade and school type and note that in the exam note.

## Steps

1. Read the profile and check all topic folders of the scope. Summaries or transcriptions missing: say so and offer to create them first.
2. Create the exam note in the `exams` role from the template (template folder from the script: `Exam.md`, or `Klausur.md` in a German vault; without one use `../school-summary/assets/<en|de>/Exam.md` or the structure there). Link the scope, add the study plan from today to the date as a checklist.
3. Create the mock exam in the same folder, link it from the exam note.

## Study plan

- Plan backwards from the date; the day before is revision only.
- Units of 20-45 minutes with concrete content: `- [ ] Mon 12 Oct - read summary Inflation, flashcards round 1`.
- Order: understand (summary) → memorize (flashcards) → apply (exercises) → mock exam under time pressure two to three days before.

## Mock exam

```markdown
# Mock exam <Subject> - <Topics>

**Time:** 45 minutes · **Aids:** … · **Points:** 40

## Material

M1: source, text, diagram or data set (from the class sources or new, then marked as constructed)

## Tasks

1. Summarize M1. _(level I, 10 pts)_
2. Explain … _(level II, 16 pts)_
3. Evaluate … _(level III, 14 pts)_

---

> [!success]- Marking scheme
> Per task: expected content with points.

> [!info]- Grade scale
> Point limits per grade.
```

## Rules

- Follow real class tests of the subject and grade: middle school several shorter tasks, upper school material-based tasks with operators and about 30 % level I, 40 % II, 30 % III.
- The scope must be doable in the time.
- Use other tasks than in the topic's exercises note.
- Maths/science: recompute every solution of the marking scheme.
- Marking scheme and grade scale always collapsed.
