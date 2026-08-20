#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { runAzureChecks } from './checks/azure.js';
import { runAzureDevOpsChecks } from './checks/azure-devops.js';
import { runGitHubChecks } from './checks/github.js';
import { runMcpChecks } from './checks/mcp.js';
import { runToolingChecks } from './checks/tooling.js';
import { errorMessage } from './exec.js';
import { buildReport, exitCodeFor, printConsoleReport, printJsonReport } from './reporter.js';
import type { CheckCategory, CheckResult, PreflightContext } from './types.js';

const DEFAULTS = {
  adoOrg: 'melrasheed',
  adoProject: 'Agentic SDLC',
  ghOwner: 'melrasheed',
  ghRepo: 'contoso-claims-agentic-sdlc',
  resourceGroup: 'rg-contoso-claims-demo'
} as const;

interface CliOptions {
  json: boolean;
  help: boolean;
}

/** Pure: parses CLI flags. */
export function parseArgs(argv: string[]): CliOptions {
  return {
    json: argv.includes('--json'),
    help: argv.includes('--help') || argv.includes('-h')
  };
}

/** Pure: resolves the runtime context from environment variables with sane defaults. */
export function resolveContext(env: NodeJS.ProcessEnv = process.env): PreflightContext {
  const pick = (key: string, fallback: string): string => {
    const value = env[key];
    return value && value.trim().length > 0 ? value.trim() : fallback;
  };
  return {
    adoOrg: pick('ADO_ORG', DEFAULTS.adoOrg),
    adoProject: pick('ADO_PROJECT', DEFAULTS.adoProject),
    ghOwner: pick('GH_OWNER', DEFAULTS.ghOwner),
    ghRepo: pick('GH_REPO', DEFAULTS.ghRepo),
    resourceGroup: pick('DEMO_RESOURCE_GROUP', DEFAULTS.resourceGroup)
  };
}

const HELP = `
Agentic SDLC preflight doctor

Usage:
  npm run preflight                 Run every check and print a table
  npm run preflight -- --json       Emit a machine-readable JSON report
  npm run preflight -- --help       Show this help

Environment overrides:
  ADO_ORG               Azure DevOps organization        (default: ${DEFAULTS.adoOrg})
  ADO_PROJECT           Azure DevOps project             (default: ${DEFAULTS.adoProject})
  ADO_PAT               Azure DevOps PAT (optional; the az CLI token is used otherwise)
  GH_OWNER              GitHub owner                     (default: ${DEFAULTS.ghOwner})
  GH_REPO               GitHub repository                (default: ${DEFAULTS.ghRepo})
  DEMO_RESOURCE_GROUP   Azure resource group             (default: ${DEFAULTS.resourceGroup})

Exit codes:
  0  no failures (warnings allowed)
  1  at least one failing check
`;

const CATEGORY_RUNNERS: Array<{ category: CheckCategory; run: (ctx: PreflightContext) => Promise<CheckResult[]> }> = [
  { category: 'Tooling', run: runToolingChecks },
  { category: 'GitHub', run: runGitHubChecks },
  { category: 'Azure DevOps', run: runAzureDevOpsChecks },
  { category: 'Azure', run: runAzureChecks },
  { category: 'MCP', run: runMcpChecks }
];

export async function runAllChecks(ctx: PreflightContext): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const runner of CATEGORY_RUNNERS) {
    try {
      results.push(...(await runner.run(ctx)));
    } catch (err) {
      results.push({
        id: `${runner.category.toLowerCase().replace(/\s+/g, '-')}.category`,
        category: runner.category,
        name: `${runner.category} checks`,
        status: 'warn',
        detail: `Category failed to run: ${errorMessage(err)}`,
        hint: 'Re-run `npm run preflight -- --json`; the remaining categories still completed.'
      });
    }
  }
  return results;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const ctx = resolveContext();
  if (!options.json) {
    process.stdout.write('Running preflight checks (this queries GitHub, Azure DevOps and Azure)...\n');
  }

  const results = await runAllChecks(ctx);
  const report = buildReport(results, ctx);

  if (options.json) printJsonReport(report);
  else printConsoleReport(report);

  process.exitCode = exitCodeFor(report);
}

/** True only when this file is the process entry point (so tests can import it safely). */
function isEntryPoint(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    return import.meta.url === pathToFileURL(invoked).href;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().catch((err) => {
    process.stderr.write(`preflight: fatal error: ${errorMessage(err)}\n`);
    process.exitCode = 1;
  });
}