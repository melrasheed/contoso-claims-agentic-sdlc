import { describe, expect, it } from 'vitest';
import { compareProcessTemplate, buildAiReadyWiql, evaluateWorkItemTypes, resolveProcessTemplateName } from './checks/azure-devops.js';
import { evaluateProviderState, evaluateRoles } from './checks/azure.js';
import { evaluateCopilotActor, evaluateTokenScopes, parseTokenScopes } from './checks/github.js';
import { collectEntryUrls, evaluateMcpConfig } from './checks/mcp.js';
import { evaluateAzLogin, evaluateNodeVersion, parseNodeMajor } from './checks/tooling.js';
import { firstLine, redact } from './exec.js';
import { parseArgs, resolveContext } from './index.js';
import { buildReport, exitCodeFor, renderSummary, renderTable, summarize } from './reporter.js';
import type { CheckResult } from './types.js';

const GH_AUTH_STATUS = `github.com
  ✓ Logged in to github.com account melrasheed (GH_TOKEN)
  - Active account: true
  - Token: gho_************************************
  - Token scopes: 'gist', 'repo', 'user'

  ✓ Logged in to github.com account melrasheed (keyring)
  - Active account: false
  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'
`;

describe('tooling checks', () => {
  it('parses node major versions', () => {
    expect(parseNodeMajor('v20.11.1')).toBe(20);
    expect(parseNodeMajor('24.12.0')).toBe(24);
    expect(parseNodeMajor('not-a-version')).toBeUndefined();
  });

  it('fails below node 20 and passes on 20+', () => {
    expect(evaluateNodeVersion('v18.20.4').status).toBe('fail');
    expect(evaluateNodeVersion('v20.11.1').status).toBe('pass');
    expect(evaluateNodeVersion('v24.12.0').status).toBe('pass');
  });

  it('always attaches an actionable hint on failure', () => {
    const result = evaluateNodeVersion('v18.20.4');
    expect(result.hint).toBeTruthy();
    expect(result.hint).toMatch(/nvm install 20|winget install/);
  });

  it('evaluates az login state', () => {
    expect(evaluateAzLogin(undefined).status).toBe('fail');
    expect(evaluateAzLogin({ id: 'sub-1', name: 'Demo' }).status).toBe('pass');
    expect(evaluateAzLogin({ id: 'sub-1', name: 'Demo' }).detail).toContain('Demo');
  });
});

describe('github checks', () => {
  it('reads scopes from the active account only', () => {
    expect(parseTokenScopes(GH_AUTH_STATUS)).toEqual(['gist', 'repo', 'user']);
  });

  it('returns an empty scope list when gh prints nothing useful', () => {
    expect(parseTokenScopes('not logged in')).toEqual([]);
  });

  it('warns when the workflow scope is missing', () => {
    const result = evaluateTokenScopes(['gist', 'repo', 'user']);
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('workflow');
    expect(result.hint).toContain('gh auth refresh');
  });

  it('passes when the workflow scope is present', () => {
    expect(evaluateTokenScopes(['repo', 'workflow']).status).toBe('pass');
  });

  it('detects the copilot coding agent among suggested actors', () => {
    const result = evaluateCopilotActor([
      { login: 'copilot-swe-agent', __typename: 'Bot' },
      { login: 'melrasheed', __typename: 'User' }
    ]);
    expect(result.status).toBe('pass');
  });

  it('fails when the copilot coding agent is not assignable', () => {
    const result = evaluateCopilotActor([{ login: 'melrasheed', __typename: 'User' }]);
    expect(result.status).toBe('fail');
    expect(result.hint).toContain('Coding agent');
  });
});

