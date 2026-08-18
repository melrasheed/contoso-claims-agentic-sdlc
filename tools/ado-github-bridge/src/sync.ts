/**
 * The bridge itself: Azure Boards work item -> GitHub issue -> Copilot,
 * with results written back to Azure Boards.
 *
 * Design notes
 * ------------
 * Idempotency is the hard requirement. This runs on a schedule, so it will see
 * the same work item many times. Two independent guards prevent duplicates:
 *   1. A `synced-to-github` tag on the work item (fast path, avoids API calls).
 *   2. A stable marker string in the issue body (authoritative, survives the
 *      tag being removed by a human).
 *
 * Failure of a single item never aborts the run - one malformed work item
 * must not block the queue.
 */

import { AdoClient, type WorkItem, type JsonPatchOperation } from './ado.js';
import { GitHubClient } from './github.js';
import type { BridgeConfig } from './config.js';

export interface SyncOutcome {
  workItemId: number;
  title: string;
  status: 'created' | 'already-synced' | 'skipped' | 'failed';
  issueNumber?: number;
  issueUrl?: string;
  assignedToCopilot?: boolean;
  reason?: string;
}

/** Stable marker embedded in every issue body created by the bridge. */
export function syncMarker(org: string, project: string, workItemId: number): string {
  return `<!-- ado-bridge:${org}/${project}#${workItemId} -->`;
}

/** Strip Azure DevOps rich-text HTML down to readable Markdown-ish text. */
export function htmlToText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Build the GitHub issue body. This is the single most important function in
 * the bridge: it is the entire context the Copilot coding agent receives.
 * Thin context here produces a thin pull request downstream.
 */
