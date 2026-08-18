import { describe, expect, it } from 'vitest';
import {
  CLAIM_TYPE_RISK,
  calculateRiskBreakdown,
  calculateRiskScore,
  reportingDelayDays,
  riskBand,
} from './risk.js';

const INCIDENT = '2026-01-01T00:00:00.000Z';
const NEXT_DAY = '2026-01-02T00:00:00.000Z';

describe('calculateRiskScore', () => {
  it('is deterministic for the same input', () => {
    const input = {
      claimType: 'auto' as const,
      amountRequested: 6_000,
      incidentDate: INCIDENT,
      reportedAt: NEXT_DAY,
    };

    expect(calculateRiskScore(input)).toBe(calculateRiskScore(input));
    expect(calculateRiskScore(input)).toBe(39);
  });

  it('stays within the 0-100 range for extreme inputs', () => {
    const huge = calculateRiskScore({
      claimType: 'liability',
      amountRequested: 10_000_000,
      incidentDate: INCIDENT,
      reportedAt: '2027-01-01T00:00:00.000Z',
    });
    const tiny = calculateRiskScore({
      claimType: 'health',
      amountRequested: 1,
      incidentDate: INCIDENT,
      reportedAt: INCIDENT,
    });

    expect(huge).toBe(100);
    expect(tiny).toBeGreaterThanOrEqual(0);
    expect(tiny).toBeLessThanOrEqual(100);
    expect(tiny).toBe(CLAIM_TYPE_RISK.health + 2);
  });

  it('increases monotonically with the requested amount', () => {
    const score = (amountRequested: number): number =>
      calculateRiskScore({
        claimType: 'property',
        amountRequested,
        incidentDate: INCIDENT,
        reportedAt: NEXT_DAY,
      });

    expect(score(1_000)).toBeLessThan(score(15_000));
    expect(score(15_000)).toBeLessThan(score(45_000));
  });

  it('saturates the amount signal at twice the typical claim value', () => {
    const atSaturation = calculateRiskBreakdown({
      claimType: 'auto',
      amountRequested: 12_000,
      incidentDate: INCIDENT,
      reportedAt: NEXT_DAY,
    });
    const beyondSaturation = calculateRiskBreakdown({
      claimType: 'auto',
      amountRequested: 120_000,
      incidentDate: INCIDENT,
      reportedAt: NEXT_DAY,
    });

    expect(atSaturation.amountPoints).toBe(50);
    expect(beyondSaturation.amountPoints).toBe(50);
  });

  it('scores riskier product lines higher, all else equal', () => {
    const base = { amountRequested: 5_000, incidentDate: INCIDENT, reportedAt: NEXT_DAY };

    const health = calculateRiskBreakdown({ ...base, claimType: 'health' });
    const liability = calculateRiskBreakdown({ ...base, claimType: 'liability' });

    expect(liability.claimTypePoints).toBeGreaterThan(health.claimTypePoints);
  });

  it('penalises late reporting', () => {
    const prompt = calculateRiskBreakdown({
      claimType: 'auto',
      amountRequested: 5_000,
      incidentDate: INCIDENT,
      reportedAt: NEXT_DAY,
    });
    const late = calculateRiskBreakdown({
      claimType: 'auto',
      amountRequested: 5_000,
      incidentDate: INCIDENT,
      reportedAt: '2026-03-01T00:00:00.000Z',
    });

    expect(prompt.reportingDelayPoints).toBe(2);
    expect(late.reportingDelayPoints).toBe(25);
    expect(late.total).toBeGreaterThan(prompt.total);
  });

  it('treats a future-dated incident as a data anomaly', () => {
    const breakdown = calculateRiskBreakdown({
      claimType: 'auto',
      amountRequested: 5_000,
      incidentDate: '2026-02-01T00:00:00.000Z',
      reportedAt: INCIDENT,
    });

    expect(breakdown.reportingDelayDays).toBeLessThan(0);
    expect(breakdown.reportingDelayPoints).toBe(25);
  });

  it('defaults the report date to now when omitted', () => {
    const score = calculateRiskScore({
      claimType: 'auto',
      amountRequested: 5_000,
      incidentDate: new Date().toISOString(),
    });

    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('riskBand', () => {
  it.each([
    [0, 'low'],
    [33, 'low'],
    [34, 'medium'],
    [66, 'medium'],
    [67, 'high'],
    [100, 'high'],
  ])('maps %i to %s', (score, expected) => {
    expect(riskBand(score)).toBe(expected);
  });
});

describe('reportingDelayDays', () => {
  it('returns whole days between incident and report', () => {
    expect(reportingDelayDays(INCIDENT, '2026-01-11T00:00:00.000Z')).toBe(10);
  });

  it('returns 0 for unparsable dates', () => {
    expect(reportingDelayDays('not-a-date', NEXT_DAY)).toBe(0);
  });
});
