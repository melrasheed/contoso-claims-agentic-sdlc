import { commandExists, firstLine, run, safeCheck } from '../exec.js';
import type { CheckResult, PreflightContext } from '../types.js';

const CATEGORY = 'Tooling' as const;

export const MIN_NODE_MAJOR = 20;

/** Pure: extracts the major version from a `v20.11.1` / `20.11.1` style string. */
export function parseNodeMajor(version: string): number | undefined {
  const match = /v?(\d+)\./.exec(version.trim());
  if (!match?.[1]) return undefined;
  const major = Number.parseInt(match[1], 10);
  return Number.isNaN(major) ? undefined : major;
}

/** Pure: decides pass/fail for a Node runtime version. */
export function evaluateNodeVersion(version: string): CheckResult {
  const major = parseNodeMajor(version);
  if (major === undefined) {
    return {
      id: 'tooling.node',
      category: CATEGORY,
      name: 'Node.js >= 20',
      status: 'fail',
      detail: `Could not parse Node version from "${version}"`,
      hint: 'Install Node 20 LTS from https://nodejs.org/en/download and re-run `npm run preflight`.'
    };
  }
  if (major < MIN_NODE_MAJOR) {
    return {
      id: 'tooling.node',
      category: CATEGORY,
      name: 'Node.js >= 20',
      status: 'fail',
      detail: `Node ${version} is below the required v${MIN_NODE_MAJOR}`,
      hint: 'Run `winget install OpenJS.NodeJS.LTS` (Windows) or `nvm install 20 && nvm use 20`.',
      meta: { version, major }
    };
  }
  return {
    id: 'tooling.node',
    category: CATEGORY,
    name: 'Node.js >= 20',
    status: 'pass',
    detail: `Node ${version}`,
    meta: { version, major }
  };
}

/** Pure: `az account show` output -> check result. */
export function evaluateAzLogin(
  account: { name?: string; id?: string; user?: { name?: string } } | undefined
): CheckResult {
  if (!account?.id) {
    return {
      id: 'tooling.az-login',
      category: CATEGORY,
      name: 'Azure CLI logged in',
      status: 'fail',
      detail: 'No active Azure CLI session (`az account show` returned nothing)',
      hint: 'Run `az login` (add `--tenant <tenant-id>` for guest tenants), then `az account set --subscription <id>`.'
    };
  }
  return {
    id: 'tooling.az-login',
    category: CATEGORY,
    name: 'Azure CLI logged in',
    status: 'pass',
    detail: `Signed in to subscription "${account.name ?? account.id}"`,
    meta: { subscriptionId: account.id, subscriptionName: account.name }
  };
}

export async function runToolingChecks(_ctx: PreflightContext): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  results.push(
    await safeCheck('tooling.node', CATEGORY, 'Node.js >= 20', async () => evaluateNodeVersion(process.version))
  );

  results.push(
    await safeCheck('tooling.npm', CATEGORY, 'npm available', async () => {
      const res = await commandExists('npm');
      return res.ok
        ? {
            id: 'tooling.npm',
            category: CATEGORY,
            name: 'npm available',
            status: 'pass' as const,
            detail: `npm ${firstLine(res.stdout)}`
          }
        : {
            id: 'tooling.npm',
            category: CATEGORY,
            name: 'npm available',
            status: 'fail' as const,
            detail: 'npm is not on PATH',
            hint: 'Reinstall Node.js 20 LTS (bundles npm): `winget install OpenJS.NodeJS.LTS`.'
          };
    })
  );

  results.push(
    await safeCheck('tooling.git', CATEGORY, 'git available', async () => {
      const res = await commandExists('git');
      return res.ok
        ? {
            id: 'tooling.git',
            category: CATEGORY,
            name: 'git available',
            status: 'pass' as const,
            detail: firstLine(res.stdout)
          }
        : {
            id: 'tooling.git',
            category: CATEGORY,
            name: 'git available',
            status: 'fail' as const,
            detail: 'git is not on PATH',
            hint: 'Run `winget install Git.Git` (Windows) or `sudo apt-get install git`.'
          };
    })
  );

  results.push(
    await safeCheck('tooling.az', CATEGORY, 'Azure CLI available', async () => {
      const res = await run('az', ['version', '-o', 'json'], { timeoutMs: 90_000 });
      if (!res.ok) {
        return {
          id: 'tooling.az',
          category: CATEGORY,
          name: 'Azure CLI available',
          status: 'fail' as const,
          detail: 'az is not on PATH',
          hint: 'Run `winget install Microsoft.AzureCLI` (Windows) or see https://aka.ms/installazurecli.'
        };
      }
      let core: string;
      try {
        const parsed = JSON.parse(res.stdout) as { 'azure-cli'?: string };
        core = parsed['azure-cli'] ?? 'unknown';
      } catch {
        core = firstLine(res.stdout);
      }
      return {
        id: 'tooling.az',
        category: CATEGORY,
        name: 'Azure CLI available',
        status: 'pass' as const,
        detail: `azure-cli ${core}`,
        meta: { version: core }
      };
    })
  );

  results.push(
    await safeCheck('tooling.az-login', CATEGORY, 'Azure CLI logged in', async () => {
      const res = await run('az', ['account', 'show', '-o', 'json'], { timeoutMs: 90_000 });
      if (!res.ok) return evaluateAzLogin(undefined);
      try {
        return evaluateAzLogin(JSON.parse(res.stdout));
      } catch {
        return evaluateAzLogin(undefined);
      }
    })
  );

  results.push(
    await safeCheck('tooling.gh', CATEGORY, 'GitHub CLI available', async () => {
      const res = await commandExists('gh');
      return res.ok
        ? {
            id: 'tooling.gh',
            category: CATEGORY,
            name: 'GitHub CLI available',
            status: 'pass' as const,
            detail: firstLine(res.stdout)
          }
        : {
            id: 'tooling.gh',
            category: CATEGORY,
            name: 'GitHub CLI available',
            status: 'fail' as const,
            detail: 'gh is not on PATH',
            hint: 'Run `winget install GitHub.cli` (Windows) or see https://cli.github.com.'
          };
    })
  );

  results.push(
    await safeCheck('tooling.gh-auth', CATEGORY, 'GitHub CLI authenticated', async () => {
      const res = await run('gh', ['auth', 'status'], { timeoutMs: 60_000 });
      const combined = `${res.stdout}\n${res.stderr}`;
      if (!/Logged in to/i.test(combined)) {
        return {
          id: 'tooling.gh-auth',
          category: CATEGORY,
          name: 'GitHub CLI authenticated',
          status: 'fail' as const,
          detail: 'gh is not authenticated',
          hint: 'Run `gh auth login --hostname github.com --git-protocol https --scopes repo,workflow,read:org`.'
        };
      }
      const account = /Logged in to \S+ (?:account|as) (\S+)/i.exec(combined)?.[1] ?? 'unknown account';
      return {
        id: 'tooling.gh-auth',
        category: CATEGORY,
        name: 'GitHub CLI authenticated',
        status: 'pass' as const,
        detail: `Authenticated as ${account}`,
        meta: { account }
      };
    })
  );

  return results;
}
