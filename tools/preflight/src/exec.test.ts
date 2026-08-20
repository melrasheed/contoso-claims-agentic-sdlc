import { describe, it, expect } from 'vitest';
import { quoteForShell, redact, firstLine } from './exec.js';

/**
 * Regression tests for the CodeQL finding js/incomplete-sanitization
 * ("Incomplete string escaping or encoding") in quoteForShell.
 *
 * The original implementation escaped `"` but not `\`. On Windows, a run of
 * backslashes immediately before a quote is itself an escape sequence, so an
 * argument ending in a backslash could terminate its own quoting and inject
 * additional shell tokens.
 */
describe('quoteForShell', () => {
  it('leaves simple safe arguments unquoted', () => {
    expect(quoteForShell('--version')).toBe('--version');
    expect(quoteForShell('account')).toBe('account');
    expect(quoteForShell('a/b_c.d:e@f=g-h')).toBe('a/b_c.d:e@f=g-h');
  });

  it('quotes anything containing whitespace', () => {
    expect(quoteForShell('Agentic SDLC')).toBe('"Agentic SDLC"');
  });

  it('quotes the empty string rather than emitting nothing', () => {
    expect(quoteForShell('')).toBe('""');
  });

  it('escapes embedded double quotes', () => {
    expect(quoteForShell('say "hi"')).toBe('"say \\"hi\\""');
  });

  // The actual vulnerability: a trailing backslash used to escape the closing
  // quote, letting everything after it be parsed as further arguments.
  it('doubles a trailing backslash so it cannot escape the closing quote', () => {
    const result = quoteForShell('C:\\path\\');
    expect(result).toBe('"C:\\path\\\\"');
    // The closing quote must not be preceded by an odd number of backslashes.
    const body = result.slice(1, -1);
    const trailing = /(\\*)$/.exec(body)?.[1] ?? '';
    expect(trailing.length % 2).toBe(0);
  });

  it('doubles a run of trailing backslashes', () => {
    const body = quoteForShell('value\\\\\\').slice(1, -1);
    const trailing = /(\\*)$/.exec(body)?.[1] ?? '';
    expect(trailing.length).toBe(6);
    expect(trailing.length % 2).toBe(0);
  });

  it('doubles backslashes that run into an embedded quote', () => {
    expect(quoteForShell('a\\"b')).toBe('"a\\\\\\"b"');
  });

  it('does not corrupt interior backslashes that are not before a quote', () => {
    expect(quoteForShell('C:\\Program Files\\az')).toBe('"C:\\Program Files\\az"');
  });

  it('neutralises cmd.exe metacharacters by quoting them', () => {
    for (const injection of ['a&whoami', 'a|whoami', 'a>out.txt', 'a^b', '%PATH%', 'a&&b']) {
      const result = quoteForShell(injection);
      expect(result.startsWith('"')).toBe(true);
      expect(result.endsWith('"')).toBe(true);
    }
  });

  // The concrete exploit the fix closes.
  it('prevents a trailing-backslash argument break-out', () => {
    const result = quoteForShell('evil\\');
    // Naive escaping produced "evil\" - the closing quote consumed by the
    // backslash - which would let a following token escape the argument.
    expect(result).not.toBe('"evil\\"');
    expect(result).toBe('"evil\\\\"');
  });
});

describe('redact', () => {
  it('redacts GitHub token formats', () => {
    expect(redact('token gho_abcdefghijklmnopqrstuvwxyz0123')).not.toContain('gho_abcdefghij');
    expect(redact('github_pat_abcdefghijklmnop')).toContain('***redacted***');
  });

  it('redacts Authorization header values', () => {
    expect(redact('Authorization: Bearer eyJhbGciOi.payload.sig')).toBe(
      'Authorization: Bearer ***redacted***',
    );
  });

  it('leaves ordinary text untouched', () => {
    expect(redact('azure-cli 2.80.0')).toBe('azure-cli 2.80.0');
  });
});

describe('firstLine', () => {
  it('returns the first non-empty trimmed line', () => {
    expect(firstLine('\n\n  hello \nworld')).toBe('hello');
  });

  it('truncates long lines', () => {
    expect(firstLine('x'.repeat(300), 20).length).toBeLessThanOrEqual(20);
  });

  it('redacts secrets before returning', () => {
    expect(firstLine('gho_abcdefghijklmnopqrstuvwxyz0123')).toContain('***redacted***');
  });
});
