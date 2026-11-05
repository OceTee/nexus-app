import { sql } from 'drizzle-orm';
import type { Db } from './client';

export interface ReadinessReport {
  database: boolean;
  migrations: boolean;
}

/**
 * Checks that the database answers and that every committed migration has
 * been applied. Used by `GET /readyz` (TDD Section F, System routes).
 */
export async function checkReadiness(db: Db, expectedMigrations: number): Promise<ReadinessReport> {
  try {
    const result = await db.execute<{ applied: number }>(
      sql`SELECT count(*)::int AS applied FROM drizzle.__drizzle_migrations`,
    );
    const applied = result.rows[0]?.applied ?? 0;
    return { database: true, migrations: applied >= expectedMigrations };
  } catch {
    return { database: false, migrations: false };
  }
}
