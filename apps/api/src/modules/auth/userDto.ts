import { UserSettings, type UserDto } from '@nexus/shared';
import type { users } from '../../db/schema';

type UserRow = typeof users.$inferSelect;

/** Maps a users row to the wire shape; settings get their defaults. */
export function toUserDto(row: UserRow): UserDto {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    emailVerified: row.emailVerifiedAt !== null,
    settings: UserSettings.parse(row.settings ?? {}),
    deletionRequestedAt: row.deletionRequestedAt
      ? new Date(row.deletionRequestedAt).toISOString()
      : null,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}
