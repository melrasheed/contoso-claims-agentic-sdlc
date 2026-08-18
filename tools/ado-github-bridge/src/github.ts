/**
 * Minimal GitHub client for the bridge: create issues, apply labels, and hand
 * work to the Copilot coding agent.
 *
 * Assigning Copilot is a GraphQL operation, not a REST one. Copilot appears as
 * a *suggested actor* on the repository, and is assigned with
 * `replaceActorsForAssignable`. If the coding agent is not enabled for the
 * repository, Copilot simply will not appear in `suggestedActors` - so we
 * detect that and degrade gracefully rather than failing the whole sync.
 */

import type { BridgeConfig } from './config.js';

const GITHUB_API = 'https://api.github.com';

export interface CreatedIssue {
  number: number;
  nodeId: string;
  htmlUrl: string;
}

export interface ExistingIssue {
  number: number;
  nodeId: string;
  htmlUrl: string;
  title: string;
  state: string;
  body: string;
}

export class GitHubClient {
  constructor(private readonly config: BridgeConfig) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.ghToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'contoso-ado-github-bridge',
      ...extra,
    };
  }

  private async rest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${GITHUB_API}${path}`, {
      ...init,
      headers: this.headers(
        init.body ? { 'Content-Type': 'application/json' } : {},
      ),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `GitHub ${init.method ?? 'GET'} ${path} failed: ${response.status} ${response.statusText} - ${body.slice(0, 500)}`,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${GITHUB_API}/graphql`, {
      method: 'POST',
      headers: this.headers({
        'Content-Type': 'application/json',
        // Required while the coding-agent assignment API is feature-flagged.
        'GraphQL-Features': 'copilot_swe_agent',
      }),
      body: JSON.stringify({ query, variables }),
    });

    const payload = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (!response.ok || payload.errors?.length) {
      const message = payload.errors?.map((e) => e.message).join('; ') ?? response.statusText;
      throw new Error(`GitHub GraphQL failed: ${message}`);
    }
    return payload.data as T;
  }

  /**
   * Find an issue previously created for a work item. The bridge stamps every
   * issue body with a stable marker so re-runs are idempotent even if the
   * Azure Boards side lost its tag.
   *
   * `is:issue` is essential: GitHub's search/issues endpoint returns pull
   * requests as well, and the Copilot coding agent copies the issue body -
   * marker included - into the pull request it opens. Without this filter the
   * bridge reports the PR number instead of the issue number.
   */
  async findIssueByMarker(marker: string): Promise<ExistingIssue | undefined> {
    const { ghOwner, ghRepo } = this.config;
    const q = encodeURIComponent(`repo:${ghOwner}/${ghRepo} is:issue in:body "${marker}"`);
    const result = await this.rest<{
      items: Array<{
        number: number;
        node_id: string;
        html_url: string;
        title: string;
        state: string;
        body: string | null;
        pull_request?: unknown;
      }>;
    }>(`/search/issues?q=${q}&per_page=10`);

    // Belt and braces: drop anything that is actually a pull request.
    const match = result.items.find((item) => item.pull_request === undefined);
    if (!match) return undefined;
    return {
      number: match.number,
      nodeId: match.node_id,
      htmlUrl: match.html_url,
      title: match.title,
      state: match.state,
      body: match.body ?? '',
    };
  }

  async ensureLabels(labels: string[]): Promise<void> {
    const { ghOwner, ghRepo } = this.config;
    const palette: Record<string, { color: string; description: string }> = {
      'from-azure-boards': {
        color: '0078D4',
        description: 'Created by the Azure Boards bridge',
      },
      'ai-ready': {
        color: '8A2BE2',
        description: 'Refined and ready for an AI agent to implement',
      },
      'sre-incident': {
        color: 'B60205',
        description: 'Raised from a production incident',
      },
    };

    for (const label of labels) {
      try {
        await this.rest(`/repos/${ghOwner}/${ghRepo}/labels`, {
          method: 'POST',
          body: JSON.stringify({
            name: label,
            color: palette[label]?.color ?? 'C5DEF5',
            description: palette[label]?.description ?? 'Managed by the Azure Boards bridge',
          }),
        });
      } catch (error) {
        // 422 means it already exists, which is the normal case.
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('422')) throw error;
      }
    }
  }

  async createIssue(title: string, body: string, labels: string[]): Promise<CreatedIssue> {
    const { ghOwner, ghRepo } = this.config;
    const issue = await this.rest<{ number: number; node_id: string; html_url: string }>(
      `/repos/${ghOwner}/${ghRepo}/issues`,
      { method: 'POST', body: JSON.stringify({ title, body, labels }) },
    );
    return { number: issue.number, nodeId: issue.node_id, htmlUrl: issue.html_url };
  }

  async commentOnIssue(issueNumber: number, body: string): Promise<void> {
    const { ghOwner, ghRepo } = this.config;
    await this.rest(`/repos/${ghOwner}/${ghRepo}/issues/${issueNumber}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }

  /**
   * Look up the Copilot coding agent as an assignable actor on this repository.
   * Returns undefined when the coding agent is not available, which is a
   * supported outcome - the issue is still created for a human to pick up.
   */
  async findCopilotActorId(): Promise<string | undefined> {
    const { ghOwner, ghRepo } = this.config;
    try {
      const data = await this.graphql<{
        repository: {
          suggestedActors: { nodes: Array<{ id: string; login: string; __typename: string }> };
        };
      }>(
        `query($owner: String!, $name: String!) {
           repository(owner: $owner, name: $name) {
             suggestedActors(capabilities: [CAN_BE_ASSIGNED], first: 100) {
               nodes { login __typename ... on Bot { id } ... on User { id } }
             }
           }
         }`,
        { owner: ghOwner, name: ghRepo },
      );

      const copilot = data.repository.suggestedActors.nodes.find(
        (n) => n.login === 'copilot-swe-agent' || n.login.toLowerCase() === 'copilot',
      );
      return copilot?.id;
    } catch {
      return undefined;
    }
  }

  /** Assign an issue to the Copilot coding agent. Returns false if unavailable. */
  async assignToCopilot(issueNodeId: string): Promise<boolean> {
    const actorId = await this.findCopilotActorId();
    if (!actorId) return false;

    try {
      await this.graphql(
        `mutation($assignableId: ID!, $actorIds: [ID!]!) {
           replaceActorsForAssignable(input: { assignableId: $assignableId, actorIds: $actorIds }) {
             assignable { __typename }
           }
         }`,
        { assignableId: issueNodeId, actorIds: [actorId] },
      );
      return true;
    } catch {
      return false;
    }
  }
}