describe('azure devops checks', () => {
  it('passes when capability and property agree', () => {
    expect(compareProcessTemplate('Basic', 'Basic').status).toBe('pass');
    expect(compareProcessTemplate('Basic', undefined).status).toBe('pass');
  });

  it('warns when the System.Process Template property disagrees', () => {
    const result = compareProcessTemplate('Basic', 'Agile');
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('Basic');
    expect(result.detail).toContain('Agile');
  });

  it('warns when no template name is returned at all', () => {
    expect(compareProcessTemplate(undefined, undefined).status).toBe('warn');
  });

  it('reports the real work item types', () => {
    const result = evaluateWorkItemTypes(['Epic', 'Issue', 'Task']);
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('Epic, Issue, Task');
    expect(evaluateWorkItemTypes([]).status).toBe('fail');
  });

  it('builds a WIQL query that escapes quotes in the project name', () => {
    expect(buildAiReadyWiql('Agentic SDLC')).toContain("[System.TeamProject] = 'Agentic SDLC'");
    expect(buildAiReadyWiql("O'Brien")).toContain("'O''Brien'");
    expect(buildAiReadyWiql('Agentic SDLC')).toContain("[System.Tags] CONTAINS 'ai-ready'");
  });

  it('resolves the System.Process Template property whether it holds a GUID or a name', () => {
    const processes = [
      { id: 'b8a3a935-7e91-48b8-a94c-606d37c3e9f2', name: 'Basic' },
      { id: '6b724908-ef14-45cf-84f8-768b5384da45', name: 'Scrum' }
    ];
    expect(resolveProcessTemplateName('b8a3a935-7e91-48b8-a94c-606d37c3e9f2', processes)).toBe('Basic');
    // Real-world case: the legacy property stores a stale plain name.
    expect(resolveProcessTemplateName('Scrum', processes)).toBe('Scrum');
    expect(resolveProcessTemplateName(undefined, processes)).toBeUndefined();
    expect(resolveProcessTemplateName('00000000-0000-0000-0000-000000000000', processes)).toBeUndefined();
  });
});

describe('azure checks', () => {
  it('maps provider registration states', () => {
    expect(evaluateProviderState('Microsoft.App', 'Registered').status).toBe('pass');
    expect(evaluateProviderState('Microsoft.App', 'Registering').status).toBe('warn');
    expect(evaluateProviderState('Microsoft.App', 'NotRegistered').status).toBe('fail');
    expect(evaluateProviderState('Microsoft.App', 'NotRegistered').hint).toContain('az provider register');
    expect(evaluateProviderState('Microsoft.App', undefined).status).toBe('warn');
  });

  it('degrades gracefully when roles cannot be listed', () => {
    expect(evaluateRoles([]).status).toBe('warn');
  });

  it('passes when a write-capable role is present', () => {
    expect(evaluateRoles(['Reader', 'Contributor']).status).toBe('pass');
    expect(evaluateRoles(['Reader']).status).toBe('warn');
  });
});

describe('mcp checks', () => {
  it('collects urls from url and args', () => {
    expect(collectEntryUrls({ url: 'https://mcp.dev.azure.com/org' })).toEqual(['https://mcp.dev.azure.com/org']);
    expect(collectEntryUrls({ command: 'npx', args: ['-y', 'pkg', 'https://mcp.dev.azure.com/org'] })).toEqual([
      'https://mcp.dev.azure.com/org'
    ]);
    expect(collectEntryUrls(undefined)).toEqual([]);
  });

  it('passes on the correct mcp host', () => {
    const results = evaluateMcpConfig(
      { mcpServers: { 'azure-devops': { type: 'http', url: 'https://mcp.dev.azure.com/melrasheed' } } },
      'melrasheed'
    );
    expect(results.find((r) => r.id === 'mcp.azure-devops')?.status).toBe('pass');
  });

  it('FAILS explicitly when pointed at dev.azure.com instead of mcp.dev.azure.com', () => {
    const results = evaluateMcpConfig(
      { mcpServers: { 'azure-devops': { type: 'http', url: 'https://dev.azure.com/melrasheed' } } },
      'melrasheed'
    );
    const entry = results.find((r) => r.id === 'mcp.azure-devops');
    expect(entry?.status).toBe('fail');
    expect(entry?.detail).toContain('dev.azure.com');
    expect(entry?.hint).toContain('mcp.dev.azure.com');
  });

  it('fails when the VS Code "servers" key is used in the Copilot CLI config', () => {
    const results = evaluateMcpConfig(
      { servers: { 'azure-devops': { type: 'http', url: 'https://mcp.dev.azure.com/melrasheed' } } },
      'melrasheed'
    );
    const config = results.find((r) => r.id === 'mcp.config');
    expect(config?.status).toBe('fail');
    expect(config?.hint).toContain('mcpServers');
  });

  it('warns when the config file is absent', () => {
    const results = evaluateMcpConfig(undefined, 'melrasheed');
    expect(results.every((r) => r.status === 'warn')).toBe(true);
  });

  it('warns when the org in the url does not match', () => {
    const results = evaluateMcpConfig(
      { mcpServers: { 'azure-devops': { type: 'http', url: 'https://mcp.dev.azure.com/other-org' } } },
      'melrasheed'
    );
    expect(results.find((r) => r.id === 'mcp.azure-devops')?.status).toBe('warn');
  });

  it('warns when there is no azure-devops entry', () => {
    const results = evaluateMcpConfig({ mcpServers: { 'microsoft-learn': { url: 'https://learn.microsoft.com/api/mcp' } } }, 'melrasheed');
    expect(results.find((r) => r.id === 'mcp.azure-devops')?.status).toBe('warn');
  });
});

