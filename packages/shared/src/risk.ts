import type { Claim, ClaimType } from './types.js';

/**
 * Deterministic claim risk scoring.
 *
 * The score is a 0-100 heuristic combining three independent, explainable
 * signals. It is intentionally pure (no I/O, no randomness, no hidden clock)
 * so that the same claim always yields the same score - a hard requirement for
 * auditability and for reproducible tests.
 *
 * | Signal              | Max points | Rationale                                                        |
 * | ------------------- | ---------- | ---------------------------------------------------------------- |
 * | Requested amount    | 50         | Severity relative to the typical loss for that product line.      |
 * | Claim type          | 25         | Liability/property lines carry more downstream exposure.          |
 * | Reporting delay     | 25         | Late-reported incidents correlate strongly with loss adjustment   |
 * |                     |            | disputes and fraud referrals.                                     |
 */

/** Weight ceilings for each scoring signal. Always sums to 100. */
export const RISK_WEIGHTS = Object.freeze({
  amount: 50,
  claimType: 25,
  reportingDelay: 25,
});

/**
 * Typical (median) claim value per product line, used to normalise the
 * requested amount. A claim at the typical value scores half of the amount
 * weight; a claim at twice the typical value saturates it.
 */
export const TYPICAL_CLAIM_AMOUNT: Readonly<Record<ClaimType, number>> = Object.freeze({
  auto: 6_000,
  property: 15_000,
  health: 4_000,
  liability: 25_000,
});

/** Inherent exposure of each product line, expressed in risk points. */
export const CLAIM_TYPE_RISK: Readonly<Record<ClaimType, number>> = Object.freeze({
  auto: 12,
  health: 10,
  property: 15,
  liability: 25,
});

/** Risk bands used consistently by the API and the dashboard. */
export const RISK_BANDS = Object.freeze({
  lowMax: 33,
  mediumMax: 66,
});

export type RiskBand = 'low' | 'medium' | 'high';

/** Minimal claim shape required to compute a score. */
export interface RiskScoreInput {
  claimType: ClaimType;
  amountRequested: number;
  /** ISO-8601 timestamp of the incident. */
  incidentDate: string;
  /**
   * ISO-8601 timestamp the claim was reported. Defaults to "now" at call time
   * when omitted; pass it explicitly for deterministic results.
   */
  reportedAt?: string;
}

export interface RiskScoreBreakdown {
  amountPoints: number;
  claimTypePoints: number;
  reportingDelayPoints: number;
  /** Whole number between 0 and 100. */
  total: number;
  band: RiskBand;
  /** Whole days between the incident and the report. Negative values are anomalies. */
  reportingDelayDays: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Points contributed by the requested amount, normalised against the typical
 * loss for the product line. Saturates at 2x the typical amount.
 */
function scoreAmount(claimType: ClaimType, amountRequested: number): number {
  const typical = TYPICAL_CLAIM_AMOUNT[claimType];
  const ratio = Math.max(0, amountRequested) / typical;
  return clamp(Math.round((ratio / 2) * RISK_WEIGHTS.amount), 0, RISK_WEIGHTS.amount);
}

/**
 * Points contributed by how late the incident was reported. Incidents dated in
 * the future are a data-integrity anomaly and score the maximum.
 */
function scoreReportingDelay(delayDays: number): number {
  if (delayDays < 0) return RISK_WEIGHTS.reportingDelay;
  if (delayDays <= 2) return 2;
  if (delayDays <= 7) return 6;
  if (delayDays <= 14) return 12;
  if (delayDays <= 30) return 18;
  return RISK_WEIGHTS.reportingDelay;
}

/** Maps a numeric score onto the shared low/medium/high band. */
export function riskBand(score: number): RiskBand {
  if (score <= RISK_BANDS.lowMax) return 'low';
  if (score <= RISK_BANDS.mediumMax) return 'medium';
  return 'high';
}

/** Whole days between the incident and the moment it was reported. */
export function reportingDelayDays(incidentDate: string, reportedAt: string): number {
  const incident = Date.parse(incidentDate);
  const reported = Date.parse(reportedAt);
  if (Number.isNaN(incident) || Number.isNaN(reported)) return 0;
  return Math.floor((reported - incident) / MS_PER_DAY);
}

/** Full, explainable breakdown of a claim's risk score. */
export function calculateRiskBreakdown(input: RiskScoreInput): RiskScoreBreakdown {
  const reportedAt = input.reportedAt ?? new Date().toISOString();
  const delayDays = reportingDelayDays(input.incidentDate, reportedAt);

  const amountPoints = scoreAmount(input.claimType, input.amountRequested);
  const claimTypePoints = CLAIM_TYPE_RISK[input.claimType];
  const reportingDelayPoints = scoreReportingDelay(delayDays);
  const total = clamp(
    Math.round(amountPoints + claimTypePoints + reportingDelayPoints),
    0,
    100,
  );

  return {
    amountPoints,
    claimTypePoints,
    reportingDelayPoints,
    total,
    band: riskBand(total),
    reportingDelayDays: delayDays,
  };
}

/**
 * Deterministic 0-100 risk score for a claim.
 *
 * @example
 * ```ts
 * calculateRiskScore({
 *   claimType: 'auto',
 *   amountRequested: 6_000,
 *   incidentDate: '2026-01-01T00:00:00.000Z',
 *   reportedAt: '2026-01-02T00:00:00.000Z',
 * }); // => 39
 * ```
 */
export function calculateRiskScore(
  input: RiskScoreInput | Pick<Claim, 'claimType' | 'amountRequested' | 'incidentDate'>,
): number {
  return calculateRiskBreakdown(input as RiskScoreInput).total;
}
