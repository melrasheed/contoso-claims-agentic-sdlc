import { describe, it, expect } from 'vitest';
import { decide, buildSummary } from './boards-gate.mjs';
import { buildDeploymentComment, extractWorkItemIds } from './boards-comment.mjs';

/**
 * The release gate replaces the Azure Pipelines "Query Work Items" check.
 * Its decision logic is the control that stands between a known Sev1 defect
 * and production, so it is tested directly rather than only through the
 * workflow.
 */
describe('release gate decision', () => {
  it('passes when nothing is blocking', () => {
    expect(decide({ count: 0, maxBlocking: 0, enforce: true })).toEqual({
      passed: true,
      reason: 'clear',
    });
  });

  it('blocks on a single blocking work item when tolerance is zero', () => {
    const result = decide({ count: 1, maxBlocking: 0, enforce: true });
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('blocked');
  });

  it('respects a non-zero tolerance', () => {
    expect(decide({ count: 2, maxBlocking: 2, enforce: true }).passed).toBe(true);
    expect(decide({ count: 3, maxBlocking: 2, enforce: true }).passed).toBe(false);
  });

  it('reports without blocking when enforcement is disabled', () => {
    const result = decide({ count: 5, maxBlocking: 0, enforce: false });
    expect(result.passed).toBe(true);
    expect(result.reason).toBe('not-enforced');
  });

  it('distinguishes "clear" from "not enforced" so the summary can tell the truth', () => {
    expect(decide({ count: 0, maxBlocking: 0, enforce: false }).reason).toBe('clear');
    expect(decide({ count: 1, maxBlocking: 0, enforce: false }).reason).toBe('not-enforced');
  });
});

describe('release gate summary', () => {
  const config = {
    organization: 'contoso',
    project: 'Agentic SDLC',
    maxBlocking: 0,
  };
  const items = [
    {
      id: 4,
      type: 'Issue',
      title: 'Adjudicating an already-paid claim returns 200 instead of 409',
      state: 'To Do',
      assignedTo: 'Unassigned',
      url: 'https://dev.azure.com/contoso/Agentic%20SDLC/_workitems/edit/4',
    },
  ];

  it('states plainly that the deployment is blocked', () => {
    const summary = buildSummary({
      config,
      items,
      count: 1,
      decision: { passed: false, reason: 'blocked' },
      wiqlSource: 'shared query: Release Gate',
    });
    expect(summary).toContain('BLOCKED');
    expect(summary).toContain('Adjudicating an already-paid claim');
    expect(summary).toContain('/_workitems/edit/4');
  });

  it('tells the reader not to bypass the gate', () => {
    const summary = buildSummary({
      config,
      items,
      count: 1,
      decision: { passed: false, reason: 'blocked' },
      wiqlSource: 'shared query: Release Gate',
    });
    expect(summary).toMatch(/Do not bypass/i);
  });

  it('says so when items were found but enforcement was off', () => {
    const summary = buildSummary({
      config,
      items,
      count: 1,
      decision: { passed: true, reason: 'not-enforced' },
      wiqlSource: 'shared query: Release Gate',
    });
    expect(summary).toContain('Enforcement is disabled');
    expect(summary).toContain('would have blocked');
  });

  it('reports a clean result without an empty table', () => {
    const summary = buildSummary({
      config,
      items: [],
      count: 0,
      decision: { passed: true, reason: 'clear' },
      wiqlSource: 'shared query: Release Gate',
    });
    expect(summary).toContain('No blocking work items');
    expect(summary).not.toContain('| ID |');
  });

  it('escapes pipe characters so a title cannot break the markdown table', () => {
    const summary = buildSummary({
      config,
      items: [{ ...items[0], title: 'a | b | c' }],
      count: 1,
      decision: { passed: false, reason: 'blocked' },
      wiqlSource: 'inline WIQL',
    });
    expect(summary).toContain('a \\| b \\| c');
  });
});

describe('AB# extraction for Boards write-back', () => {
  it('extracts ids from commit text', () => {
    expect(extractWorkItemIds('Fix adjudication guard AB#42')).toEqual([42]);
  });

  it('is case insensitive, because people type ab#', () => {
    expect(extractWorkItemIds('resolves ab#7')).toEqual([7]);
  });

  it('de-duplicates and sorts', () => {
    expect(extractWorkItemIds('AB#9 AB#2 AB#9 AB#2')).toEqual([2, 9]);
  });

  it('finds multiple references across multiple lines', () => {
    expect(extractWorkItemIds('first AB#1\nsecond AB#2\n\nthird AB#3')).toEqual([1, 2, 3]);
  });

  it('ignores things that merely look similar', () => {
    expect(extractWorkItemIds('ABC#12 XAB#5 AB#')).toEqual([]);
    expect(extractWorkItemIds('issue #42')).toEqual([]);
  });

  it('returns an empty array for empty or missing input', () => {
    expect(extractWorkItemIds('')).toEqual([]);
    expect(extractWorkItemIds(undefined)).toEqual([]);
    expect(extractWorkItemIds(null)).toEqual([]);
  });
});

describe('deployment comment', () => {
  it('records environment, version and run so the work item is a real audit trail', () => {
    const comment = buildDeploymentComment({
      environment: 'production',
      version: '2026.08.20-abc1234',
      deployUrl: 'https://example.azurewebsites.net',
      runUrl: 'https://github.com/o/r/actions/runs/1',
      repository: 'o/r',
    });
    expect(comment).toContain('production');
    expect(comment).toContain('2026.08.20-abc1234');
    expect(comment).toContain('https://example.azurewebsites.net');
    expect(comment).toContain('actions/runs/1');
  });

  it('omits fields that were not supplied rather than printing undefined', () => {
    const comment = buildDeploymentComment({ environment: 'dev' });
    expect(comment).toContain('dev');
    expect(comment).not.toContain('undefined');
    expect(comment).not.toContain('Version:');
  });

  it('escapes HTML so a crafted value cannot inject markup into the work item', () => {
    const comment = buildDeploymentComment({
      environment: 'prod',
      version: '<script>alert(1)</script>',
    });
    expect(comment).not.toContain('<script>');
    expect(comment).toContain('&lt;script&gt;');
  });
});
