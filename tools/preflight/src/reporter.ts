import type { CheckResult, CheckStatus, PreflightContext, Report, ReportSummary } from './types.js';

const STATUS_ORDER: CheckStatus[] = ['fail', 'warn', 'pass'];

const SYMBOLS: Record<CheckStatus, string> = {
  pass: 'PASS',
  warn: 'WARN',
  fail: 'FAIL'
};

const COLORS: Record<CheckStatus, string> = {
  pass: '\u001b[32m',
  warn: '\u001b[33m',
  fail: '\u001b[31m'
};

const RESET = '\u001b[0m';
const DIM = '\u001b[2m';
const BOLD = '\u001b[1m';

export function colorsEnabled(stream: { isTTY?: boolean } = process.stdout): boolean {
  if (process.env['NO_COLOR']) return false;
  if (process.env['FORCE_COLOR']) return true;
  return Boolean(stream.isTTY);
}

/** Pure: rolls results up into pass/warn/fail counts. */
export function summarize(results: CheckResult[]): ReportSummary {
  const summary: ReportSummary = { pass: 0, warn: 0, fail: 0, total: results.length };
  for (const r of results) summary[r.status] += 1;
  return summary;
}

/** Pure: assembles the full report object used by both renderers. */
export function buildReport(results: CheckResult[], context: PreflightContext): Report {
  const summary = summarize(results);
  return {
    generatedAt: new Date().toISOString(),
    context,
    results,
    summary,
    ok: summary.fail === 0
  };
}

/** Pure: exit code contract - 0 when there are no failures, 1 otherwise. */
export function exitCodeFor(report: Report): number {
  return report.ok ? 0 : 1;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function truncate(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Pure: renders the aligned result table (no ANSI when `color` is false). */
export function renderTable(results: CheckResult[], color: boolean, maxDetail = 78): string {
  const rows = results.map((r) => ({
    status: SYMBOLS[r.status],
    raw: r.status,
    category: r.category,
    name: r.name,
    detail: truncate(r.detail, maxDetail)
  }));

  const wStatus = Math.max('RESULT'.length, ...rows.map((r) => r.status.length));
  const wCategory = Math.max(8, ...rows.map((r) => r.category.length));
  const wName = Math.max(5, ...rows.map((r) => r.name.length));
  const wDetail = Math.max(6, ...rows.map((r) => r.detail.length));

  const line = `+${'-'.repeat(wStatus + 2)}+${'-'.repeat(wCategory + 2)}+${'-'.repeat(wName + 2)}+${'-'.repeat(wDetail + 2)}+`;
  const header = `| ${pad('RESULT', wStatus)} | ${pad('CATEGORY', wCategory)} | ${pad('CHECK', wName)} | ${pad('DETAIL', wDetail)} |`;

  const body = rows.map((r) => {
    const status = color ? `${COLORS[r.raw as CheckStatus]}${pad(r.status, wStatus)}${RESET}` : pad(r.status, wStatus);
    return `| ${status} | ${pad(r.category, wCategory)} | ${pad(r.name, wName)} | ${pad(r.detail, wDetail)} |`;
  });

  return [line, header, line, ...body, line].join('\n');
}

/** Pure: the actionable remediation block shown under the table. */
export function renderHints(results: CheckResult[], color: boolean): string {
  const actionable = results
    .filter((r) => r.status !== 'pass' && r.hint)
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));

  if (actionable.length === 0) return '';

  const lines = [color ? `${BOLD}Remediation${RESET}` : 'Remediation'];
  for (const r of actionable) {
    const badge = color ? `${COLORS[r.status]}${SYMBOLS[r.status]}${RESET}` : SYMBOLS[r.status];
    lines.push(`  ${badge} ${r.category} / ${r.name}`);
    lines.push(`       ${r.detail}`);
    lines.push(`       -> ${r.hint}`);
  }
  return lines.join('\n');
}

/** Pure: the final counts line. */
export function renderSummary(summary: ReportSummary, color: boolean): string {
  const parts = [
    `${color ? COLORS.pass : ''}${summary.pass} passed${color ? RESET : ''}`,
    `${color ? COLORS.warn : ''}${summary.warn} warnings${color ? RESET : ''}`,
    `${color ? COLORS.fail : ''}${summary.fail} failures${color ? RESET : ''}`
  ];
  return `${parts.join('  |  ')}  |  ${summary.total} checks total`;
}

export function renderContext(context: PreflightContext, color: boolean): string {
  const dim = color ? DIM : '';
  const reset = color ? RESET : '';
  return [
    `${dim}Azure DevOps : ${context.adoOrg} / ${context.adoProject}${reset}`,
    `${dim}GitHub       : ${context.ghOwner}/${context.ghRepo}${reset}`,
    `${dim}Azure RG     : ${context.resourceGroup}${reset}`
  ].join('\n');
}

/** Renders the human-readable report to stdout. */
export function printConsoleReport(report: Report): void {
  const color = colorsEnabled();
  const title = color ? `${BOLD}Agentic SDLC preflight doctor${RESET}` : 'Agentic SDLC preflight doctor';
  const out: string[] = ['', title, renderContext(report.context, color), '', renderTable(report.results, color)];

  const hints = renderHints(report.results, color);
  if (hints) out.push('', hints);

  out.push('', renderSummary(report.summary, color));
  out.push(
    report.ok
      ? 'Preflight OK - no blocking failures.'
      : 'Preflight FAILED - resolve the FAIL rows above before running the accelerator.'
  );
  out.push('');
  process.stdout.write(`${out.join('\n')}\n`);
}

/** Renders the machine-readable report to stdout. */
export function printJsonReport(report: Report): void {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
