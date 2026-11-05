// Minimal data factories for database tests (TDD Section E, Seed data
// strategy: tests build small graphs per test, never the demo seed).
// They write through the owner connection, which bypasses RLS.
import { v7 as uuidv7 } from 'uuid';
import type { Db } from '../../src/db/client';
import * as s from '../../src/db/schema';

let counter = 0;
const unique = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++counter}`;

export async function makeUser(db: Db, overrides: Partial<typeof s.users.$inferInsert> = {}) {
  const [row] = await db
    .insert(s.users)
    .values({
      email: `${unique('user')}@test.example`,
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=1$fake$fake',
      ...overrides,
    })
    .returning();
  return row!;
}

export async function makeDevice(db: Db, userId: string) {
  const [row] = await db
    .insert(s.devices)
    .values({ id: uuidv7(), userId, name: 'Test phone', platform: 'android', appVersion: '1.0.0' })
    .returning();
  return row!;
}

export async function makeCollection(db: Db, userId: string, name = 'Inbox') {
  const [row] = await db.insert(s.collections).values({ id: uuidv7(), userId, name }).returning();
  return row!;
}

export async function makeNote(
  db: Db,
  userId: string,
  overrides: Partial<typeof s.notes.$inferInsert> = {},
) {
  const [row] = await db
    .insert(s.notes)
    .values({ id: uuidv7(), userId, title: unique('Note'), ...overrides })
    .returning();
  return row!;
}

export async function makeTag(db: Db, userId: string, name = unique('tag')) {
  const [row] = await db.insert(s.tags).values({ id: uuidv7(), userId, name }).returning();
  return row!;
}
