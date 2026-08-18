/**
 * Minimal Azure DevOps REST client covering exactly what the bridge needs.
 *
 * Auth order:
 *   1. ADO_PAT if supplied (simple, works everywhere, but a secret to rotate)
 *   2. Entra ID via DefaultAzureCredential (preferred - no stored secret)
 *
 * The Azure DevOps resource GUID below is a well-known constant, not a secret.
 */

import { DefaultAzureCredential } from '@azure/identity';
import type { BridgeConfig } from './config.js';

/** Well-known Azure DevOps application ID used to request an Entra token. */
const ADO_RESOURCE_ID = '499b84ac-1321-427f-aa17-267ca6975798';

const API_VERSION = '7.1';

export interface WorkItem {
  id: number;
  rev: number;
  fields: Record<string, unknown>;
  relations?: WorkItemRelation[];
  url: string;
}

export interface WorkItemRelation {
  rel: string;
  url: string;
  attributes?: Record<string, unknown>;
}

export interface JsonPatchOperation {
  op: 'add' | 'replace' | 'remove' | 'test';
  path: string;
  value?: unknown;
  from?: string;
}

export class AdoClient {
  private readonly baseUrl: string;
  private readonly projectUrl: string;
  private readonly pat: string | undefined;
  private credential: DefaultAzureCredential | undefined;
  private cachedToken: { token: string; expiresOn: number } | undefined;

  constructor(private readonly config: BridgeConfig) {
    this.baseUrl = `https://dev.azure.com/${encodeURIComponent(config.adoOrg)}`;
    this.projectUrl = `${this.baseUrl}/${encodeURIComponent(config.adoProject)}`;
    this.pat = config.adoPat;
  }

  private async authHeader(): Promise<string> {
    if (this.pat) {
      // ADO PAT auth is Basic with an empty username.
      return `Basic ${Buffer.from(`:${this.pat}`).toString('base64')}`;
    }

    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresOn - now > 60_000) {
      return `Bearer ${this.cachedToken.token}`;
    }

    this.credential ??= new DefaultAzureCredential();
    const token = await this.credential.getToken(`${ADO_RESOURCE_ID}/.default`);
    if (!token) {
      throw new Error(
        'Failed to acquire an Entra ID token for Azure DevOps. Run `az login`, or set ADO_PAT.',
      );
    }
    this.cachedToken = { token: token.token, expiresOn: token.expiresOnTimestamp };
    return `Bearer ${token.token}`;
  }

  private async request<T>(
    url: string,
    init: RequestInit & { contentType?: string } = {},
  ): Promise<T> {
    const { contentType, ...rest } = init;
    const headers: Record<string, string> = {
      Authorization: await this.authHeader(),
      Accept: 'application/json',
      ...((rest.headers as Record<string, string> | undefined) ?? {}),
    };
    if (rest.body) {
      headers['Content-Type'] = contentType ?? 'application/json';
    }

    const response = await fetch(url, { ...rest, headers });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Azure DevOps ${init.method ?? 'GET'} ${new URL(url).pathname} failed: ` +
          `${response.status} ${response.statusText} - ${body.slice(0, 500)}`,
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /** Run a WIQL query and return the matching work item IDs. */
  async queryWorkItemIds(wiql: string): Promise<number[]> {
    const result = await this.request<{ workItems?: Array<{ id: number }> }>(
      `${this.projectUrl}/_apis/wit/wiql?api-version=${API_VERSION}`,
      { method: 'POST', body: JSON.stringify({ query: wiql }) },
    );
    return (result.workItems ?? []).map((w) => w.id);
  }

  /** Find work items eligible to be sent to GitHub. */
  async findReadyWorkItems(): Promise<number[]> {
    const { adoProject, readyTag, syncedTag } = this.config;
    // Escaping single quotes protects the WIQL string from a malformed project
    // or tag name. These values are operator-supplied config, not user input,
    // but defensive quoting costs nothing.
    const esc = (v: string) => v.replace(/'/g, "''");
    const wiql = `
      SELECT [System.Id]
      FROM WorkItems
      WHERE [System.TeamProject] = '${esc(adoProject)}'
        AND [System.Tags] CONTAINS '${esc(readyTag)}'
        AND NOT [System.Tags] CONTAINS '${esc(syncedTag)}'
        AND [System.State] <> 'Removed'
        AND [System.State] <> 'Done'
      ORDER BY [System.ChangedDate] DESC
    `.trim();
    return this.queryWorkItemIds(wiql);
  }

  async getWorkItem(id: number): Promise<WorkItem> {
    return this.request<WorkItem>(
      `${this.baseUrl}/_apis/wit/workitems/${id}?$expand=relations&api-version=${API_VERSION}`,
    );
  }

  async getWorkItems(ids: number[]): Promise<WorkItem[]> {
    if (ids.length === 0) return [];
    const results: WorkItem[] = [];
    // The batch endpoint caps at 200 ids per call.
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200);
      const response = await this.request<{ value: WorkItem[] }>(
        `${this.baseUrl}/_apis/wit/workitemsbatch?api-version=${API_VERSION}`,
        {
          method: 'POST',
          body: JSON.stringify({ ids: batch, $expand: 'relations' }),
        },
      );
      results.push(...response.value);
    }
    return results;
  }

  async getComments(id: number, top = 50): Promise<string[]> {
    try {
      const response = await this.request<{ comments?: Array<{ text?: string }> }>(
        `${this.projectUrl}/_apis/wit/workItems/${id}/comments?$top=${top}&api-version=7.1-preview.4`,
      );
      return (response.comments ?? []).map((c) => c.text ?? '').filter(Boolean);
    } catch {
      // Comments are enrichment, never a reason to fail a sync.
      return [];
    }
  }

  async updateWorkItem(id: number, operations: JsonPatchOperation[]): Promise<WorkItem> {
    return this.request<WorkItem>(
      `${this.baseUrl}/_apis/wit/workitems/${id}?api-version=${API_VERSION}`,
      {
        method: 'PATCH',
        body: JSON.stringify(operations),
        contentType: 'application/json-patch+json',
      },
    );
  }

  async addComment(id: number, text: string): Promise<void> {
    await this.request(
      `${this.projectUrl}/_apis/wit/workItems/${id}/comments?api-version=7.1-preview.3`,
      { method: 'POST', body: JSON.stringify({ text }) },
    );
  }

  /** True when the work item already links to the given URL. */
  static hasHyperlink(workItem: WorkItem, url: string): boolean {
    return (workItem.relations ?? []).some(
      (r) => r.rel === 'Hyperlink' && r.url?.toLowerCase() === url.toLowerCase(),
    );
  }

  static getTags(workItem: WorkItem): string[] {
    const raw = workItem.fields['System.Tags'];
    if (typeof raw !== 'string' || raw.trim() === '') return [];
    return raw
      .split(';')
      .map((t) => t.trim())
      .filter(Boolean);
  }

  static field(workItem: WorkItem, name: string): string {
    const value = workItem.fields[name];
    return typeof value === 'string' ? value : value == null ? '' : String(value);
  }

  workItemUrl(id: number): string {
    return `${this.projectUrl}/_workitems/edit/${id}`;
  }
}
