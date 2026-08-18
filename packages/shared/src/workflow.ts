import type { ClaimStatus } from './types.js';

/**
 * Claim lifecycle state machine.
 *
 * ```text
 * submitted ──▶ under_review ──▶ approved ──▶ paid
 *      │              │              │
 *      └──────────────┴──────────────┴──▶ rejected
 * ```
 */
export const STATUS_TRANSITIONS: Readonly<Record<ClaimStatus, readonly ClaimStatus[]>> =
  Object.freeze({
    submitted: ['under_review', 'approved', 'rejected'],
    under_review: ['approved', 'rejected'],
    approved: ['paid', 'rejected'],
    rejected: [],
    paid: [],
  });

/** States from which a claim can no longer be adjudicated. */
export const TERMINAL_ADJUDICATION_STATUSES: readonly ClaimStatus[] = Object.freeze([
  'rejected',
  'paid',
]);

/** Statuses considered "open" work for dashboard purposes. */
export const OPEN_STATUSES: readonly ClaimStatus[] = Object.freeze([
  'submitted',
  'under_review',
]);

/** Returns true when `to` is a legal next state for `from`. */
export function canTransition(from: ClaimStatus, to: ClaimStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

/**
 * A claim can only be adjudicated while it has not reached a terminal outcome.
 * Attempting to adjudicate a `paid` or `rejected` claim is a conflict.
 */
export function canAdjudicate(status: ClaimStatus): boolean {
  return !TERMINAL_ADJUDICATION_STATUSES.includes(status);
}
