import { describe, expect, it } from 'vitest';
import {
  AttachmentCreateInput,
  AttachmentMetaInput,
  ChangePasswordInput,
  CollectionCreateInput,
  DeviceUpdateInput,
  Email,
  GraphNeighboursQuery,
  GraphQuery,
  LoginInput,
  NoteCreateInput,
  NoteListQuery,
  NoteUpdateInput,
  PageQuery,
  Paginated,
  NoteSummaryDto,
  RegisterInput,
  ResolveConflictInput,
  SearchQuery,
  SyncPushRequest,
  SyncResponse,
  TagCreateInput,
  UpdateMeInput,
  UserSettings,
  UuidV7,
  LIMITS,
} from '../src';

// Example payloads are taken from TDD Section F, API endpoint catalogue.
const DEVICE = {
  id: '019300a1-7d2e-7c3a-9f41-2a7b1c9e0d11',
  name: 'Pixel 7',
  platform: 'android',
  appVersion: '1.0.0',
} as const;
const NOTE_ID = '019300a9-2222-7000-8000-00000000aaaa';
const TAG_ID = '0192ff00-3333-7000-8000-00000000bbbb';
const COLLECTION_ID = '0192fe00-4444-7000-8000-00000000cccc';

describe('common', () => {
  it('UuidV7 accepts v7 and rejects v4 ids', () => {
    expect(UuidV7.safeParse(NOTE_ID).success).toBe(true);
    expect(UuidV7.safeParse('6f1c2a3e-9b4d-4c2e-8f1a-2b3c4d5e6f70').success).toBe(false);
  });

  it('PageQuery applies the default limit and caps it at 200', () => {
    expect(PageQuery.parse({})).toEqual({ limit: 50 });
    expect(PageQuery.parse({ limit: '20' }).limit).toBe(20);
    expect(PageQuery.safeParse({ limit: '201' }).success).toBe(false);
  });

  it('Paginated builds the list envelope', () => {
    const page = Paginated(NoteSummaryDto);
    expect(page.safeParse({ items: [], nextCursor: null, hasMore: false }).success).toBe(true);
  });
});

describe('auth', () => {
  it('accepts the documented register payload and normalises the email', () => {
    const parsed = RegisterInput.parse({
      email: '  Amara@Example.com ',
      password: 'correct-horse-battery',
      displayName: 'Amara',
      device: DEVICE,
    });
    expect(parsed.email).toBe('amara@example.com');
  });

  it('enforces password length on register but not on login', () => {
    expect(
      RegisterInput.safeParse({ email: 'a@b.co', password: 'short', device: DEVICE }).success,
    ).toBe(false);
    expect(
      LoginInput.safeParse({ email: 'a@b.co', password: 'short', device: DEVICE }).success,
    ).toBe(true);
  });

  it('rejects invalid emails', () => {
    expect(Email.safeParse('not-an-email').success).toBe(false);
  });

  it('requires a different new password', () => {
    const r = ChangePasswordInput.safeParse({
      currentPassword: 'same-pass-1',
      newPassword: 'same-pass-1',
    });
    expect(r.success).toBe(false);
  });

  it('fills user settings defaults', () => {
    expect(UserSettings.parse({})).toEqual({
      telemetryOptIn: false,
      push: { newDeviceSignIn: true },
    });
  });
});

describe('account and devices', () => {
  it('UpdateMeInput requires at least one field', () => {
    expect(UpdateMeInput.safeParse({}).success).toBe(false);
    expect(UpdateMeInput.safeParse({ settings: { telemetryOptIn: true } }).success).toBe(true);
  });

  it('DeviceUpdateInput allows clearing the push token', () => {
    expect(DeviceUpdateInput.safeParse({ pushToken: null }).success).toBe(true);
    expect(DeviceUpdateInput.safeParse({}).success).toBe(false);
  });
});

describe('notes', () => {
  it('fills defaults for a minimal note', () => {
    expect(NoteCreateInput.parse({ id: NOTE_ID })).toEqual({
      id: NOTE_ID,
      title: '',
      bodyMd: '',
      collectionId: null,
      isPinned: false,
      tagIds: [],
    });
  });

  it('accepts the documented create payload', () => {
    const r = NoteCreateInput.safeParse({
      id: NOTE_ID,
      title: 'Kalman filtering',
      bodyMd: '# Kalman filtering\n\nSee [[State estimation]] and [[Sensor fusion]].',
      collectionId: COLLECTION_ID,
      isPinned: false,
      tagIds: [TAG_ID],
    });
    expect(r.success).toBe(true);
  });

  it('enforces title, body and tag limits', () => {
    expect(NoteCreateInput.safeParse({ id: NOTE_ID, title: 'x'.repeat(201) }).success).toBe(false);
    expect(
      NoteCreateInput.safeParse({ id: NOTE_ID, bodyMd: 'x'.repeat(LIMITS.noteBodyMax + 1) })
        .success,
    ).toBe(false);
    expect(NoteCreateInput.safeParse({ id: NOTE_ID, tagIds: Array(51).fill(TAG_ID) }).success).toBe(
      false,
    );
  });

  it('requires baseRev on update', () => {
    expect(NoteUpdateInput.safeParse({ title: 'x' }).success).toBe(false);
    expect(NoteUpdateInput.parse({ title: 'x', baseRev: 3 })).toEqual({ title: 'x', baseRev: 3 });
  });

  it('parses list query strings', () => {
    expect(NoteListQuery.parse({ pinned: 'true', limit: '10' })).toMatchObject({
      pinned: true,
      limit: 10,
    });
    expect(NoteListQuery.safeParse({ pinned: 'yes' }).success).toBe(false);
  });

  it('requires bodyMd for merged conflict resolutions', () => {
    expect(ResolveConflictInput.safeParse({ strategy: 'merged', baseRev: 8 }).success).toBe(false);
    expect(ResolveConflictInput.safeParse({ strategy: 'keep_server', baseRev: 8 }).success).toBe(
      true,
    );
  });
});

