## Schulbereich

Der Schulbereich sammelt das Unterrichtsmaterial einer Schülerin oder eines Schülers und macht daraus Lernmaterial: Zusammenfassungen, Zeitstrahlen, Übungsaufgaben, Karteikarten und Probeklausuren. Er ist der Ordner der Rolle `subjects`, zusammen mit den Klausurnotizen in `exams`; in einem reinen Schul-Vault kann das der ganze Vault sein.

Die folgenden Regeln gelten nur im Schulbereich; für alle anderen Notizen gilt der Rest dieser Datei.

- Vor jeder Arbeit die Profildatei (`files.school-profile`) lesen; Niveau, Umfang und Aufgabenformate richten sich nach Klasse und Schulform. Fehlende Angaben: nachfragen und im Profil ergänzen.
- Ordner nur über die Rollen der `.nixe/config.json`: `<subjects>/<Fach>/<Thema>/` mit dem Ordner `sources` darin, Klausuren in `exams`.
- Lernmaterial stützt sich auf die Transkriptionen im Quellenordner. Ergänzungen stehen in `> [!info] Ergänzung (nicht aus dem Unterricht)`; nichts erfinden.
- Wortgetreu transkribieren, Seitenangabe je Foto; `[unleserlich]` und `[?]` markieren, nie raten. Abgelegte Originale nie löschen oder ändern (nur `/vault-inbox` konvertiert und verschiebt Dateien der Inbox, nach deiner Freigabe), Notizen nie überschreiben.
- Lösungen im eingeklappten Callout (`> [!success]- Lösung`), Formeln als LaTeX, Diagramme als Mermaid.

| Befehl | Zweck |
| --- | --- |
| `/vault-inbox` | Import der Inbox vorschlagen, Freigegebenes transkribieren und ablegen |
| `/school-summary <Thema>` | Zusammenfassung eines Themas |
| `/school-timeline <Thema>` | Zeitstrahl eines Themas |
| `/school-exercises <Thema>` | Übungsaufgaben mit Lösungen |
| `/school-flashcards <Thema>` | Karteikarten für das Spaced-Repetition-Plugin |
| `/school-exam <Fach> <Datum> <Themen>` | Klausurnotiz mit Lernplan und Probeklausur |
