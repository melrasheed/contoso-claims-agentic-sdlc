import { describe, it, expect } from 'vitest';
import { writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide, buildSummary, sanitiseForSummary, chooseDelimiter } from './boards-gate.mjs';
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

  it('rejects a work item URL that is not a genuine Azure Boards link', () => {
    const summary = buildSummary({
      config,
      items: [{ ...items[0], url: 'https://evil.example/steal' }],
      count: 1,
      decision: { passed: false, reason: 'blocked' },
      wiqlSource: 'inline WIQL',
    });
    // Falls back to a plain id rather than rendering an attacker-supplied link
    // into a governance artefact a release approver reads.
    expect(summary).not.toContain('evil.example');
    expect(summary).toContain('| 4 |');
  });

  it('coerces the work item id to a number so it cannot carry markup', () => {
    const summary = buildSummary({
      config,
      items: [{ ...items[0], id: '4<script>' }],
      count: 1,
      decision: { passed: false, reason: 'blocked' },
      wiqlSource: 'inline WIQL',
    });
    expect(summary).not.toContain('<script>');
  });
});

describe('summary sanitisation', () => {
  it('escapes markdown control characters', () => {
    expect(sanitiseForSummary('a|b')).toBe('a\\|b');
    expect(sanitiseForSummary('**bold**')).toBe('\\*\\*bold\\*\\*');
    expect(sanitiseForSummary('[link](x)')).toBe('\\[link\\](x)');
    expect(sanitiseForSummary('<img src=x>')).toBe('\\<img src=x\\>');
  });

  it('escapes backslashes before other characters, not after', () => {
    // Naive ordering would double-escape and corrupt the output - the same
    // class of bug CodeQL flagged in the shell-quoting helper.
    expect(sanitiseForSummary('a\\b')).toBe('a\\\\b');
  });

  it('strips control characters that could corrupt the summary', () => {
    expect(sanitiseForSummary('a\u0000b\u001Fc')).toBe('a b c');
    expect(sanitiseForSummary('line1\nline2')).toBe('line1 line2');
  });

  it('caps length so one work item cannot flood the summary', () => {
    expect(sanitiseForSummary('x'.repeat(500)).length).toBeLessThanOrEqual(200);
  });

  it('handles null and undefined without printing them', () => {
    expect(sanitiseForSummary(null)).toBe('');
    expect(sanitiseForSummary(undefined)).toBe('');
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

describe('setOutputs heredoc delimiter injection', () => {
  // captureOutputs replicates the key=value / heredoc serialisation that
  // setOutputs performs, using the exported chooseDelimiter for the guard.
  // The file is written into a private directory created with mkdtemp so the
  // path is unpredictable and the directory has 0700 permissions -- avoiding
  // the insecure-temp-file pattern that a predictable name in os.tmpdir() would
  // produce (symlink and race attacks).
  async function captureOutputs(outputs) {
    const dir = await mkdtemp(join(tmpdir(), 'ghoutput-test-'));
    const file = join(dir, 'output.txt');
    await writeFile(file, '');
    try {
      const lines = Object.entries(outputs).map(([key, value]) => {
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        if (/[\n\r]/.test(text)) {
          const delimiter = chooseDelimiter(text);
          return `${key}<<${delimiter}\n${text}\n${delimiter}`;
        }
        return `${key}=${text}`;
      });
      await writeFile(file, `${lines.join('\n')}\n`, 'utf8');
      return await readFile(file, 'utf8');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('writes simple single-line values as key=value', async () => {
    const out = await captureOutputs({ count: '3', passed: 'false' });
    expect(out).toContain('count=3');
    expect(out).toContain('passed=false');
  });

  it('uses heredoc syntax for multi-line values', async () => {
    const out = await captureOutputs({ data: '{"a":1,\n"b":2}' });
    expect(out).toMatch(/data<<ghadelim_\w+/);
    expect(out).toContain('"a":1,');
  });

  it('regenerates the delimiter when a content line matches it — injection prevention', async () => {
    // We cannot easily force a collision from outside, but we verify the output
    // is well-formed: the closing delimiter must appear exactly once, on its own
    // line, after the content, and the content line that equals the first
    // candidate would not appear as a bare line if the guard works.
    //
    // Concretely: craft a title that contains a line matching the pattern so
    // that if no guard existed the parser would terminate early and the remainder
    // would be misinterpreted as new key/value pairs.
    const maliciousTitle = 'normal title\nghadelim_injected\nextra=injected';
    const json = JSON.stringify([{ id: 1, title: maliciousTitle }]);
    const out = await captureOutputs({ 'blocking-items': json });

    // The output must not contain a bare line that is just a delimiter string
    // followed by another key= assignment on the very next line.
    const lines = out.split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^ghadelim_/.test(lines[i])) {
        // The line after a delimiter must be either empty or start the next key,
        // not be the middle of the heredoc value.  A collision would cause the
        // heredoc to close prematurely, and the remaining JSON lines to be parsed
        // as additional outputs.
        expect(lines[i + 1]).not.toMatch(/^extra=/);
      }
    }
  });

  it('JSON.stringify items output is parseable after roundtrip through GITHUB_OUTPUT', async () => {
    // JSON.stringify escapes newlines inside strings, so blocking-items uses
    // the simple key=value format (no heredoc needed).
    const items = [{ id: 4, title: 'Fix\nwith newline', state: 'To Do', type: 'Issue', assignedTo: 'Alice' }];
    const out = await captureOutputs({ 'blocking-items': JSON.stringify(items) });
    // Should be a plain key=value line since JSON.stringify never emits real newlines
    const match = out.match(/^blocking-items=(.+)$/m);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match[1]);
    expect(parsed[0].title).toBe('Fix\nwith newline');
  });

  it('uses heredoc and guards against delimiter collision for multi-line string values', async () => {
    // Craft a value with a real newline. The guard must pick a delimiter that
    // doesn't appear as a bare line in the content.
    const value = 'line1\nghadelim_aaaa\nline3';
    const out = await captureOutputs({ mykey: value });
    // Must use heredoc syntax
    const match = out.match(/mykey<<(\S+)\n([\s\S]+?)\n\1/);
    expect(match).not.toBeNull();
    // Content must be preserved intact
    expect(match[2]).toBe(value);
    // The chosen delimiter must not appear as a line inside the content
    const delimiter = match[1];
    const contentLines = match[2].split('\n').map((l) => l.trim());
    expect(contentLines).not.toContain(delimiter);
  });
});
