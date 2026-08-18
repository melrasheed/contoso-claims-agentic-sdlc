import { firstLine, run, safeCheck } from '../exec.js';
import type { CheckResult, PreflightContext } from '../types.js';

const CATEGORY = 'GitHub' as const;

const COPILOT_AGENT_LOGIN = 'copilot-swe-agent';

export interface SuggestedActorNode {
  login?: string;
  __typename?: string;
}

/**
 * Pure: extracts the token scopes of the *active* account from `gh auth status`
 * output. gh may list several accounts; only the active one is used by the CLI.
 */
export function parseTokenScopes(authStatusOutput: string): string[] {
  const blocks = authStatusOutput.split(/\r?\n\s*\r?\n/).filter((b) => /Token scopes:/i.test(b));
  const active = blocks.find((b) => /Active account:\s*true/i.test(b)) ?? blocks[0];
  if (!active) return [];
  const line = /Token scopes:(.*)/i.exec(active)?.[1];
  if (!line) return [];
  return line
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter((s) => s.length > 0);
}

/** Pure: `workflow` scope is required to push anything under `.github/workflows/`. */
export function evaluateTokenScopes(scopes: string[]): CheckResult {
  if (scopes.length === 0) {
    return {
      id: 'github.scopes',
      category: CATEGORY,
      name: 'GitHub token scopes',
      status: 'warn',
      detail: 'Could not determine token scopes (fine-grained PAT or GITHUB_TOKEN in use)',
      hint: 'Run `gh auth status` and confirm the active token can write `.github/workflows/`; for classic tokens run `gh auth refresh -h github.com -s workflow`.'
    };
  }
  if (!scopes.includes('workflow')) {
    return {
      id: 'github.scopes',
      category: CATEGORY,
      name: 'GitHub token scopes',
      status: 'warn',
      detail: `Active token is missing the "workflow" scope (has: ${scopes.join(', ')}) - pushes that touch .github/workflows/ will be rejected`,
      hint: 'Run `gh auth refresh -h github.com -s workflow` (classic token) or add "Workflows: Read and write" to the fine-grained PAT.',
      meta: { scopes }
    };
  }
  return {
    id: 'github.scopes',
    category: CATEGORY,
    name: 'GitHub token scopes',
    status: 'pass',
    detail: `Scopes: ${scopes.join(', ')}`,
    meta: { scopes }
  };
}

/** Pure: is the Copilot coding agent assignable on this repo? */
export function evaluateCopilotActor(nodes: SuggestedActorNode[]): CheckResult {
  const logins = nodes.map((n) => n.login).filter((l): l is string => typeof l === 'string');
  if (logins.includes(COPILOT_AGENT_LOGIN)) {
    return {
      id: 'github.copilot-agent',
      category: CATEGORY,
      name: 'Copilot coding agent assignable',
      status: 'pass',
      detail: `"${COPILOT_AGENT_LOGIN}" is returned by suggestedActors(capabilities: [CAN_BE_ASSIGNED])`,
      meta: { assignableActors: logins }
    };
  }
  return {
    id: 'github.copilot-agent',
    category: CATEGORY,
    name: 'Copilot coding agent assignable',
    status: 'fail',
    detail: `"${COPILOT_AGENT_LOGIN}" is not assignable on this repository (assignable actors: ${logins.join(', ') || 'none'})`,
    hint: 'Enable it at GitHub -> Organization/Repository -> Settings -> Copilot -> Coding agent, and confirm the Copilot Pro/Business seat covers this repo.',
    meta: { assignableActors: logins }
  };
}

async function ghJson<T>(args: string[]): Promise<{ data?: T; status: number; raw: string }> {
  const res = await run('gh', args, { timeoutMs: 60_000 });
  const raw = `${res.stdout}${res.stderr}`;
  const statusMatch = /HTTP (\d{3})/.exec(raw);
  const status = statusMatch?.[1] ? Number.parseInt(statusMatch[1], 10) : res.ok ? 200 : 0;
  if (!res.ok) return { status, raw };
  try {
    return { data: JSON.parse(res.stdout) as T, status: 200, raw };
  } catch {
    return { status, raw };
  }
}

