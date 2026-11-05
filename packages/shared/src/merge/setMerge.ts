// Set-merge rules for memberships (note ↔ tag), shared by the server's
// `tags.service.applyMembershipOp` and the client's local apply step, so both
// sides converge without conflicts (TDD BR-10, T-05, T-06).
//
// A membership is a row with `createdAt` and an optional `deletedAt` tombstone.
// Ops carry the client time they were created. The rules:
//   add    — idempotent. Creates the row; re-adding a live row changes nothing.
//            Re-adds a tombstoned row only if the add happened after the removal.
//   remove — tombstones a live row, unless the row was (re)created after the op
//            was made (a stale remove is ignored).

/** Server or local state of one membership; `null` when no row exists. */
export interface Membership {
  /** When the membership became live (ISO 8601). */
  readonly createdAt: string;
  /** When it was removed (ISO 8601), or null while live. */
  readonly deletedAt: string | null;
}

export type MembershipOpKind = 'add' | 'remove';

export interface MembershipOp {
  readonly kind: MembershipOpKind;
  /** When the client made the change (ISO 8601). */
  readonly createdAt: string;
}

export type MergeOutcome =
  /** The state changed; persist `next`. */
  | { readonly changed: true; readonly next: Membership }
  /** Nothing to do; the op is still acknowledged as applied. */
  | {
      readonly changed: false;
      readonly next: Membership | null;
      readonly reason: 'already_live' | 'already_removed' | 'stale';
    };

const time = (iso: string): number => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new RangeError(`Invalid timestamp: ${iso}`);
  return t;
};

/** True when the membership exists and has not been removed. */
export function isLive(m: Membership | null): m is Membership & { deletedAt: null } {
  return m !== null && m.deletedAt === null;
}

/** Applies one membership op to the current state and returns the outcome. */
export function applyMembershipOp(current: Membership | null, op: MembershipOp): MergeOutcome {
  const opTime = time(op.createdAt);

  if (op.kind === 'add') {
    if (current === null) {
      return { changed: true, next: { createdAt: op.createdAt, deletedAt: null } };
    }
    if (current.deletedAt === null) {
      return { changed: false, next: current, reason: 'already_live' };
    }
    if (opTime > time(current.deletedAt)) {
      return { changed: true, next: { createdAt: op.createdAt, deletedAt: null } };
    }
    return { changed: false, next: current, reason: 'stale' };
  }

  // remove
  if (current === null) return { changed: false, next: null, reason: 'already_removed' };
  if (current.deletedAt !== null) {
    return { changed: false, next: current, reason: 'already_removed' };
  }
  if (time(current.createdAt) > opTime) {
    return { changed: false, next: current, reason: 'stale' };
  }
  return { changed: true, next: { createdAt: current.createdAt, deletedAt: op.createdAt } };
}

/** Folds a sequence of ops over a starting state. Order-independent for ops with distinct times. */
export function applyMembershipOps(
  initial: Membership | null,
  ops: readonly MembershipOp[],
): Membership | null {
  return ops.reduce<Membership | null>((state, op) => applyMembershipOp(state, op).next, initial);
}

/**
 * Diffs two sets of ids (for example a note's old and new tag ids) into the
 * add and remove ops needed to go from `before` to `after`.
 */
export function diffSets<T>(before: Iterable<T>, after: Iterable<T>): { added: T[]; removed: T[] } {
  const a = new Set(before);
  const b = new Set(after);
  return {
    added: [...b].filter((x) => !a.has(x)),
    removed: [...a].filter((x) => !b.has(x)),
  };
}
