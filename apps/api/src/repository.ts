import {
  CLAIM_STATUSES,
  CLAIM_TYPES,
  OPEN_STATUSES,
  RISK_BANDS,
  calculateRiskScore,
  formatClaimId,
  type AdjudicateClaimInput,
  type Claim,
  type ClaimFilter,
  type ClaimStats,
  type ClaimStatus,
  type ClaimType,
  type CreateClaimInput,
  type UpdateClaimInput,
} from '@contoso/shared';
import { createSeedClaims } from './seed.js';

/**
 * In-memory claim store.
 *
 * The accelerator deliberately avoids a database dependency: swapping this
 * class for a Cosmos DB or PostgreSQL implementation is the exercise left to
 * the customer engagement.
 */
export class ClaimsRepository {
  #claims = new Map<string, Claim>();
  #sequence = 0;

  constructor(initial: Claim[] = createSeedClaims()) {
    this.reset(initial);
  }

  /** Replaces the contents of the store (used by tests and by the seeder). */
  reset(initial: Claim[] = createSeedClaims()): void {
    this.#claims = new Map(initial.map((claim) => [claim.id, cloneClaim(claim)]));
    this.#sequence = initial.reduce((max, claim) => {
      const numeric = Number.parseInt(claim.id.replace(/\D/g, ''), 10);
      return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
    }, 0);
  }

  /** Lists claims, newest first, optionally filtered by status and/or type. */
  list(filter: ClaimFilter = {}): Claim[] {
    return [...this.#claims.values()]
      .filter((claim) => (filter.status ? claim.status === filter.status : true))
      .filter((claim) => (filter.claimType ? claim.claimType === filter.claimType : true))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map(cloneClaim);
  }

  get(id: string): Claim | undefined {
    const claim = this.#claims.get(id);
    return claim ? cloneClaim(claim) : undefined;
  }

  create(input: CreateClaimInput, now: Date = new Date()): Claim {
    const timestamp = now.toISOString();
    this.#sequence += 1;

    const claim: Claim = {
      id: formatClaimId(this.#sequence),
      policyNumber: input.policyNumber,
      claimantName: input.claimantName,
      claimType: input.claimType,
      incidentDate: input.incidentDate,
      amountRequested: input.amountRequested,
      currency: input.currency,
      description: input.description,
      status: 'submitted',
      riskScore: calculateRiskScore({
        claimType: input.claimType,
        amountRequested: input.amountRequested,
        incidentDate: input.incidentDate,
        reportedAt: timestamp,
      }),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.#claims.set(claim.id, claim);
    return cloneClaim(claim);
  }

  /**
   * Applies a partial update. The risk score is recomputed whenever one of its
   * inputs changes so the score can never drift from the claim data.
   */
  update(id: string, patch: UpdateClaimInput, now: Date = new Date()): Claim | undefined {
    const existing = this.#claims.get(id);
    if (!existing) return undefined;

    const updated: Claim = {
      ...existing,
      ...patch,
      updatedAt: now.toISOString(),
    };

    const riskInputsChanged =
      patch.claimType !== undefined ||
      patch.amountRequested !== undefined ||
      patch.incidentDate !== undefined;

    if (riskInputsChanged) {
      updated.riskScore = calculateRiskScore({
        claimType: updated.claimType,
        amountRequested: updated.amountRequested,
        incidentDate: updated.incidentDate,
        reportedAt: existing.createdAt,
      });
    }

    this.#claims.set(id, updated);
    return cloneClaim(updated);
  }

  /** Records an adjudication decision and moves the claim to its new status. */
  adjudicate(
    id: string,
    input: AdjudicateClaimInput,
    status: ClaimStatus = input.decision,
    now: Date = new Date(),
  ): Claim | undefined {
    const existing = this.#claims.get(id);
    if (!existing) return undefined;

    const timestamp = now.toISOString();
    const approvedAmount =
      input.decision === 'approved' ? (input.approvedAmount ?? existing.amountRequested) : 0;

    const updated: Claim = {
      ...existing,
      status,
      updatedAt: timestamp,
      adjudication: {
        status,
        decidedBy: input.decidedBy,
        decidedAt: timestamp,
        rationale: input.rationale,
        approvedAmount,
      },
      adjudications: [
        ...(existing.adjudications ?? (existing.adjudication ? [existing.adjudication] : [])),
        {
          status,
          decidedBy: input.decidedBy,
          decidedAt: timestamp,
          rationale: input.rationale,
          approvedAmount,
        },
      ],
    };

    this.#claims.set(id, updated);
    return cloneClaim(updated);
  }

  /** Portfolio aggregates used by the dashboard stat cards. */
  stats(): ClaimStats {
    const claims = [...this.#claims.values()];

    const byStatus = Object.fromEntries(
      CLAIM_STATUSES.map((status) => [status, 0]),
    ) as Record<ClaimStatus, number>;
    const byType = Object.fromEntries(CLAIM_TYPES.map((type) => [type, 0])) as Record<
      ClaimType,
      number
    >;

    let totalAmountRequested = 0;
    let totalAmountApproved = 0;
    let riskTotal = 0;
    let highRiskCount = 0;
    let openClaims = 0;

    for (const claim of claims) {
      byStatus[claim.status] += 1;
      byType[claim.claimType] += 1;
      totalAmountRequested += claim.amountRequested;
      totalAmountApproved += claim.adjudication?.approvedAmount ?? 0;
      riskTotal += claim.riskScore;
      if (claim.riskScore > RISK_BANDS.mediumMax) highRiskCount += 1;
      if (OPEN_STATUSES.includes(claim.status)) openClaims += 1;
    }

    return {
      totalClaims: claims.length,
      byStatus,
      byType,
      totalAmountRequested: round2(totalAmountRequested),
      totalAmountApproved: round2(totalAmountApproved),
      averageRiskScore: claims.length === 0 ? 0 : Math.round(riskTotal / claims.length),
      highRiskCount,
      openClaims,
    };
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Process-wide repository used by the running server. */
export const claimsRepository = new ClaimsRepository();

function cloneClaim(claim: Claim): Claim {
  return {
    ...claim,
    adjudication: claim.adjudication ? { ...claim.adjudication } : undefined,
    adjudications: claim.adjudications?.map((decision) => ({ ...decision })),
  };
}
