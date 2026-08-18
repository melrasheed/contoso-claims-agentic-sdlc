import { beforeEach, describe, expect, it } from 'vitest';
import { CLAIM_STATUSES, CLAIM_TYPES } from '@contoso/shared';
import { ClaimsRepository } from './repository.js';
import { SEED_CLAIM_COUNT, createSeedClaims } from './seed.js';

let repository: ClaimsRepository;

beforeEach(() => {
  repository = new ClaimsRepository();
});

describe('seed data', () => {
  it('covers every status and every claim type', () => {
    const claims = createSeedClaims();

    expect(claims).toHaveLength(SEED_CLAIM_COUNT);
    for (const status of CLAIM_STATUSES) {
      expect(claims.some((claim) => claim.status === status)).toBe(true);
    }
    for (const type of CLAIM_TYPES) {
      expect(claims.some((claim) => claim.claimType === type)).toBe(true);
    }
  });

  it('gives every claim a CLM- id and a scored risk', () => {
    for (const claim of createSeedClaims()) {
      expect(claim.id).toMatch(/^CLM-\d{6}$/);
      expect(claim.riskScore).toBeGreaterThanOrEqual(0);
      expect(claim.riskScore).toBeLessThanOrEqual(100);
    }
  });

  it('records an adjudication for every decided claim', () => {
    for (const claim of createSeedClaims()) {
      if (['approved', 'rejected', 'paid'].includes(claim.status)) {
        expect(claim.adjudication).toBeDefined();
      }
    }
  });
});

describe('ClaimsRepository', () => {
  it('assigns sequential ids that continue after the seed data', () => {
    const created = repository.create({
      policyNumber: 'POL-424242',
      claimantName: 'Sequence Test',
      claimType: 'property',
      incidentDate: new Date().toISOString(),
      amountRequested: 1000,
      currency: 'USD',
      description: 'A description long enough to satisfy the schema minimum.',
    });

    expect(created.id).toBe('CLM-000013');
    expect(repository.get(created.id)).toEqual(created);
  });

  it('returns copies so callers cannot mutate the store', () => {
    const claim = repository.list()[0];
    if (!claim) throw new Error('expected seeded claims');

    claim.status = 'paid';
    expect(repository.get(claim.id)?.status).not.toBe('paid');
  });

  it('reports zeroed stats for an empty store', () => {
    const empty = new ClaimsRepository([]);
    const stats = empty.stats();

    expect(stats.totalClaims).toBe(0);
    expect(stats.averageRiskScore).toBe(0);
    expect(stats.byStatus.paid).toBe(0);
  });

  it('sums approved amounts across adjudicated claims', () => {
    const stats = repository.stats();
    expect(stats.totalAmountApproved).toBeGreaterThan(0);
    expect(stats.totalAmountApproved).toBeLessThanOrEqual(stats.totalAmountRequested);
  });

  it('returns undefined when updating or adjudicating an unknown claim', () => {
    expect(repository.update('CLM-999999', { status: 'paid' })).toBeUndefined();
    expect(
      repository.adjudicate('CLM-999999', {
        decision: 'rejected',
        decidedBy: 'Nobody',
        rationale: 'Claim does not exist.',
      }),
    ).toBeUndefined();
  });
});
