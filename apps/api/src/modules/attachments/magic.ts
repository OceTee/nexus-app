import type { AttachmentMimeType } from '@nexus/shared';

/** Bytes fetched for type sniffing. */
export const SNIFF_BYTES = 32;

const startsWith = (bytes: Uint8Array, sig: number[], offset = 0) =>
  sig.every((b, i) => bytes[offset + i] === b);

/**
 * Checks magic numbers against the declared type (TDD Section F, File uploads):
 * JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF....WEBP`, PDF `%PDF`.
 */
export function matchesDeclaredType(bytes: Uint8Array, mimeType: AttachmentMimeType): boolean {
  switch (mimeType) {
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/webp':
      return (
        startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
      );
    case 'application/pdf':
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46]);
  }
}
