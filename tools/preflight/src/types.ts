/**
 * Shared types for the preflight doctor.
 */

export type CheckStatus = 'pass' | 'warn' | 'fail';

export type CheckCategory = 'Tooling' | 'GitHub' | 'Azure DevOps' | 'Azure' | 'MCP';

export interface CheckResult {
  /** Stable machine readable id, e.g. `github.copilot-agent`. */
  id: string;
  category: CheckCategory;
  /** Human readable check name. */
  name: string;
  status: CheckStatus;
  /** One-line outcome. Must never contain secrets. */
  detail: string;
  /** Actionable remediation: an exact command or an exact portal path. */
  hint?: string;
  /** Optional structured data for `--json` consumers. Must never contain secrets. */
  meta?: Record<string, unknown>;
}

export interface ReportSummary {
  pass: number;
  warn: number;
  fail: number;
  total: number;
}

export interface Report {
  generatedAt: string;
  /** Environment inputs actually used (never secrets). */
  context: PreflightContext;
  results: CheckResult[];
  summary: ReportSummary;
  /** True when there are zero failures. */
  ok: boolean;
}

export interface PreflightContext {
  adoOrg: string;
  adoProject: string;
  ghOwner: string;
  ghRepo: string;
  resourceGroup: string;
  subscriptionId?: string;
}

export type CheckFn = (ctx: PreflightContext) => Promise<CheckResult[]>;
