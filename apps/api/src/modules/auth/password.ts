import argon2 from 'argon2';

/**
 * Argon2id policy from TDD Section H: 64 MiB memory, 3 iterations,
 * parallelism 1, 16-byte salt, 32-byte hash. Parameters live in the PHC
 * string, so they can be raised later and old hashes upgraded on login.
 */
export const ARGON2_POLICY = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
} as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_POLICY);
}

/** Constant-time verification; returns false for malformed hashes instead of throwing. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** True when the stored hash uses weaker parameters than the current policy. */
export function needsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, ARGON2_POLICY);
}
