/**
 * Core domain model for the Contoso Claims platform.
 *
 * The model is intentionally transport agnostic: the API, the web client and any
 * future automation (agents, batch jobs) all speak the same vocabulary.
 */

/** All claim product lines supported by the platform. */
export const CLAIM_TYPES = ['auto', 'property', 'health', 'liability'] as const;

/** All lifecycle states a claim can be in. */
export const CLAIM_STATUSES = [
  'submitted',
  'under_review',
  'pending_second_approval',
  'approved',
  'rejected',
  'paid',
] as const;

export type ClaimType = (typeof CLAIM_TYPES)[number];
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** Prefix used for every human readable claim identifier, e.g. `CLM-000123`. */
export const CLAIM_ID_PREFIX = 'CLM-';

/** Outcome recorded when a human (or agent) adjudicates a claim. */
export interface Adjudication {
  /** Display name or principal id of the adjudicator. */
  decidedBy: string;
  /** ISO-8601 timestamp of the decision. */
  decidedAt: string;
  /** Free-text justification kept for audit purposes. */
  rationale: string;
  /** Amount approved for payout, in the claim currency. `0` for rejections. */
  approvedAmount: number;
}

/** A single insurance claim. */
export interface Claim {
  /** Unique identifier, always prefixed with {@link CLAIM_ID_PREFIX}. */
  id: string;
  policyNumber: string;
  claimantName: string;
  claimType: ClaimType;
  /** ISO-8601 timestamp of when the incident occurred. */
  incidentDate: string;
  amountRequested: number;
  /** ISO-4217 currency code. Defaults to `USD`. */
  currency: string;
  description: string;
  status: ClaimStatus;
  /** Deterministic fraud/complexity heuristic between 0 and 100. */
  riskScore: number;
  createdAt: string;
  updatedAt: string;
  adjudication?: Adjudication;
  /** Append-only record of every adjudication decision. */
  adjudications?: readonly Adjudication[];
}

/** Filters accepted by the claim list endpoint. */
export interface ClaimFilter {
  status?: ClaimStatus;
  claimType?: ClaimType;
}

/** Aggregate portfolio metrics surfaced on the dashboard. */
export interface ClaimStats {
  totalClaims: number;
  byStatus: Record<ClaimStatus, number>;
  byType: Record<ClaimType, number>;
  totalAmountRequested: number;
  totalAmountApproved: number;
  averageRiskScore: number;
  highRiskCount: number;
  openClaims: number;
}

/** Runtime type guard for {@link ClaimType}. */
export function isClaimType(value: unknown): value is ClaimType {
  return typeof value === 'string' && (CLAIM_TYPES as readonly string[]).includes(value);
}

/** Runtime type guard for {@link ClaimStatus}. */
export function isClaimStatus(value: unknown): value is ClaimStatus {
  return typeof value === 'string' && (CLAIM_STATUSES as readonly string[]).includes(value);
}

/** Formats a numeric sequence value into a canonical claim id (`CLM-000042`). */
export function formatClaimId(sequence: number): string {
  return `${CLAIM_ID_PREFIX}${String(sequence).padStart(6, '0')}`;
}