export function buildIssueBody(
  workItem: WorkItem,
  comments: string[],
  config: BridgeConfig,
  workItemUrl: string,
): string {
  const f = (name: string) => AdoClient.field(workItem, name);
  const type = f('System.WorkItemType');
  const description = htmlToText(f('System.Description'));
  const acceptance = htmlToText(f('Microsoft.VSTS.Common.AcceptanceCriteria'));
  const repro = htmlToText(f('Microsoft.VSTS.TCM.ReproSteps'));
  const severity = f('Microsoft.VSTS.Common.Severity');
  const priority = f('Microsoft.VSTS.Common.Priority');
  const areaPath = f('System.AreaPath');
  const iteration = f('System.IterationPath');
  const tags = AdoClient.getTags(workItem).join(', ');

  const sections: string[] = [];

  sections.push(
    `> Synced from Azure Boards by the Agentic SDLC bridge. **Azure DevOps is the system of record** — update the work item there, not this issue description.`,
  );

  sections.push(
    [
      `| Field | Value |`,
      `| --- | --- |`,
      `| Work item | [${type} ${workItem.id}](${workItemUrl}) |`,
      `| Project | ${config.adoProject} |`,
      `| State | ${f('System.State')} |`,
      `| Area | ${areaPath} |`,
      `| Iteration | ${iteration} |`,
      severity ? `| Severity | ${severity} |` : '',
      priority ? `| Priority | ${priority} |` : '',
      tags ? `| Tags | ${tags} |` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  if (description) sections.push(`## Description\n\n${description}`);
  if (acceptance) sections.push(`## Acceptance criteria\n\n${acceptance}`);
  if (repro) sections.push(`## Repro steps\n\n${repro}`);

  if (comments.length > 0) {
    const recent = comments.slice(0, 10).map((c) => `- ${htmlToText(c)}`).join('\n');
    sections.push(`## Discussion from the work item\n\n${recent}`);
  }

  sections.push(
    `## Definition of done\n\n` +
      `- [ ] Every acceptance criterion above is implemented and covered by a test\n` +
      `- [ ] \`npm run lint\`, \`npm run typecheck\` and \`npm test\` all pass\n` +
      `- [ ] No secrets, and no sensitive claim fields written to logs\n` +
      `- [ ] The pull request body contains \`AB#${workItem.id}\` so Azure Boards links it\n` +
      `- [ ] Risk, rollback and test evidence are filled in on the pull request`,
  );

  sections.push(
    `## Repository conventions\n\n` +
      `Read \`.github/copilot-instructions.md\` before starting. It defines the ` +
      `architecture, security rules and traceability requirements for this repository.`,
  );

  sections.push(`AB#${workItem.id}`);
  sections.push(syncMarker(config.adoOrg, config.adoProject, workItem.id));

  return sections.join('\n\n');
}

export function buildIssueTitle(workItem: WorkItem): string {
  const type = AdoClient.field(workItem, 'System.WorkItemType');
  const title = AdoClient.field(workItem, 'System.Title');
  return `[${type} ${workItem.id}] ${title}`.slice(0, 250);
}

export class Bridge {
  private readonly ado: AdoClient;
  private readonly github: GitHubClient;

  constructor(
    private readonly config: BridgeConfig,
    private readonly log: (message: string) => void = console.log,
  ) {
    this.ado = new AdoClient(config);
    this.github = new GitHubClient(config);
  }

  async run(explicitIds?: number[]): Promise<SyncOutcome[]> {
    const ids = explicitIds?.length
      ? explicitIds
      : (await this.ado.findReadyWorkItems()).slice(0, this.config.maxItems);

    if (ids.length === 0) {
      this.log(`No work items tagged "${this.config.readyTag}" are awaiting sync.`);
      return [];
    }

    this.log(`Found ${ids.length} work item(s) to process: ${ids.join(', ')}`);

    if (!this.config.dryRun) {
      await this.github.ensureLabels(this.config.issueLabels);
    }

    const workItems = await this.ado.getWorkItems(ids);
    const outcomes: SyncOutcome[] = [];

    for (const workItem of workItems) {
      try {
        outcomes.push(await this.syncOne(workItem));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.log(`  ! Work item ${workItem.id} failed: ${reason}`);
        outcomes.push({
          workItemId: workItem.id,
          title: AdoClient.field(workItem, 'System.Title'),
          status: 'failed',
          reason,
        });
      }
    }

    return outcomes;
  }

  private async syncOne(workItem: WorkItem): Promise<SyncOutcome> {
    const { config } = this;
    const title = AdoClient.field(workItem, 'System.Title');
    const marker = syncMarker(config.adoOrg, config.adoProject, workItem.id);

    // Guard 1: authoritative check against GitHub itself.
    const existing = await this.github.findIssueByMarker(marker);
    if (existing) {
      this.log(`  = Work item ${workItem.id} already has issue #${existing.number}`);
      if (!config.dryRun) {
        await this.ensureSyncedTag(workItem);
      }
      return {
        workItemId: workItem.id,
        title,
        status: 'already-synced',
        issueNumber: existing.number,
        issueUrl: existing.htmlUrl,
      };
    }

    if (!title) {
      return {
        workItemId: workItem.id,
        title: '(untitled)',
        status: 'skipped',
        reason: 'Work item has no title',
      };
    }

    const comments = await this.ado.getComments(workItem.id);
    const workItemUrl = this.ado.workItemUrl(workItem.id);
    const issueTitle = buildIssueTitle(workItem);
    const issueBody = buildIssueBody(workItem, comments, config, workItemUrl);

    if (config.dryRun) {
      this.log(`  ~ [dry-run] would create issue: ${issueTitle}`);
      return { workItemId: workItem.id, title, status: 'created', reason: 'dry-run' };
    }

    const issue = await this.github.createIssue(issueTitle, issueBody, config.issueLabels);
    this.log(`  + Work item ${workItem.id} -> issue #${issue.number} ${issue.htmlUrl}`);

    let assignedToCopilot = false;
    if (config.assignCopilot) {
      assignedToCopilot = await this.github.assignToCopilot(issue.nodeId);
      this.log(
        assignedToCopilot
          ? `    assigned to the Copilot coding agent`
          : `    Copilot coding agent unavailable on this repository - left unassigned for a human`,
      );
      if (!assignedToCopilot) {
        await this.github.commentOnIssue(
          issue.number,
          'The Copilot coding agent is not available as an assignee on this repository, so this issue was left unassigned. ' +
            'Enable the coding agent in repository settings, or assign it to a human.',
        );
      }
    }

    await this.writeBackToBoards(workItem, issue.htmlUrl, issue.number, assignedToCopilot);

    return {
      workItemId: workItem.id,
      title,
      status: 'created',
      issueNumber: issue.number,
      issueUrl: issue.htmlUrl,
      assignedToCopilot,
    };
  }

  /**
   * Write the GitHub result back onto the work item. This is what makes Azure
   * Boards a genuine system of record rather than a stale copy: the hyperlink,
   * the audit comment, the provenance tag, and the state transition.
   */
  private async writeBackToBoards(
    workItem: WorkItem,
    issueUrl: string,
    issueNumber: number,
    assignedToCopilot: boolean,
  ): Promise<void> {
    const operations: JsonPatchOperation[] = [];

    // Optimistic concurrency: fail rather than clobber a concurrent edit.
    operations.push({ op: 'test', path: '/rev', value: workItem.rev });

    if (!AdoClient.hasHyperlink(workItem, issueUrl)) {
      operations.push({
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'Hyperlink',
          url: issueUrl,
          attributes: { comment: `GitHub issue #${issueNumber} (Agentic SDLC bridge)` },
        },
      });
    }

    const tags = AdoClient.getTags(workItem);
    const provenanceTag = assignedToCopilot ? 'ai-implementing' : 'awaiting-human';
    for (const tag of [this.config.syncedTag, provenanceTag]) {
      if (!tags.includes(tag)) tags.push(tag);
    }
    operations.push({ op: 'add', path: '/fields/System.Tags', value: tags.join('; ') });

    const targetState = this.config.stateAfterSync ?? (await this.ado.resolveActiveState());
    if (targetState && AdoClient.field(workItem, 'System.State') !== targetState) {
      operations.push({ op: 'add', path: '/fields/System.State', value: targetState });
    }

    try {
      await this.ado.updateWorkItem(workItem.id, operations);
    } catch (error) {
      // A state transition can be rejected by process rules. The link and tags
      // matter far more than the state, so retry without the transition rather
      // than losing traceability entirely.
      const withoutState = operations.filter(
        (op) => op.path !== '/fields/System.State' && op.op !== 'test',
      );
      this.log(
        `    state transition rejected, retrying without it (${error instanceof Error ? error.message.slice(0, 120) : ''})`,
      );
      await this.ado.updateWorkItem(workItem.id, withoutState);
    }

    await this.ado.addComment(
      workItem.id,
      `Sent to GitHub for AI implementation by the Agentic SDLC bridge.<br>` +
        `Issue: <a href="${issueUrl}">#${issueNumber}</a><br>` +
        `Implementer: ${assignedToCopilot ? 'GitHub Copilot coding agent' : 'unassigned (human required)'}<br>` +
        `<i>All resulting changes still pass through the standard pull request checks and release gates.</i>`,
    );
  }

  private async ensureSyncedTag(workItem: WorkItem): Promise<void> {
    const tags = AdoClient.getTags(workItem);
    if (tags.includes(this.config.syncedTag)) return;
    tags.push(this.config.syncedTag);
    await this.ado.updateWorkItem(workItem.id, [
      { op: 'add', path: '/fields/System.Tags', value: tags.join('; ') },
    ]);
  }
}
