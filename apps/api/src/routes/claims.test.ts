import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { ClaimsRepository } from '../repository.js';
import { FaultController } from '../faults.js';
import { SEED_CLAIM_COUNT } from '../seed.js';

const silentLogger = createLogger('silent');

let repository: ClaimsRepository;
let app: Express;

const newClaim = {
  policyNumber: 'POL-999888',
  claimantName: 'Test Claimant',
  claimType: 'auto',
  incidentDate: '2026-02-01',
  amountRequested: 7500,
  description: 'Side impact collision in a supermarket car park; door and mirror replaced.',
};

beforeEach(() => {
  repository = new ClaimsRepository();
  app = createApp({
    config: loadConfig({ NODE_ENV: 'test' }),
    logger: silentLogger,
    repository,
    faultController: new FaultController(),
  });
});

describe('GET /api/claims', () => {
  it('returns the seeded portfolio newest first', async () => {
    const response = await request(app).get('/api/claims');

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(SEED_CLAIM_COUNT);
    expect(response.body.items).toHaveLength(SEED_CLAIM_COUNT);

    const timestamps = response.body.items.map((claim: { createdAt: string }) =>
      Date.parse(claim.createdAt),
    );
    expect([...timestamps].sort((a: number, b: number) => b - a)).toEqual(timestamps);
  });

  it('filters by status', async () => {
    const response = await request(app).get('/api/claims?status=paid');

    expect(response.status).toBe(200);
    expect(response.body.items.length).toBeGreaterThan(0);
    for (const claim of response.body.items) {
      expect(claim.status).toBe('paid');
    }
  });

  it('filters by claim type', async () => {
    const response = await request(app).get('/api/claims?claimType=health');

    expect(response.status).toBe(200);
    expect(response.body.items.length).toBeGreaterThan(0);
    for (const claim of response.body.items) {
      expect(claim.claimType).toBe('health');
    }
  });

  it('combines both filters', async () => {
    const response = await request(app).get('/api/claims?status=submitted&claimType=auto');

    expect(response.status).toBe(200);
    for (const claim of response.body.items) {
      expect(claim.status).toBe('submitted');
      expect(claim.claimType).toBe('auto');
    }
  });

  it('rejects an unsupported filter value', async () => {
    const response = await request(app).get('/api/claims?status=archived');

    expect(response.status).toBe(400);
    expect(response.body.title).toBe('Validation Failed');
    expect(response.body.errors?.[0]?.path).toBe('status');
  });
});

describe('GET /api/claims/:id', () => {
  it('returns a single claim', async () => {
    const response = await request(app).get('/api/claims/CLM-000001');

    expect(response.status).toBe(200);
    expect(response.body.id).toBe('CLM-000001');
    expect(response.body.riskScore).toBeGreaterThanOrEqual(0);
  });

  it('returns 404 for an unknown claim', async () => {
    const response = await request(app).get('/api/claims/CLM-999999');

    expect(response.status).toBe(404);
    expect(response.body.status).toBe(404);
  });
});

describe('POST /api/claims', () => {
  it('creates a claim, computes the risk score and returns 201', async () => {
    const response = await request(app).post('/api/claims').send(newClaim);

    expect(response.status).toBe(201);
    expect(response.body.id).toMatch(/^CLM-\d{6}$/);
    expect(response.body.status).toBe('submitted');
    expect(response.body.currency).toBe('USD');
    expect(response.body.riskScore).toBeGreaterThan(0);
    expect(response.body.riskScore).toBeLessThanOrEqual(100);
    expect(response.headers.location).toBe(`/api/claims/${response.body.id}`);

    const list = await request(app).get('/api/claims');
    expect(list.body.count).toBe(SEED_CLAIM_COUNT + 1);
  });

  it('rejects an invalid payload with problem details', async () => {
    const response = await request(app)
      .post('/api/claims')
      .send({ ...newClaim, amountRequested: -5, claimType: 'marine' });

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.errors.length).toBeGreaterThan(0);
  });
});

