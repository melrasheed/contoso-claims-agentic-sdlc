import { describe, it, expect } from 'vitest';
import { htmlToText, buildIssueBody, buildIssueTitle, syncMarker } from './sync.js';
import { AdoClient, type WorkItem } from './ado.js';
import type { BridgeConfig } from './config.js';

const config: BridgeConfig = {
  adoOrg: 'contoso',
  adoProject: 'Agentic SDLC',
  ghOwner: 'contoso',
  ghRepo: 'claims',
  ghToken: 'placeholder-not-a-real-token',
  readyTag: 'ai-ready',
  syncedTag: 'synced-to-github',
  issueLabels: ['from-azure-boards'],
  assignCopilot: true,
  stateAfterSync: 'Committed',
  stateAfterMerge: 'Done',
  dryRun: false,
  maxItems: 25,
};

function workItem(fields: Record<string, unknown> = {}, id = 42): WorkItem {
  return {
    id,
    rev: 3,
    url: `https://dev.azure.com/contoso/_apis/wit/workItems/${id}`,
    fields: {
      'System.WorkItemType': 'Product Backlog Item',
      'System.Title': 'Require second approval for high-value claims',
      'System.State': 'Approved',
      'System.AreaPath': 'Agentic SDLC',
      'System.IterationPath': 'Agentic SDLC\\Sprint 1',
      ...fields,
    },
  };
}

describe('htmlToText', () => {
  it('converts Azure DevOps rich text into readable plain text', () => {
    const html = '<div>First line</div><br><ul><li>alpha</li><li>beta</li></ul>';
    const text = htmlToText(html);
    expect(text).toContain('First line');
    expect(text).toContain('- alpha');
    expect(text).toContain('- beta');
    expect(text).not.toContain('<');
  });

  it('decodes HTML entities so criteria stay readable', () => {
    expect(htmlToText('<p>amount &gt; 50 &amp;&nbsp;approved</p>')).toBe('amount > 50 & approved');
  });

  it('collapses excessive blank lines', () => {
    expect(htmlToText('<p>a</p><p></p><p></p><p>b</p>')).toBe('a\n\nb');
  });

  it('returns an empty string for empty input', () => {
    expect(htmlToText('')).toBe('');
  });
});

describe('syncMarker', () => {
  it('is stable for the same work item', () => {
    expect(syncMarker('contoso', 'Agentic SDLC', 42)).toBe(
      syncMarker('contoso', 'Agentic SDLC', 42),
    );
  });

  it('differs across work items, projects and organisations', () => {
    const a = syncMarker('contoso', 'Agentic SDLC', 42);
    expect(a).not.toBe(syncMarker('contoso', 'Agentic SDLC', 43));
    expect(a).not.toBe(syncMarker('contoso', 'Other', 42));
    expect(a).not.toBe(syncMarker('fabrikam', 'Agentic SDLC', 42));
  });

  it('is an HTML comment so it stays invisible in the rendered issue', () => {
    const marker = syncMarker('contoso', 'Agentic SDLC', 42);
    expect(marker.startsWith('<!--')).toBe(true);
    expect(marker.endsWith('-->')).toBe(true);
  });
});

describe('buildIssueTitle', () => {
  it('prefixes the work item type and id for scannability', () => {
    expect(buildIssueTitle(workItem())).toBe(
      '[Product Backlog Item 42] Require second approval for high-value claims',
    );
  });

  it('truncates titles that would exceed the GitHub limit', () => {
    const long = buildIssueTitle(workItem({ 'System.Title': 'x'.repeat(400) }));
    expect(long.length).toBeLessThanOrEqual(250);
  });
});

describe('buildIssueBody', () => {
  const url = 'https://dev.azure.com/contoso/Agentic%20SDLC/_workitems/edit/42';

  it('embeds the AB# token so Azure Boards links the resulting pull request', () => {
    const body = buildIssueBody(workItem(), [], config, url);
    expect(body).toContain('AB#42');
  });

  it('embeds the idempotency marker', () => {
    const body = buildIssueBody(workItem(), [], config, url);
    expect(body).toContain(syncMarker('contoso', 'Agentic SDLC', 42));
  });

  it('includes acceptance criteria, which are the agent contract', () => {
    const body = buildIssueBody(
      workItem({
        'Microsoft.VSTS.Common.AcceptanceCriteria':
          '<div>Given a claim over 50000<br>Then a second approver is required</div>',
      }),
      [],
      config,
      url,
    );
    expect(body).toContain('## Acceptance criteria');
    expect(body).toContain('Given a claim over 50000');
    expect(body).toContain('Then a second approver is required');
  });

  it('includes repro steps for bugs', () => {
    const body = buildIssueBody(
      workItem({ 'System.WorkItemType': 'Bug', 'Microsoft.VSTS.TCM.ReproSteps': '<p>Call POST twice</p>' }),
      [],
      config,
      url,
    );
    expect(body).toContain('## Repro steps');
    expect(body).toContain('Call POST twice');
  });

  it('omits sections that have no content rather than emitting empty headings', () => {
    const body = buildIssueBody(workItem(), [], config, url);
    expect(body).not.toContain('## Acceptance criteria');
    expect(body).not.toContain('## Repro steps');
    expect(body).not.toContain('## Discussion');
  });

  it('caps work item discussion at ten comments to bound the context', () => {
    const comments = Array.from({ length: 30 }, (_, i) => `<p>comment ${i}</p>`);
    const body = buildIssueBody(workItem(), comments, config, url);
    expect(body).toContain('comment 0');
    expect(body).toContain('comment 9');
    expect(body).not.toContain('comment 10');
  });

  it('points the agent at the repository conventions', () => {
    const body = buildIssueBody(workItem(), [], config, url);
    expect(body).toContain('.github/copilot-instructions.md');
  });

  it('links back to the work item and names Azure DevOps as the system of record', () => {
    const body = buildIssueBody(workItem(), [], config, url);
    expect(body).toContain(url);
    expect(body).toContain('system of record');
  });
});

describe('AdoClient helpers', () => {
  it('parses semicolon-delimited tags', () => {
    expect(AdoClient.getTags(workItem({ 'System.Tags': 'ai-ready; security ; urgent' }))).toEqual([
      'ai-ready',
      'security',
      'urgent',
    ]);
  });

  it('returns an empty array when there are no tags', () => {
    expect(AdoClient.getTags(workItem())).toEqual([]);
    expect(AdoClient.getTags(workItem({ 'System.Tags': '   ' }))).toEqual([]);
  });

  it('detects an existing hyperlink case-insensitively so re-runs do not duplicate links', () => {
    const item: WorkItem = {
      ...workItem(),
      relations: [{ rel: 'Hyperlink', url: 'https://github.com/contoso/claims/issues/7' }],
    };
    expect(AdoClient.hasHyperlink(item, 'https://GitHub.com/contoso/claims/issues/7')).toBe(true);
    expect(AdoClient.hasHyperlink(item, 'https://github.com/contoso/claims/issues/8')).toBe(false);
  });

  it('reads fields defensively', () => {
    expect(AdoClient.field(workItem(), 'System.Title')).toBe(
      'Require second approval for high-value claims',
    );
    expect(AdoClient.field(workItem(), 'Does.Not.Exist')).toBe('');
  });
});
