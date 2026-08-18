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

export interface BranchRule {
  type: string;
  parameters?: Record<string, unknown>;
}

/**
 * Pure: grades branch protection from the effective rules returned by
 * `GET /repos/{o}/{r}/rules/branches/{branch}` (rulesets API, covers both
 * repo-level and org-level rulesets).  Falls back to the legacy shape when
 * called with legacy data (has `required_pull_request_reviews`).
 *
 * Grading:
 *   PASS  – a `pull_request` rule exists AND required_approving_review_count >= 1
 *   WARN  – some rules exist but no PR review requirement (or count == 0)
 *   FAIL  – no rules at all
 */
export function evaluateBranchRules(
  rules: BranchRule[],
  branch: string,
  source: 'ruleset' | 'legacy'
): CheckResult {
  if (rules.length === 0) {
    return {
      id: 'github.branch-protection',
      category: CATEGORY,
      name: 'Default branch protected',
      status: 'fail',
      detail: `No branch protection or ruleset found on "${branch}" — agent PRs can merge without review`,
      hint: `Add a branch ruleset at GitHub → Settings → Rules → Rulesets → New branch ruleset, targeting "${branch}". Require pull requests with at least 1 approval and a required status check.`
    };
  }

  const prRule = rules.find((r) => r.type === 'pull_request');
  const statusRule = rules.find((r) => r.type === 'required_status_checks');
  const requiredCount =
    typeof (prRule?.parameters as { required_approving_review_count?: unknown })
      ?.required_approving_review_count === 'number'
      ? ((prRule!.parameters as { required_approving_review_count: number }).required_approving_review_count)
      : undefined;
  const codeOwner = Boolean(
    (prRule?.parameters as { require_code_owner_review?: unknown })?.require_code_owner_review
  );
  const statusContexts: string[] = (
    (statusRule?.parameters as { required_status_checks?: Array<{ context?: string }> })
      ?.required_status_checks ?? []
  )
    .map((s) => s.context)
    .filter((c): c is string => Boolean(c));

  const ruleTypes = rules.map((r) => r.type).join(', ');
  const sourceLabel = source === 'ruleset' ? 'ruleset' : 'legacy branch protection';

  if (!prRule || requiredCount === 0) {
    return {
      id: 'github.branch-protection',
      category: CATEGORY,
      name: 'Default branch protected',
      status: 'warn',
      detail: `"${branch}" has ${rules.length} rule(s) via ${sourceLabel} (${ruleTypes}) but no required PR review — merges can proceed without approval`,
      hint: `Add a pull_request rule requiring at least 1 approving review at GitHub → Settings → Rules → Rulesets.`,
      meta: { branch, source, ruleTypes, statusContexts }
    };
  }

  const summaryParts = [`${requiredCount} approval(s) required`];
  if (codeOwner) summaryParts.push('code-owner review required');
  if (statusContexts.length > 0) summaryParts.push(`required status checks: [${statusContexts.join(', ')}]`);

  return {
    id: 'github.branch-protection',
    category: CATEGORY,
    name: 'Default branch protected',
    status: 'pass',
    detail: `"${branch}" protected via ${sourceLabel} — ${summaryParts.join(', ')}`,
    meta: { branch, source, requiredApprovals: requiredCount, codeOwnerReview: codeOwner, statusContexts }
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
      // Query the rulesets API first — it returns effective rules from ALL sources
      // (repository rulesets + org rulesets) and is the correct answer for "is this
      // branch governed?".  The legacy /branches/{b}/protection endpoint returns 404
      // when a ruleset (rather than a classic rule) is active, so checking only that
      // endpoint produces false negatives on any modern protected repo.
      const rulesRes = await ghJson<BranchRule[]>([
        'api',
        `repos/${repoSlug}/rules/branches/${defaultBranch}`
      ]);

      if (rulesRes.data && Array.isArray(rulesRes.data) && rulesRes.data.length > 0) {
        return evaluateBranchRules(rulesRes.data, defaultBranch, 'ruleset');
      }

      // Fall back to the legacy branch-protection endpoint for classic rules.
      const { data: legacyData, status: legacyStatus } = await ghJson<{
        required_pull_request_reviews?: { required_approving_review_count?: number; require_code_owner_review?: boolean };
        required_status_checks?: { contexts?: string[] };
      }>(['api', `repos/${repoSlug}/branches/${defaultBranch}/protection`]);

      if (legacyData?.required_pull_request_reviews !== undefined) {
        const legacyRules: BranchRule[] = [
          {
            type: 'pull_request',
            parameters: {
              required_approving_review_count:
                legacyData.required_pull_request_reviews.required_approving_review_count ?? 1,
              require_code_owner_review:
                legacyData.required_pull_request_reviews.require_code_owner_review ?? false
            }
          }
        ];
        if (legacyData.required_status_checks?.contexts?.length) {
          legacyRules.push({
            type: 'required_status_checks',
            parameters: {
              required_status_checks: legacyData.required_status_checks.contexts.map((c) => ({ context: c }))
            }
          });
        }
        return evaluateBranchRules(legacyRules, defaultBranch, 'legacy');
      }

      if (legacyStatus === 403) {
        // 403 means protected but we lack admin access to read the rules.
        return {
          id: 'github.branch-protection',
          category: CATEGORY,
          name: 'Default branch protected',
          status: 'warn' as const,
          detail: `"${defaultBranch}" appears protected but rule details require admin access`,
          hint: `Ask a repo admin to confirm protection at GitHub → ${repoSlug} → Settings → Branches / Rules.`
        };
      }

      // Both endpoints returned nothing — no protection at all.
      return evaluateBranchRules([], defaultBranch, 'ruleset');
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
