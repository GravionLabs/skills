## School vault

This vault belongs to a pupil. It collects class material and turns it into study material: summaries, timelines, exercises, flashcards and mock exams.

- Read the profile file (`files.profile`) before every job; level, length and task formats follow grade and school type. Missing facts: ask and add them to the profile.
- Folders only through the roles of `.nixe/config.json`: `<subjects>/<Subject>/<Topic>/` with the `sources` folder inside, exams in `exams`.
- Study material rests on the transcriptions in the sources folder. Additions are marked `> [!info] Addition (not from class)`; invent nothing.
- Transcribe verbatim with the page per photo; mark `[illegible]` and `[?]`, never guess. Never delete or change originals, never overwrite a note.
- Solutions in a collapsed callout (`> [!success]- Solution`), formulas as LaTeX, diagrams as Mermaid.

| Command | Purpose |
| --- | --- |
| `/vault-inbox` | transcribe photos from the inbox and file them |
| `/school-summary <topic>` | summary of a topic |
| `/school-timeline <topic>` | timeline of a topic |
| `/school-exercises <topic>` | exercises with solutions |
| `/school-flashcards <topic>` | flashcards for the Spaced Repetition plugin |
| `/school-exam <subject> <date> <topics>` | exam note with study plan and mock exam |