export async function runGitHubChecks(ctx: PreflightContext): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const repoSlug = `${ctx.ghOwner}/${ctx.ghRepo}`;
  let defaultBranch = 'main';

  results.push(
    await safeCheck('github.scopes', CATEGORY, 'GitHub token scopes', async () => {
      const res = await run('gh', ['auth', 'status'], { timeoutMs: 60_000 });
      return evaluateTokenScopes(parseTokenScopes(`${res.stdout}\n${res.stderr}`));
    })
  );

  results.push(
    await safeCheck('github.repo', CATEGORY, 'Repository accessible', async () => {
      const res = await run(
        'gh',
        ['repo', 'view', repoSlug, '--json', 'nameWithOwner,defaultBranchRef,viewerPermission,visibility'],
        { timeoutMs: 60_000 }
      );
      if (!res.ok) {
        return {
          id: 'github.repo',
          category: CATEGORY,
          name: 'Repository accessible',
          status: 'fail' as const,
          detail: `Cannot read ${repoSlug}: ${firstLine(res.stderr || res.error || 'unknown error')}`,
          hint: `Run \`gh auth login\` then \`gh repo view ${repoSlug}\`; if the repo lives elsewhere set GH_OWNER/GH_REPO before re-running.`
        };
      }
      const repo = JSON.parse(res.stdout) as {
        nameWithOwner?: string;
        defaultBranchRef?: { name?: string } | null;
        viewerPermission?: string;
        visibility?: string;
      };
      defaultBranch = repo.defaultBranchRef?.name ?? 'main';
      return {
        id: 'github.repo',
        category: CATEGORY,
        name: 'Repository accessible',
        status: 'pass' as const,
        detail: `${repo.nameWithOwner} (${repo.visibility ?? 'unknown'}), default branch "${defaultBranch}", your permission: ${repo.viewerPermission ?? 'unknown'}`,
        meta: {
          nameWithOwner: repo.nameWithOwner,
          defaultBranch,
          viewerPermission: repo.viewerPermission
        }
      };
    })
  );

  results.push(
    await safeCheck('github.copilot-agent', CATEGORY, 'Copilot coding agent assignable', async () => {
      const query =
        'query($owner:String!,$name:String!){ repository(owner:$owner,name:$name){ suggestedActors(capabilities:[CAN_BE_ASSIGNED], first:100){ nodes { login __typename } } } }';
      const res = await run(
        'gh',
        [
          'api',
          'graphql',
          '-H',
          'GraphQL-Features: copilot_swe_agent',
          '-f',
          `query=${query}`,
          '-F',
          `owner=${ctx.ghOwner}`,
          '-F',
          `name=${ctx.ghRepo}`
        ],
        { timeoutMs: 60_000 }
      );
      if (!res.ok) {
        return {
          id: 'github.copilot-agent',
          category: CATEGORY,
          name: 'Copilot coding agent assignable',
          status: 'warn' as const,
          detail: `suggestedActors query failed: ${firstLine(res.stderr || res.error || 'unknown error')}`,
          hint: 'Verify `gh auth status` succeeds, then re-run; the GraphQL preview needs the header `GraphQL-Features: copilot_swe_agent`.'
        };
      }
      const parsed = JSON.parse(res.stdout) as {
        data?: { repository?: { suggestedActors?: { nodes?: SuggestedActorNode[] } } };
      };
      return evaluateCopilotActor(parsed.data?.repository?.suggestedActors?.nodes ?? []);
    })
  );

  results.push(
    await safeCheck('github.branch-protection', CATEGORY, 'Default branch protected', async () => {
      const { data, status, raw } = await ghJson<{ required_pull_request_reviews?: unknown; required_status_checks?: unknown }>([
        'api',
        `repos/${repoSlug}/branches/${defaultBranch}/protection`
      ]);
      if (status === 404 || /Branch not protected/i.test(raw)) {
        return {
          id: 'github.branch-protection',
          category: CATEGORY,
          name: 'Default branch protected',
          status: 'warn' as const,
          detail: `No branch protection / ruleset on "${defaultBranch}" - agent PRs can merge without review`,
          hint: `Add a ruleset at GitHub -> ${repoSlug} -> Settings -> Rules -> Rulesets -> New branch ruleset (require a pull request + status check "ci").`
        };
      }
      if (!data) {
        return {
          id: 'github.branch-protection',
          category: CATEGORY,
          name: 'Default branch protected',
          status: 'warn' as const,
          detail: `Could not read branch protection for "${defaultBranch}" (admin permission required)`,
          hint: `Check GitHub -> ${repoSlug} -> Settings -> Branches, or ask an admin to confirm protection on "${defaultBranch}".`
        };
      }
      const reviews = Boolean(data.required_pull_request_reviews);
      const statusChecks = Boolean(data.required_status_checks);
      return {
        id: 'github.branch-protection',
        category: CATEGORY,
        name: 'Default branch protected',
        status: 'pass' as const,
        detail: `"${defaultBranch}" protected (PR reviews: ${reviews ? 'yes' : 'no'}, required status checks: ${statusChecks ? 'yes' : 'no'})`,
        meta: { defaultBranch, requiredReviews: reviews, requiredStatusChecks: statusChecks }
      };
    })
  );

  results.push(
    await safeCheck('github.actions', CATEGORY, 'GitHub Actions enabled', async () => {
      const { data } = await ghJson<{ enabled?: boolean; allowed_actions?: string }>([
        'api',
        `repos/${repoSlug}/actions/permissions`
      ]);
      if (!data) {
        return {
          id: 'github.actions',
          category: CATEGORY,
          name: 'GitHub Actions enabled',
          status: 'warn' as const,
          detail: 'Could not read Actions permissions (admin permission required)',
          hint: `Confirm at GitHub -> ${repoSlug} -> Settings -> Actions -> General -> Actions permissions.`
        };
      }
      if (data.enabled === false) {
        return {
          id: 'github.actions',
          category: CATEGORY,
          name: 'GitHub Actions enabled',
          status: 'fail' as const,
          detail: 'GitHub Actions is disabled for this repository',
          hint: `Enable at GitHub -> ${repoSlug} -> Settings -> Actions -> General -> "Allow all actions and reusable workflows".`
        };
      }
      return {
        id: 'github.actions',
        category: CATEGORY,
        name: 'GitHub Actions enabled',
        status: 'pass' as const,
        detail: `Actions enabled (allowed actions: ${data.allowed_actions ?? 'all'})`,
        meta: { allowedActions: data.allowed_actions }
      };
    })
  );

  return results;
}
