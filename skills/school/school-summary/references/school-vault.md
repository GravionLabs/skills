# School vault: what the school skills read

Shared by `school-summary`, `school-timeline`, `school-exercises`, `school-flashcards` and `school-exam`. Vault configuration in general: `../vault-inbox/references/vault-config.md` (skill `vault-inbox`).

## Resolve first

`pwsh ../vault-inbox/scripts/Get-VaultRoles.ps1 -Vault <vault root>` prints `language`, the roles (`path`, `exists`), `files.profile` and the template folder as JSON. Use these paths, never a fixed folder name.

| Role        | English default | German vault (example) | Holds                                                 |
| ----------- | --------------- | ---------------------- | ----------------------------------------------------- |
| `inbox`     | `Inbox`         | `Inbox`                | new photos and PDFs                                   |
| `subjects`  | `Subjects`      | `.` (vault root)       | `<Subject>/<Topic>/` folders                          |
| `sources`   | `Sources`       | `Quellen`              | folder name inside a topic: originals + transcription |
| `exams`     | `Exams`         | `Klausuren`            | exam notes and mock exams                             |
| `templates` | `Templates`     | `Vorlagen`             | `Exam.md` / `Klausur.md`                              |

The inbox is committed (it carries the photos from the phone to the computer): no `.gitignore` entry for it. `inbox` and `attachments` are never the same folder.

A topic is `<subjects>/<Subject>/<Topic>/`, its sources are in `<topic>/<sources>/`. A missing role resolves to the default; a role whose folder is missing is reported, never created silently.

## Profile

`files.profile` (default `Profile.md`) holds the frontmatter `name`, `grade`, `school_type`, `state`, `school_year` and a table of the `subjects` (subject, teacher, textbook, notes). German profiles may use `klasse`, `schulform`, `bundesland`, `fach`: read both spellings. Read it before every job: level, length, language and task formats follow grade and school type. A field needed for the job is missing: ask and add it to the profile (append, never overwrite other text).

## Language and file names

Notes are written in the vault's `language` (a note's `lang` frontmatter wins; the language of a foreign-language subject's content is the target language, explanations stay in `language`). Frontmatter keys stay English. File names:

| Note          | English                                 | German                                  |
| ------------- | --------------------------------------- | --------------------------------------- |
| transcription | `<Topic> - Transcription.md`            | `<Thema> – Transkription.md`            |
| summary       | `<Topic> - Summary.md`                  | `<Thema> – Zusammenfassung.md`          |
| timeline      | `<Topic> - Timeline.md`                 | `<Thema> – Zeitstrahl.md`               |
| exercises     | `<Topic> - Exercises.md`                | `<Thema> – Übungsaufgaben.md`           |
| flashcards    | `<Topic> - Flashcards.md`               | `<Thema> – Karteikarten.md`             |
| exam          | `<yyyy-mm-dd> <Subject> - Exam.md`      | `<JJJJ-MM-TT> <Fach> – Klausur.md`      |
| mock exam     | `<yyyy-mm-dd> <Subject> - Mock exam.md` | `<JJJJ-MM-TT> <Fach> – Probeklausur.md` |

Other languages: the English words translated, same separators. Names already used in the topic folder win. The topic is always in the file name so wikilinks stay unique.

## Rules for every note

- Frontmatter: `type` (`summary`, `timeline`, `exercises`, `flashcards`, `exam`, `mock-exam`), `subject`, `topic`, `grade`, `created` (yyyy-mm-dd), `sources` (wikilink to the transcription), `lang` when it differs from the vault's `language`.
- Base the note on the transcriptions in the topic's sources folder. Anything beyond them goes in a callout `> [!info] Addition (not from class)` (title in the note language). Invent no dates, quotes or formulas.
- Never delete or overwrite a note: extend it and leave hand-edited parts as they are.
- Solutions are in a collapsed callout (`> [!success]- Solution`). Formulas as LaTeX, diagrams as Mermaid. A callout is a plain blockquote in other readers.
- Style: clear, age-appropriate, no filler; explain a technical term at first use.