describe('reporter', () => {
  const results: CheckResult[] = [
    { id: 'a', category: 'Tooling', name: 'A', status: 'pass', detail: 'ok' },
    { id: 'b', category: 'GitHub', name: 'B', status: 'warn', detail: 'hmm', hint: 'do this' },
    { id: 'c', category: 'MCP', name: 'C', status: 'fail', detail: 'bad', hint: 'fix this' }
  ];

  it('counts statuses', () => {
    expect(summarize(results)).toEqual({ pass: 1, warn: 1, fail: 1, total: 3 });
  });

  it('exits 1 when anything failed and 0 otherwise', () => {
    const ctx = resolveContext({});
    expect(exitCodeFor(buildReport(results, ctx))).toBe(1);
    expect(exitCodeFor(buildReport(results.slice(0, 2), ctx))).toBe(0);
  });

  it('renders an aligned, ANSI-free table when colors are disabled', () => {
    const table = renderTable(results, false);
    expect(table).not.toMatch(/\u001b\[/);
    expect(table).toContain('FAIL');
    const rows = table.split('\n').filter((l) => l.startsWith('|'));
    const widths = new Set(rows.map((l) => l.length));
    expect(widths.size).toBe(1);
  });

  it('renders the summary counts', () => {
    expect(renderSummary(summarize(results), false)).toBe('1 passed  |  1 warnings  |  1 failures  |  3 checks total');
  });
});

describe('cli', () => {
  it('parses flags', () => {
    expect(parseArgs(['--json'])).toEqual({ json: true, help: false });
    expect(parseArgs(['-h'])).toEqual({ json: false, help: true });
    expect(parseArgs([])).toEqual({ json: false, help: false });
  });

  it('falls back to accelerator defaults and honours env overrides', () => {
    const defaults = resolveContext({});
    expect(defaults.adoOrg).toBe('melrasheed');
    expect(defaults.adoProject).toBe('Agentic SDLC');
    expect(defaults.ghRepo).toBe('contoso-claims-agentic-sdlc');

    const overridden = resolveContext({ ADO_ORG: 'contoso', GH_REPO: 'other', ADO_PROJECT: '  ' });
    expect(overridden.adoOrg).toBe('contoso');
    expect(overridden.ghRepo).toBe('other');
    expect(overridden.adoProject).toBe('Agentic SDLC');
  });
});

describe('secret hygiene', () => {
  it('redacts github tokens', () => {
    expect(redact('token ghp_abcdefghijklmnopqrstuvwxyz0123456789')).not.toContain('ghp_abcdefghij');
    expect(redact('Authorization: Bearer eyJ0eXAiOiJKV1Qi.abc')).toContain('Bearer ***redacted***');
  });

  it('collapses multiline output to a single redacted line', () => {
    expect(firstLine('\n  gh version 2.62.0\nhttps://example.com\n')).toBe('gh version 2.62.0');
  });
});