describe('PATCH /api/claims/:id', () => {
  it('updates a claim and recomputes the risk score when inputs change', async () => {
    const before = await request(app).get('/api/claims/CLM-000001');
    const response = await request(app)
      .patch('/api/claims/CLM-000001')
      .send({ amountRequested: 50_000 });

    expect(response.status).toBe(200);
    expect(response.body.amountRequested).toBe(50_000);
    expect(response.body.riskScore).toBeGreaterThan(before.body.riskScore);
  });

  it('advances the status through a legal transition', async () => {
    const response = await request(app)
      .patch('/api/claims/CLM-000001')
      .send({ status: 'under_review' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('under_review');
  });

  it('rejects an illegal status transition with 409', async () => {
    const paid = repository.list({ status: 'paid' })[0];
    const response = await request(app)
      .patch(`/api/claims/${paid?.id}`)
      .send({ status: 'under_review' });

    expect(response.status).toBe(409);
    expect(response.body.title).toBe('Conflict');
  });

  it('rejects an empty payload', async () => {
    const response = await request(app).patch('/api/claims/CLM-000001').send({});
    expect(response.status).toBe(400);
  });

  it('returns 404 for an unknown claim', async () => {
    const response = await request(app)
      .patch('/api/claims/CLM-999999')
      .send({ status: 'under_review' });

    expect(response.status).toBe(404);
  });
});

describe('POST /api/claims/:id/adjudicate', () => {
  const approval = {
    decision: 'approved',
    decidedBy: 'S. Okafor',
    rationale: 'Damage consistent with the police report and within policy limits.',
    approvedAmount: 4000,
  };

  it('approves an open claim', async () => {
    const response = await request(app)
      .post('/api/claims/CLM-000001/adjudicate')
      .send(approval);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('approved');
    expect(response.body.adjudication).toMatchObject({
      decidedBy: 'S. Okafor',
      approvedAmount: 4000,
    });
    expect(response.body.adjudication.decidedAt).toBeTruthy();
  });

  it('rejects an open claim without an approved amount', async () => {
    const response = await request(app).post('/api/claims/CLM-000002/adjudicate').send({
      decision: 'rejected',
      decidedBy: 'M. Duarte',
      rationale: 'Damage predates the policy inception date.',
    });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('rejected');
    expect(response.body.adjudication.approvedAmount).toBe(0);
  });

  it('returns 409 when the claim was already paid', async () => {
    const paid = repository.list({ status: 'paid' })[0];
    const response = await request(app)
      .post(`/api/claims/${paid?.id}/adjudicate`)
      .send(approval);

    expect(response.status).toBe(409);
    expect(response.body.detail).toContain('paid');
  });

  it('returns 409 when the claim was already rejected', async () => {
    const rejected = repository.list({ status: 'rejected' })[0];
    const response = await request(app)
      .post(`/api/claims/${rejected?.id}/adjudicate`)
      .send(approval);

    expect(response.status).toBe(409);
  });

  it('rejects an approval that exceeds the requested amount', async () => {
    const response = await request(app)
      .post('/api/claims/CLM-000001/adjudicate')
      .send({ ...approval, approvedAmount: 1_000_000 });

    expect(response.status).toBe(400);
  });

  it('requires an approved amount when approving', async () => {
    const response = await request(app).post('/api/claims/CLM-000001/adjudicate').send({
      decision: 'approved',
      decidedBy: 'S. Okafor',
      rationale: 'Looks reasonable.',
    });

    expect(response.status).toBe(400);
    expect(response.body.errors?.[0]?.path).toBe('approvedAmount');
  });

  it('returns 404 for an unknown claim', async () => {
    const response = await request(app)
      .post('/api/claims/CLM-999999/adjudicate')
      .send(approval);

    expect(response.status).toBe(404);
  });
});

describe('GET /api/stats', () => {
  it('aggregates the portfolio', async () => {
    const response = await request(app).get('/api/stats');

    expect(response.status).toBe(200);
    expect(response.body.totalClaims).toBe(SEED_CLAIM_COUNT);
    expect(Object.values(response.body.byStatus).reduce((a, b) => Number(a) + Number(b), 0)).toBe(
      SEED_CLAIM_COUNT,
    );
    expect(Object.values(response.body.byType).reduce((a, b) => Number(a) + Number(b), 0)).toBe(
      SEED_CLAIM_COUNT,
    );
    expect(response.body.totalAmountRequested).toBeGreaterThan(0);
    expect(response.body.averageRiskScore).toBeGreaterThan(0);
    expect(response.body.openClaims).toBeGreaterThan(0);
  });
});
