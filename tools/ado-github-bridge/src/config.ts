/**
 * Configuration for the Azure Boards <-> GitHub bridge.
 *
 * Every value comes from the environment so the same binary runs locally,
 * in a GitHub Action, and in an Azure DevOps pipeline without code changes.
 * Nothing here is ever written to disk or logged.
 */

export interface BridgeConfig {
  /** Azure DevOps organisation name, e.g. "contoso" (not the full URL). */
  adoOrg: string;
  /** Azure DevOps project name, e.g. "Agentic SDLC". */
  adoProject: string;
  /**
   * Optional PAT. When absent the bridge falls back to Entra ID via
   * DefaultAzureCredential, which is the preferred path — no secret to rotate.
   */
  adoPat?: string;
  /** GitHub repository owner. */
  ghOwner: string;
  /** GitHub repository name. */
  ghRepo: string;
  /** GitHub token with `repo` scope (and `workflow` if it must touch Actions). */
  ghToken: string;

  /** Work items carrying this tag are eligible to be sent to GitHub. */
  readyTag: string;
  /** Applied by the bridge once an item has been synced, to make sync idempotent. */
  syncedTag: string;
  /** Labels applied to every issue the bridge creates. */
  issueLabels: string[];

  /** When true, hand the created issue to the GitHub Copilot coding agent. */
  assignCopilot: boolean;
  /** Azure Boards state to move the item to after a successful sync. */
  stateAfterSync?: string;
  /** Azure Boards state to move the item to when its PR merges. */
  stateAfterMerge?: string;

  /** Print actions without performing any writes. */
  dryRun: boolean;
  /** Maximum work items to process in a single run, to bound blast radius. */
  maxItems: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable ${name}. See tools/ado-github-bridge/README.md.`,
    );
  }
  return value.trim();
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
}

function boolean(name: string, fallback: boolean): boolean {
  const value = optional(name);
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function integer(name: string, fallback: number): number {
  const value = optional(name);
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  const ghRepository = optional('GITHUB_REPOSITORY');
  let ownerFromEnv: string | undefined;
  let repoFromEnv: string | undefined;
  if (ghRepository?.includes('/')) {
    const [owner, repo] = ghRepository.split('/');
    ownerFromEnv = owner;
    repoFromEnv = repo;
  }

  const config: BridgeConfig = {
    adoOrg: overrides.adoOrg ?? required('ADO_ORG'),
    adoProject: overrides.adoProject ?? required('ADO_PROJECT'),
    adoPat: overrides.adoPat ?? optional('ADO_PAT'),
    ghOwner: overrides.ghOwner ?? optional('GH_OWNER') ?? ownerFromEnv ?? required('GH_OWNER'),
    ghRepo: overrides.ghRepo ?? optional('GH_REPO') ?? repoFromEnv ?? required('GH_REPO'),
    ghToken: overrides.ghToken ?? optional('GH_TOKEN') ?? required('GITHUB_TOKEN'),

    readyTag: overrides.readyTag ?? optional('BRIDGE_READY_TAG') ?? 'ai-ready',
    syncedTag: overrides.syncedTag ?? optional('BRIDGE_SYNCED_TAG') ?? 'synced-to-github',
    issueLabels:
      overrides.issueLabels ??
      (optional('BRIDGE_ISSUE_LABELS') ?? 'from-azure-boards,ai-ready')
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean),

    assignCopilot: overrides.assignCopilot ?? boolean('BRIDGE_ASSIGN_COPILOT', true),
    stateAfterSync: overrides.stateAfterSync ?? optional('BRIDGE_STATE_AFTER_SYNC') ?? 'Committed',
    stateAfterMerge: overrides.stateAfterMerge ?? optional('BRIDGE_STATE_AFTER_MERGE') ?? 'Done',

    dryRun: overrides.dryRun ?? boolean('BRIDGE_DRY_RUN', false),
    maxItems: overrides.maxItems ?? integer('BRIDGE_MAX_ITEMS', 25),
  };

  return config;
}

/** Redacted view of the config, safe to log. */
export function describeConfig(config: BridgeConfig): Record<string, unknown> {
  return {
    adoOrg: config.adoOrg,
    adoProject: config.adoProject,
    adoAuth: config.adoPat ? 'pat' : 'entra-id (DefaultAzureCredential)',
    repository: `${config.ghOwner}/${config.ghRepo}`,
    readyTag: config.readyTag,
    syncedTag: config.syncedTag,
    issueLabels: config.issueLabels,
    assignCopilot: config.assignCopilot,
    stateAfterSync: config.stateAfterSync,
    stateAfterMerge: config.stateAfterMerge,
    dryRun: config.dryRun,
    maxItems: config.maxItems,
  };
}
