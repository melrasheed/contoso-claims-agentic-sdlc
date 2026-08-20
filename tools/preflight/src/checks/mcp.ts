import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { errorMessage } from '../exec.js';
import type { CheckResult, PreflightContext } from '../types.js';

const CATEGORY = 'MCP' as const;

/** Copilot CLI reads `mcpServers`; VS Code reads `servers` from .vscode/mcp.json. */
export const COPILOT_MCP_CONFIG = join(homedir(), '.copilot', 'mcp-config.json');

export const CORRECT_ADO_MCP_HOST = 'mcp.dev.azure.com';
export const WRONG_ADO_MCP_HOST = 'dev.azure.com';

export interface McpServerEntry {
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
  tools?: string[];
}

export interface McpConfig {
  mcpServers?: Record<string, McpServerEntry>;
  /** VS Code schema - wrong key for ~/.copilot/mcp-config.json. */
  servers?: Record<string, McpServerEntry>;
}

/** Pure: pulls every URL-looking string out of an MCP server entry. */
export function collectEntryUrls(entry: McpServerEntry | undefined): string[] {
  if (!entry) return [];
  const candidates = [entry.url, ...(entry.args ?? [])];
  return candidates.filter((c): c is string => typeof c === 'string' && /^https?:\/\//i.test(c));
}

/**
 * Pure: validates an already-parsed `~/.copilot/mcp-config.json`.
 * `config === undefined` means "file not present".
 */
export function evaluateMcpConfig(config: McpConfig | undefined, org: string, path = COPILOT_MCP_CONFIG): CheckResult[] {
  const results: CheckResult[] = [];
  const expectedUrl = `https://${CORRECT_ADO_MCP_HOST}/${org}`;

  if (!config) {
    results.push({
      id: 'mcp.config',
      category: CATEGORY,
      name: 'Copilot MCP config present',
      status: 'warn',
      detail: `${path} not found - the Azure DevOps MCP server is not wired into Copilot CLI`,
      hint: `Create ${path} with {"mcpServers":{"azure-devops":{"type":"http","url":"${expectedUrl}","tools":["*"]}}} (VS Code instead uses "servers" in .vscode/mcp.json).`
    });
    results.push({
      id: 'mcp.azure-devops',
      category: CATEGORY,
      name: 'azure-devops MCP endpoint',
      status: 'warn',
      detail: 'Skipped - no MCP config file',
      hint: `Add an "azure-devops" entry pointing at ${expectedUrl}.`
    });
    return results;
  }

  const usesVsCodeKey = !config.mcpServers && Boolean(config.servers);
  const servers = config.mcpServers ?? config.servers ?? {};
  const names = Object.keys(servers);

  results.push({
    id: 'mcp.config',
    category: CATEGORY,
    name: 'Copilot MCP config present',
    status: usesVsCodeKey ? 'fail' : 'pass',
    detail: usesVsCodeKey
      ? `${path} uses the VS Code "servers" key; Copilot CLI only reads "mcpServers"`
      : `${path} defines ${names.length} server(s): ${names.join(', ') || 'none'}`,
    ...(usesVsCodeKey
      ? { hint: `Rename the top-level "servers" key to "mcpServers" in ${path}; keep "servers" only in .vscode/mcp.json.` }
      : {}),
    meta: { path, servers: names, key: usesVsCodeKey ? 'servers' : 'mcpServers' }
  });

  const entry = servers['azure-devops'];
  if (!entry) {
    results.push({
      id: 'mcp.azure-devops',
      category: CATEGORY,
      name: 'azure-devops MCP endpoint',
      status: 'warn',
      detail: `No "azure-devops" entry in ${path}`,
      hint: `Add {"azure-devops":{"type":"http","url":"${expectedUrl}","tools":["*"]}} under "mcpServers".`,
      meta: { expectedUrl }
    });
    return results;
  }

  const urls = collectEntryUrls(entry);
  const wrong = urls.filter((u) => {
    try {
      return new URL(u).host.toLowerCase() === WRONG_ADO_MCP_HOST;
    } catch {
      return false;
    }
  });
  const correct = urls.filter((u) => {
    try {
      return new URL(u).host.toLowerCase() === CORRECT_ADO_MCP_HOST;
    } catch {
      return false;
    }
  });

  if (wrong.length > 0) {
    results.push({
      id: 'mcp.azure-devops',
      category: CATEGORY,
      name: 'azure-devops MCP endpoint',
      status: 'fail',
      detail: `"azure-devops" points at ${wrong.join(', ')} - that is the Azure DevOps web/REST host, not the MCP host, so the server will never connect`,
      hint: `Edit ${path} and set the azure-devops url to "${expectedUrl}" (host must be ${CORRECT_ADO_MCP_HOST}).`,
      meta: { configuredUrls: urls, expectedUrl }
    });
    return results;
  }

  if (correct.length === 0) {
    results.push({
      id: 'mcp.azure-devops',
      category: CATEGORY,
      name: 'azure-devops MCP endpoint',
      status: 'warn',
      detail: `"azure-devops" entry has no ${CORRECT_ADO_MCP_HOST} URL (found: ${urls.join(', ') || 'none'})`,
      hint: `Set the azure-devops url to "${expectedUrl}" in ${path}.`,
      meta: { configuredUrls: urls, expectedUrl }
    });
    return results;
  }

  const matchesOrg = correct.some((u) => new URL(u).pathname.replace(/^\/+|\/+$/g, '').toLowerCase() === org.toLowerCase());
  results.push({
    id: 'mcp.azure-devops',
    category: CATEGORY,
    name: 'azure-devops MCP endpoint',
    status: matchesOrg ? 'pass' : 'warn',
    detail: matchesOrg
      ? `azure-devops -> ${correct.join(', ')}`
      : `azure-devops -> ${correct.join(', ')} but the expected organization is "${org}"`,
    ...(matchesOrg ? {} : { hint: `Set the azure-devops url to "${expectedUrl}" in ${path}, or set $env:ADO_ORG to match.` }),
    meta: { configuredUrls: correct, expectedUrl }
  });

  return results;
}

export async function runMcpChecks(ctx: PreflightContext): Promise<CheckResult[]> {
  try {
    let config: McpConfig | undefined;
    try {
      const raw = await readFile(COPILOT_MCP_CONFIG, 'utf8');
      config = JSON.parse(raw) as McpConfig;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return evaluateMcpConfig(undefined, ctx.adoOrg);
      }
      return [
        {
          id: 'mcp.config',
          category: CATEGORY,
          name: 'Copilot MCP config present',
          status: 'fail',
          detail: `${COPILOT_MCP_CONFIG} could not be parsed: ${errorMessage(err)}`,
          hint: `Fix the JSON in ${COPILOT_MCP_CONFIG} (Copilot CLI expects a top-level "mcpServers" object).`
        }
      ];
    }
    return evaluateMcpConfig(config, ctx.adoOrg);
  } catch (err) {
    return [
      {
        id: 'mcp.config',
        category: CATEGORY,
        name: 'Copilot MCP config present',
        status: 'warn',
        detail: `MCP check could not complete: ${errorMessage(err)}`,
        hint: `Inspect ${COPILOT_MCP_CONFIG} manually.`
      }
    ];
  }
}
