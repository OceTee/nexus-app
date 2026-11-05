// Product limits from TDD Section A (NFR-11) and the data model (Section E).
// The API enforces them and the app uses them for validation messages.

export const LIMITS = {
  noteTitleMax: 200,
  noteBodyMax: 200_000,
  tagsPerNoteMax: 50,
  tagNameMax: 40,
  collectionNameMax: 80,
  collectionDepthMax: 6,
  displayNameMax: 80,
  deviceNameMax: 60,
  filenameMax: 255,
  attachmentBytesMax: 26_214_400, // 25 MB
  attachmentQuotaBytes: 1_073_741_824, // 1 GB demo tier
  syncOpsPerBatch: 100,
  snapshotPageMax: 500,
  pageDefault: 50,
  pageMax: 200,
  versionsPageMax: 100,
  graphNodesMax: 500,
  searchQueryMax: 200,
  passwordMin: 8,
  passwordMax: 128,
  emailMax: 254,
  trashRetentionDays: 30,
  deletionGraceDays: 30,
} as const;

/** Attachment types accepted by the API (HEIC is converted to JPEG on the device). */
export const ATTACHMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;
