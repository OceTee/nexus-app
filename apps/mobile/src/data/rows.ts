// SQLite row shapes (snake_case, integers for booleans). Repositories map rows
// to domain objects; screens never see a Row (TDD Section G).

export interface NoteRow {
  rowid?: number;
  id: string;
  collection_id: string | null;
  title: string;
  title_norm: string;
  body_md: string;
  body_text: string;
  excerpt: string;
  word_count: number;
  is_pinned: number;
  server_rev: number;
  local_rev: number;
  dirty: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CollectionRow {
  id: string;
  parent_id: string | null;
  name: string;
  icon: string | null;
  sort_order: number;
  server_rev: number;
  local_rev: number;
  dirty: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface TagRow {
  id: string;
  name: string;
  name_norm: string;
  colour: string | null;
  server_rev: number;
  local_rev: number;
  dirty: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface NoteTagRow {
  note_id: string;
  tag_id: string;
  created_at: string;
  deleted_at: string | null;
  dirty: number;
}

export interface OutboxRow {
  seq: number;
  op_id: string;
  entity_type: string;
  entity_id: string;
  op: string;
  payload: string;
  base_rev: number | null;
  status: 'pending' | 'inflight' | 'failed';
  attempts: number;
  last_error: string | null;
  created_at: string;
}

export interface LocalVersionRow {
  id: string;
  note_id: string;
  rev: number;
  base_rev: number | null;
  title: string;
  body_md: string;
  conflict: number;
  source: string;
  device_name: string | null;
  created_at: string;
}

export interface ConflictRow {
  id: string;
  note_id: string;
  version_id: string;
  server_rev: number;
  device_name: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface AttachmentRow {
  id: string;
  note_id: string | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  status: string;
  width: number | null;
  height: number | null;
  server_rev: number;
  local_rev: number;
  dirty: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
