# NEXUS export formats

NEXUS exports on the device (Settings → Export) in two formats. Both are
delivered as a `.zip` through the system share sheet. Format version: **1**.

## Markdown bundle (`nexus-markdown-<date>.zip`)

```
index.json
Work/Projects/Kalman filters.md
Work/Projects/Kalman filters (2).md      ← same title, second note
Reading list.md                           ← unfiled note at the root
attachments/<attachmentId>-<filename>     ← when "Include attachments" is on
```

- One `.md` file per live note (Trash is not exported). Folders mirror the
  collection tree; unfiled notes sit at the root. File and folder names have
  `\ / : * ? " < > |` and control characters replaced by `-`, are trimmed to
  80 characters, and clashes get ` (2)`, ` (3)`… (compared case-insensitively).
- Each file starts with YAML front-matter, then the Markdown body unchanged,
  except that `nexus://attachment/<id>` references point at the bundled file
  with a relative path.

```yaml
---
id: 0190c2f4-6a1e-7c3b-9d2a-1f4e5b6c7d8e
title: Kalman filters
created: 2026-11-01T09:12:03.120Z
updated: 2026-11-06T14:02:44.501Z
collection: Work/Projects # null when unfiled
tags:
  - maths
  - robotics
links: # wiki-link targets as written, de-duplicated
  - State estimation
  - Sensor fusion
pinned: true # present only when pinned
---
```

Strings are written plain when safe and double-quoted with `\\`, `\"`, `\n`,
`\r`, `\t` escapes otherwise, so any YAML 1.2 parser reads them.

`index.json` maps every id to its path:

```json
{
  "format": "nexus-markdown-bundle",
  "version": 1,
  "exportedAt": "2026-11-06T15:00:00.000Z",
  "notes": [{ "id": "…", "title": "…", "path": "Work/Projects/Kalman filters.md" }],
  "attachments": [
    { "id": "…", "noteId": "…", "filename": "plot.png", "path": "attachments/…-plot.png" }
  ],
  "collections": [{ "id": "…", "parentId": null, "name": "Work" }],
  "tags": [{ "id": "…", "name": "maths", "colour": "#3B5BDB" }]
}
```

An attachment that was neither cached nor downloadable (offline) has
`"path": null` and is listed to the user as left out.

## JSON (`nexus-json-<date>.zip` containing `nexus.json`)

All entities in one document, validated by
[`schemas/nexus-export.schema.json`](schemas/nexus-export.schema.json).
With "Include version history", each note carries the versions held on the
device (`versions: [{ rev, title, bodyMd, createdAt }]`).

## Compatibility

Readers should check `format` and `version`. New optional fields may appear
within version 1; anything that changes the meaning of existing fields bumps
the version.
