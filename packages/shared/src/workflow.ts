import type { ClaimStatus } from './types.js';

/**
 * Claim lifecycle state machine.
 *
 * ```text
 * submitted ──▶ under_review ──▶ pending_second_approval ──▶ approved ──▶ paid
 *      │              │                       │                    │
 *      └──────────────┴───────────────────────┴────────────────────┴──▶ rejected
 * ```
 */
export const STATUS_TRANSITIONS: Readonly<Record<ClaimStatus, readonly ClaimStatus[]>> =
  Object.freeze({
    submitted: ['under_review', 'approved', 'rejected', 'pending_second_approval'],
    under_review: ['approved', 'rejected', 'pending_second_approval'],
    pending_second_approval: ['approved', 'rejected'],
    approved: ['paid'],
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
  'pending_second_approval',
]);

/** Returns true when `to` is a legal next state for `from`. */
export function canTransition(from: ClaimStatus, to: ClaimStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

/**
 * A claim can only be adjudicated while it is awaiting a decision.
 */
export function canAdjudicate(status: ClaimStatus): boolean {
  return OPEN_STATUSES.includes(status);
}
