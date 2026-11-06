// Client schema version 1 (TDD Section E, Client SQLite schema). Mirrors the
// server's business columns and adds the sync columns server_rev, local_rev,
// dirty and deleted_at. Ids are the same UUIDv7 strings on both sides.
// notes.title_norm (normaliseTitle(title)) is an addition for link resolution.

export const m0001_init: string[] = [
  `CREATE TABLE notes (
    id            TEXT PRIMARY KEY,
    collection_id TEXT,
    title         TEXT NOT NULL DEFAULT '',
    title_norm    TEXT NOT NULL DEFAULT '',
    body_md       TEXT NOT NULL DEFAULT '',
    body_text     TEXT NOT NULL DEFAULT '',
    excerpt       TEXT NOT NULL DEFAULT '',
    word_count    INTEGER NOT NULL DEFAULT 0,
    is_pinned     INTEGER NOT NULL DEFAULT 0,
    server_rev    INTEGER NOT NULL DEFAULT 0,
    local_rev     INTEGER NOT NULL DEFAULT 0,
    dirty         INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    deleted_at    TEXT
  )`,
  `CREATE INDEX notes_updated_idx ON notes (is_pinned DESC, updated_at DESC)`,
  `CREATE INDEX notes_collection_idx ON notes (collection_id)`,
  // Addition to the TDD schema: resolves [[links]] by normalised title without a scan.
  `CREATE INDEX notes_title_norm_idx ON notes (title_norm)`,
  `CREATE INDEX notes_dirty_idx ON notes (dirty) WHERE dirty = 1`,

  `CREATE VIRTUAL TABLE notes_fts USING fts5(
    title, body_text,
    content = 'notes', content_rowid = 'rowid',
    tokenize = 'unicode61 remove_diacritics 2',
    prefix = '2 3'
  )`,
  `CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts(rowid, title, body_text) VALUES (new.rowid, new.title, new.body_text);
  END`,
  `CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, body_text)
      VALUES ('delete', old.rowid, old.title, old.body_text);
  END`,
  `CREATE TRIGGER notes_au AFTER UPDATE OF title, body_text ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, body_text)
      VALUES ('delete', old.rowid, old.title, old.body_text);
    INSERT INTO notes_fts(rowid, title, body_text) VALUES (new.rowid, new.title, new.body_text);
  END`,

  `CREATE TABLE collections (
    id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL, icon TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    server_rev INTEGER NOT NULL DEFAULT 0, local_rev INTEGER NOT NULL DEFAULT 0,
    dirty INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
  )`,
  `CREATE TABLE tags (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, name_norm TEXT NOT NULL, colour TEXT,
    server_rev INTEGER NOT NULL DEFAULT 0, local_rev INTEGER NOT NULL DEFAULT 0,
    dirty INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
  )`,
  `CREATE UNIQUE INDEX tags_name_uq ON tags (name_norm) WHERE deleted_at IS NULL`,
  `CREATE TABLE note_tags (
    note_id TEXT NOT NULL, tag_id TEXT NOT NULL,
    created_at TEXT NOT NULL, deleted_at TEXT, dirty INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (note_id, tag_id)
  )`,
  `CREATE TABLE note_links (
    source_note_id TEXT NOT NULL, target_title_norm TEXT NOT NULL, target_note_id TEXT,
    PRIMARY KEY (source_note_id, target_title_norm)
  )`,
  `CREATE INDEX note_links_target_idx ON note_links (target_note_id)`,
  `CREATE TABLE attachments (
    id TEXT PRIMARY KEY, note_id TEXT, filename TEXT NOT NULL, mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, status TEXT NOT NULL,
    width INTEGER, height INTEGER,
    server_rev INTEGER NOT NULL DEFAULT 0, local_rev INTEGER NOT NULL DEFAULT 0,
    dirty INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
  )`,
  `CREATE TABLE note_versions_local (
    id TEXT PRIMARY KEY, note_id TEXT NOT NULL, rev INTEGER NOT NULL, base_rev INTEGER,
    title TEXT NOT NULL, body_md TEXT NOT NULL, conflict INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL, device_name TEXT, created_at TEXT NOT NULL
  )`,
  `CREATE INDEX note_versions_local_note_idx ON note_versions_local (note_id, created_at DESC)`,
  `CREATE TABLE outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    op_id TEXT NOT NULL UNIQUE, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
    op TEXT NOT NULL, payload TEXT NOT NULL, base_rev INTEGER,
    status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT, created_at TEXT NOT NULL
  )`,
  `CREATE INDEX outbox_status_idx ON outbox (status, seq)`,
  `CREATE TABLE conflicts (
    id TEXT PRIMARY KEY, note_id TEXT NOT NULL, version_id TEXT NOT NULL,
    server_rev INTEGER NOT NULL, device_name TEXT, created_at TEXT NOT NULL, resolved_at TEXT
  )`,
  `CREATE TABLE attachment_cache (
    attachment_id TEXT PRIMARY KEY, local_path TEXT NOT NULL, size_bytes INTEGER NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0, cached_at TEXT NOT NULL, last_access_at TEXT NOT NULL
  )`,
  `INSERT INTO sync_state (key, value) VALUES ('cursor', '0') ON CONFLICT(key) DO NOTHING`,
];
