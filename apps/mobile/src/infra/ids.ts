import { getRandomValues } from 'expo-crypto';

type Random = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;

const defaultRandom: Random = (bytes) => {
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else getRandomValues(bytes);
  return bytes;
};

/**
 * RFC 9562 UUIDv7: 48-bit Unix milliseconds, version 7, 74 random bits.
 * Ids are generated on the device so offline creation needs no server.
 */
export function uuidv7(now: number = Date.now(), random: Random = defaultRandom): string {
  const b = random(new Uint8Array(16));
  const ms = BigInt(now);
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
