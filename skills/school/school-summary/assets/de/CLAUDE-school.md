## Schul-Vault

Dieser Vault gehört einer Schülerin oder einem Schüler. Er sammelt Unterrichtsmaterial und macht daraus Lernmaterial: Zusammenfassungen, Zeitstrahlen, Übungsaufgaben, Karteikarten und Probeklausuren.

- Vor jeder Arbeit die Profildatei (`files.profile`) lesen; Niveau, Umfang und Aufgabenformate richten sich nach Klasse und Schulform. Fehlende Angaben: nachfragen und im Profil ergänzen.
- Ordner nur über die Rollen der `.nixe/config.json`: `<subjects>/<Fach>/<Thema>/` mit dem Ordner `sources` darin, Klausuren in `exams`.
- Lernmaterial stützt sich auf die Transkriptionen im Quellenordner. Ergänzungen stehen in `> [!info] Ergänzung (nicht aus dem Unterricht)`; nichts erfinden.
- Wortgetreu transkribieren, Seitenangabe je Foto; `[unleserlich]` und `[?]` markieren, nie raten. Originale nie löschen oder ändern, Notizen nie überschreiben.
- Lösungen im eingeklappten Callout (`> [!success]- Lösung`), Formeln als LaTeX, Diagramme als Mermaid.

| Befehl | Zweck |
| --- | --- |
| `/vault-inbox` | Fotos aus der Inbox transkribieren und einsortieren |
| `/school-summary <Thema>` | Zusammenfassung eines Themas |
| `/school-timeline <Thema>` | Zeitstrahl eines Themas |
| `/school-exercises <Thema>` | Übungsaufgaben mit Lösungen |
| `/school-flashcards <Thema>` | Karteikarten für das Spaced-Repetition-Plugin |
| `/school-exam <Fach> <Datum> <Themen>` | Klausurnotiz mit Lernplan und Probeklausur |