describe('collections and tags', () => {
  it('validates collection names and icons', () => {
    expect(
      CollectionCreateInput.safeParse({ id: COLLECTION_ID, name: 'Thesis', icon: 'book-open' })
        .success,
    ).toBe(true);
    expect(CollectionCreateInput.safeParse({ id: COLLECTION_ID, name: '' }).success).toBe(false);
    expect(
      CollectionCreateInput.safeParse({ id: COLLECTION_ID, name: 'x', icon: 'Bad Icon' }).success,
    ).toBe(false);
  });

  it('rejects tag names with spaces or # and bad colours', () => {
    expect(
      TagCreateInput.safeParse({ id: TAG_ID, name: 'thesis', colour: '#3B5BDB' }).success,
    ).toBe(true);
    expect(TagCreateInput.safeParse({ id: TAG_ID, name: 'two words' }).success).toBe(false);
    expect(TagCreateInput.safeParse({ id: TAG_ID, name: '#thesis' }).success).toBe(false);
    expect(TagCreateInput.safeParse({ id: TAG_ID, name: 'x', colour: 'blue' }).success).toBe(false);
  });
});

describe('attachments', () => {
  const meta = {
    noteId: NOTE_ID,
    filename: 'whiteboard.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 2_418_332,
    sha256: 'a'.repeat(64),
    width: 3024,
    height: 4032,
  };

  it('accepts the documented create payload', () => {
    expect(
      AttachmentCreateInput.safeParse({ ...meta, id: '019300c0-6666-7000-8000-00000000eeee' })
        .success,
    ).toBe(true);
  });

  it('rejects unsupported types, oversize files and path-like names', () => {
    expect(AttachmentMetaInput.safeParse({ ...meta, mimeType: 'image/gif' }).success).toBe(false);
    expect(
      AttachmentMetaInput.safeParse({ ...meta, sizeBytes: LIMITS.attachmentBytesMax + 1 }).success,
    ).toBe(false);
    expect(AttachmentMetaInput.safeParse({ ...meta, filename: '../etc/passwd' }).success).toBe(
      false,
    );
  });
});

describe('graph and search', () => {
  it('splits comma-separated tag ids', () => {
    expect(GraphQuery.parse({ tagIds: `${TAG_ID},${TAG_ID}` }).tagIds).toEqual([TAG_ID, TAG_ID]);
    expect(GraphQuery.parse({}).limit).toBe(500);
  });

  it('accepts depth 1 or 2 only', () => {
    expect(GraphNeighboursQuery.parse({ depth: '2' })).toEqual({ depth: 2 });
    expect(GraphNeighboursQuery.safeParse({ depth: '3' }).success).toBe(false);
  });

  it('requires a non-empty query', () => {
    expect(SearchQuery.safeParse({ q: '  ' }).success).toBe(false);
    expect(SearchQuery.parse({ q: ' kalman ' }).q).toBe('kalman');
  });
});

describe('sync', () => {
  const push = {
    deviceId: DEVICE.id,
    cursor: 48213,
    clientSchema: 1,
    ops: [
      {
        opId: '019300b2-1111-7000-8000-000000000001',
        type: 'note.upsert',
        entityId: NOTE_ID,
        baseRev: 7,
        createdAt: '2026-11-04T10:02:11Z',
        payload: {
          title: 'Kalman filtering',
          bodyMd: 'Links to [[State estimation]].',
          collectionId: null,
          isPinned: false,
          tagIds: [],
        },
      },
      {
        opId: '019300b2-1111-7000-8000-000000000002',
        type: 'note_tag.add',
        noteId: NOTE_ID,
        tagId: TAG_ID,
        createdAt: '2026-11-04T10:02:12Z',
      },
    ],
  };

  it('accepts the documented push request', () => {
    const parsed = SyncPushRequest.parse(push);
    expect(parsed.ops.map((o) => o.type)).toEqual(['note.upsert', 'note_tag.add']);
  });

  it('rejects unknown op types and missing payloads', () => {
    const bad = { ...push, ops: [{ ...push.ops[0], type: 'note.explode' }] };
    expect(SyncPushRequest.safeParse(bad).success).toBe(false);
    const noPayload = { ...push, ops: [{ ...push.ops[0], payload: undefined }] };
    expect(SyncPushRequest.safeParse(noPayload).success).toBe(false);
  });

  it('caps a batch at 100 ops', () => {
    const many = { ...push, ops: Array(101).fill(push.ops[1]) };
    expect(SyncPushRequest.safeParse(many).success).toBe(false);
  });

  it('accepts a sync response', () => {
    const r = SyncResponse.safeParse({
      results: [{ opId: push.ops[0]!.opId, status: 'applied', serverRev: 8 }],
      changes: [
        { seq: 48214, entityType: 'note', entityKey: NOTE_ID, op: 'upsert', rev: 8, data: {} },
      ],
      conflicts: [],
      cursor: 48214,
      hasMore: false,
      serverTime: '2026-11-04T10:02:13Z',
    });
    expect(r.success).toBe(true);
  });
});
