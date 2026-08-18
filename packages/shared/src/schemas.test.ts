import { describe, expect, it } from 'vitest';
import {
  adjudicateClaimSchema,
  claimQuerySchema,
  createClaimSchema,
  faultRequestSchema,
  updateClaimSchema,
} from './schemas.js';
import { canAdjudicate, canTransition } from './workflow.js';
import { formatClaimId, isClaimStatus, isClaimType } from './types.js';

const validCreate = {
  policyNumber: 'POL-100234',
  claimantName: 'Dana Whitfield',
  claimType: 'auto',
  incidentDate: '2026-01-05',
  amountRequested: 4200.5,
  description: 'Rear-ended at a stop light on Elm Street; bumper and tailgate damaged.',
};

describe('createClaimSchema', () => {
  it('accepts a valid payload and defaults the currency to USD', () => {
    const parsed = createClaimSchema.parse(validCreate);

    expect(parsed.currency).toBe('USD');
    expect(parsed.incidentDate).toBe(new Date('2026-01-05').toISOString());
  });

  it('normalises the currency to upper case', () => {
    const parsed = createClaimSchema.parse({ ...validCreate, currency: 'eur' });
    expect(parsed.currency).toBe('EUR');
  });

  it.each([
    ['policyNumber', { policyNumber: '12345' }],
    ['claimantName', { claimantName: 'D' }],
    ['claimType', { claimType: 'marine' }],
    ['incidentDate', { incidentDate: 'yesterday' }],
    ['amountRequested', { amountRequested: -10 }],
    ['amountRequested', { amountRequested: 20_000_000 }],
    ['description', { description: 'short' }],
  ])('rejects an invalid %s', (_field, override) => {
    const result = createClaimSchema.safeParse({ ...validCreate, ...override });
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields', () => {
    const result = createClaimSchema.safeParse({ ...validCreate, riskScore: 100 });
    expect(result.success).toBe(false);
  });
});

describe('updateClaimSchema', () => {
  it('accepts a partial payload', () => {
    const parsed = updateClaimSchema.parse({ status: 'under_review' });
    expect(parsed.status).toBe('under_review');
  });

  it('rejects an empty payload', () => {
    expect(updateClaimSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(updateClaimSchema.safeParse({ status: 'archived' }).success).toBe(false);
  });
});

describe('adjudicateClaimSchema', () => {
  it('accepts an approval with an approved amount', () => {
    const parsed = adjudicateClaimSchema.parse({
      decision: 'approved',
      decidedBy: 'A. Adjuster',
      rationale: 'Damage consistent with police report.',
      approvedAmount: 3800,
    });

    expect(parsed.approvedAmount).toBe(3800);
  });

  it('requires an approved amount when approving', () => {
    const result = adjudicateClaimSchema.safeParse({
      decision: 'approved',
      decidedBy: 'A. Adjuster',
      rationale: 'Looks fine to me.',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['approvedAmount']);
    }
  });

  it('allows a rejection without an approved amount', () => {
    const result = adjudicateClaimSchema.safeParse({
      decision: 'rejected',
      decidedBy: 'A. Adjuster',
      rationale: 'Policy lapsed before the incident date.',
    });

    expect(result.success).toBe(true);
  });
});

describe('claimQuerySchema', () => {
  it('accepts supported filters and drops unknown query params', () => {
    const parsed = claimQuerySchema.parse({
      status: 'approved',
      claimType: 'health',
      page: '2',
    });

    expect(parsed).toEqual({ status: 'approved', claimType: 'health' });
  });

  it('rejects an unsupported status filter', () => {
    expect(claimQuerySchema.safeParse({ status: 'nope' }).success).toBe(false);
  });
});

describe('faultRequestSchema', () => {
  it('accepts every supported mode', () => {
    for (const mode of ['none', 'latency', 'error', 'memory'] as const) {
      expect(faultRequestSchema.safeParse({ mode }).success).toBe(true);
    }
  });

  it('rejects a non-positive duration', () => {
    expect(faultRequestSchema.safeParse({ mode: 'error', durationSeconds: 0 }).success).toBe(
      false,
    );
  });
});

describe('workflow', () => {
  it('permits legal transitions only', () => {
    expect(canTransition('submitted', 'under_review')).toBe(true);
    expect(canTransition('approved', 'paid')).toBe(true);
    expect(canTransition('paid', 'approved')).toBe(false);
    expect(canTransition('rejected', 'under_review')).toBe(false);
  });

  it('blocks adjudication of terminal claims', () => {
    expect(canAdjudicate('submitted')).toBe(true);
    expect(canAdjudicate('under_review')).toBe(true);
    expect(canAdjudicate('pending_second_approval')).toBe(true);
    expect(canAdjudicate('approved')).toBe(false);
    expect(canAdjudicate('paid')).toBe(false);
    expect(canAdjudicate('rejected')).toBe(false);
  });
});

describe('type guards and helpers', () => {
  it('recognises valid domain values', () => {
    expect(isClaimType('auto')).toBe(true);
    expect(isClaimType('marine')).toBe(false);
    expect(isClaimStatus('paid')).toBe(true);
    expect(isClaimStatus('archived')).toBe(false);
  });

  it('formats claim ids with the CLM- prefix', () => {
    expect(formatClaimId(42)).toBe('CLM-000042');
  });
});
