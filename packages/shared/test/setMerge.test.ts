import { describe, expect, it } from 'vitest';
import {
  applyMembershipOp,
  applyMembershipOps,
  diffSets,
  isLive,
  type Membership,
} from '../src/merge/setMerge';

const T1 = '2026-11-04T10:00:00Z';
const T2 = '2026-11-04T10:05:00Z';
const T3 = '2026-11-04T10:10:00Z';

describe('applyMembershipOp: add', () => {
  it('creates a membership when none exists', () => {
    expect(applyMembershipOp(null, { kind: 'add', createdAt: T1 })).toEqual({
      changed: true,
      next: { createdAt: T1, deletedAt: null },
    });
  });

  it('T-05: applying note_tag.add twice yields one membership and no error', () => {
    const once = applyMembershipOps(null, [{ kind: 'add', createdAt: T1 }]);
    const twice = applyMembershipOps(null, [
      { kind: 'add', createdAt: T1 },
      { kind: 'add', createdAt: T1 },
    ]);
    expect(twice).toEqual(once);
    expect(applyMembershipOp(once, { kind: 'add', createdAt: T2 })).toMatchObject({
      changed: false,
      reason: 'already_live',
    });
  });

  it('re-adds a removed membership when the add is newer than the removal', () => {
    const removed: Membership = { createdAt: T1, deletedAt: T2 };
    expect(applyMembershipOp(removed, { kind: 'add', createdAt: T3 })).toEqual({
      changed: true,
      next: { createdAt: T3, deletedAt: null },
    });
  });

  it('ignores an add older than the removal', () => {
    const removed: Membership = { createdAt: T1, deletedAt: T3 };
    expect(applyMembershipOp(removed, { kind: 'add', createdAt: T2 })).toMatchObject({
      changed: false,
      reason: 'stale',
      next: removed,
    });
  });
});

describe('applyMembershipOp: remove', () => {
  it('tombstones a live membership created before the op', () => {
    expect(
      applyMembershipOp({ createdAt: T1, deletedAt: null }, { kind: 'remove', createdAt: T2 }),
    ).toEqual({ changed: true, next: { createdAt: T1, deletedAt: T2 } });
  });

  it('T-06: ignores a stale remove for a membership created later', () => {
    const live: Membership = { createdAt: T2, deletedAt: null };
    const outcome = applyMembershipOp(live, { kind: 'remove', createdAt: T1 });
    expect(outcome).toMatchObject({ changed: false, reason: 'stale', next: live });
    expect(isLive(outcome.next)).toBe(true);
  });

  it('is a no-op for missing or already removed memberships', () => {
    expect(applyMembershipOp(null, { kind: 'remove', createdAt: T1 })).toEqual({
      changed: false,
      next: null,
      reason: 'already_removed',
    });
    const removed: Membership = { createdAt: T1, deletedAt: T2 };
    expect(applyMembershipOp(removed, { kind: 'remove', createdAt: T3 })).toMatchObject({
      changed: false,
      reason: 'already_removed',
    });
  });

  it('rejects invalid timestamps', () => {
    expect(() => applyMembershipOp(null, { kind: 'add', createdAt: 'yesterday' })).toThrow(
      RangeError,
    );
  });
});

describe('convergence', () => {
  it('two devices reach the same state regardless of arrival order', () => {
    const ops = [
      { kind: 'add', createdAt: T1 },
      { kind: 'remove', createdAt: T2 },
      { kind: 'add', createdAt: T3 },
    ] as const;
    const forward = applyMembershipOps(null, ops);
    const reversed = applyMembershipOps(null, [...ops].reverse());
    expect(isLive(forward)).toBe(true);
    expect(isLive(reversed)).toBe(true);
  });
});

describe('isLive and diffSets', () => {
  it('isLive reports live memberships only', () => {
    expect(isLive(null)).toBe(false);
    expect(isLive({ createdAt: T1, deletedAt: T2 })).toBe(false);
    expect(isLive({ createdAt: T1, deletedAt: null })).toBe(true);
  });

  it('diffSets returns added and removed ids', () => {
    expect(diffSets(['a', 'b', 'c'], ['b', 'c', 'd'])).toEqual({ added: ['d'], removed: ['a'] });
    expect(diffSets([], [])).toEqual({ added: [], removed: [] });
  });
});
