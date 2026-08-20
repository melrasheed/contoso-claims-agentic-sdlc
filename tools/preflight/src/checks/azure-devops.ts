import { errorMessage, run, safeCheck } from '../exec.js';
import type { CheckResult, PreflightContext } from '../types.js';

const CATEGORY = 'Azure DevOps' as const;

/** Azure DevOps first-party AAD resource id (used to mint a token via `az`). */
const ADO_RESOURCE_ID = '499b84ac-1321-427f-aa17-267ca6975798';
const API = 'api-version=7.1';

interface AdoAuth {
  header: string;
  /** Where the credential came from - never the credential itself. */
  source: 'ADO_PAT' | 'AZURE_DEVOPS_EXT_PAT' | 'SYSTEM_ACCESSTOKEN' | 'az-cli';
}

interface AdoResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

let cachedAuth: AdoAuth | null | undefined;

async function getAdoAuth(): Promise<AdoAuth | undefined> {
  if (cachedAuth !== undefined) return cachedAuth ?? undefined;

  const patSources: AdoAuth['source'][] = ['ADO_PAT', 'AZURE_DEVOPS_EXT_PAT', 'SYSTEM_ACCESSTOKEN'];
  for (const source of patSources) {
    const pat = process.env[source];
    if (pat && pat.trim().length > 0) {
      cachedAuth = {
        header: `Basic ${Buffer.from(`:${pat.trim()}`).toString('base64')}`,
        source
      };
      return cachedAuth;
    }
  }

  const res = await run('az', ['account', 'get-access-token', '--resource', ADO_RESOURCE_ID, '-o', 'json'], {
    timeoutMs: 90_000
  });
  if (res.ok) {
    try {
      const token = (JSON.parse(res.stdout) as { accessToken?: string }).accessToken;
      if (token) {
        cachedAuth = { header: `Bearer ${token}`, source: 'az-cli' };
        return cachedAuth;
      }
    } catch {
      /* fall through */
    }
  }
  cachedAuth = null;
  return undefined;
}

async function adoFetch<T>(url: string, init?: RequestInit): Promise<AdoResponse<T>> {
  const auth = await getAdoAuth();
  if (!auth) return { ok: false, status: 0, error: 'no-credential' };
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: auth.header,
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {})
      },
      signal: AbortSignal.timeout(45_000)
    });
    // Azure DevOps answers unauthenticated calls with a 203 sign-in page.
    if (res.status === 203) return { ok: false, status: 203, error: 'unauthenticated' };
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    const contentType = res.headers.get('content-type') ?? '';
    const text = await res.text();
    // A 200 with an HTML body is Azure DevOps serving its sign-in page.
    if (!contentType.includes('json') && text.trimStart().startsWith('<')) {
      return { ok: false, status: res.status, error: 'unauthenticated or resource not found (HTML response)' };
    }
    if (text.trim().length === 0) return { ok: true, status: res.status };
    return { ok: true, status: res.status, data: JSON.parse(text) as T };
  } catch (err) {
    return { ok: false, status: 0, error: errorMessage(err) };
  }
}

/** Pure: `capabilities.processTemplate.templateName` vs the `System.Process Template` property. */
export function compareProcessTemplate(
  capabilityTemplateName: string | undefined,
  propertyTemplateName: string | undefined
): CheckResult {
  if (!capabilityTemplateName) {
    return {
      id: 'ado.process-template',
      category: CATEGORY,
      name: 'Process template',
      status: 'warn',
      detail: 'Project returned no capabilities.processTemplate.templateName',
      hint: 'Re-query with `?includeCapabilities=true`, or check Azure DevOps -> Project settings -> Overview -> Process.'
    };
  }
  if (propertyTemplateName && propertyTemplateName !== capabilityTemplateName) {
    return {
      id: 'ado.process-template',
      category: CATEGORY,
      name: 'Process template',
      status: 'warn',
      detail: `Authoritative process (capabilities.processTemplate.templateName) is "${capabilityTemplateName}" but the legacy "System.Process Template" property resolves to "${propertyTemplateName}". Tooling that reads the legacy property will attempt to create work item types that do not exist in this project, producing "VS402323: Work item type <X> does not exist in project" errors.`,
      hint: `Always use capabilities.processTemplate.templateName as the source of truth. For this project the valid work item types are only those returned by the "${capabilityTemplateName}" process. Ignore or discard the "System.Process Template" property value.`,
      meta: { capabilityTemplateName, propertyTemplateName }
    };
  }
  return {
    id: 'ado.process-template',
    category: CATEGORY,
    name: 'Process template',
    status: 'pass',
    detail: `Process template: ${capabilityTemplateName}${propertyTemplateName ? ' (property agrees)' : ''}`,
    meta: { capabilityTemplateName, propertyTemplateName }
  };
}

/** Pure: reports the real work item types available in the project. */
export function evaluateWorkItemTypes(names: string[]): CheckResult {
  if (names.length === 0) {
    return {
      id: 'ado.work-item-types',
      category: CATEGORY,
      name: 'Work item types',
      status: 'fail',
      detail: 'No work item types returned for the project',
      hint: 'Verify the project name (ADO_PROJECT) and that your identity has "View project-level information" permission.'
    };
  }
  return {
    id: 'ado.work-item-types',
    category: CATEGORY,
    name: 'Work item types',
    status: 'pass',
    detail: `${names.length} types: ${names.join(', ')}`,
    meta: { workItemTypes: names }
  };
}

/**
 * Pure: the legacy `System.Process Template` property holds either a process id
 * (GUID) or a bare template name, so both shapes are resolved to a name.
 */
export function resolveProcessTemplateName(
  propertyValue: string | undefined,
  processes: Array<{ id?: string; typeId?: string; name?: string }>
): string | undefined {
  if (!propertyValue) return undefined;
  const value = propertyValue.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return value;
  const match = processes.find(
    (p) => p.id?.toLowerCase() === value.toLowerCase() || p.typeId?.toLowerCase() === value.toLowerCase()
  );
  return match?.name;
}

export async function runAzureDevOpsChecks(ctx: PreflightContext): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const org = ctx.adoOrg;
  const project = ctx.adoProject;
  const base = `https://dev.azure.com/${encodeURIComponent(org)}`;
  const projectPath = `${base}/${encodeURIComponent(project)}`;
  let projectId: string | undefined;
  let reachable = false;

  results.push(
    await safeCheck('ado.org', CATEGORY, 'Organization reachable', async () => {
      const auth = await getAdoAuth();
      if (!auth) {
        return {
          id: 'ado.org',
          category: CATEGORY,
          name: 'Organization reachable',
          status: 'fail' as const,
          detail: 'No Azure DevOps credential available',
          hint: 'Run `az login` (the CLI token is used automatically) or set $env:ADO_PAT to a PAT with "Work Items (Read & write)".'
        };
      }
      const res = await adoFetch<{ count?: number }>(`${base}/_apis/projects?${API}&$top=1`);
      if (!res.ok) {
        return {
          id: 'ado.org',
          category: CATEGORY,
          name: 'Organization reachable',
          status: 'fail' as const,
          detail: `https://dev.azure.com/${org} not reachable (${res.error ?? 'unknown error'}), credential source: ${auth.source}`,
          hint: `Verify the org name, then run \`az devops configure --defaults organization=https://dev.azure.com/${org}\` and \`az devops project list\`.`
        };
      }
      reachable = true;
      return {
        id: 'ado.org',
        category: CATEGORY,
        name: 'Organization reachable',
        status: 'pass' as const,
        detail: `https://dev.azure.com/${org} reachable (credential: ${auth.source})`,
        meta: { org, credentialSource: auth.source }
      };
    })
  );

  const projectRes = reachable
    ? await adoFetch<{
        id?: string;
        name?: string;
        state?: string;
        capabilities?: { processTemplate?: { templateName?: string; templateTypeId?: string } };
      }>(`${base}/_apis/projects/${encodeURIComponent(project)}?includeCapabilities=true&${API}`)
    : undefined;

  results.push(
    await safeCheck('ado.project', CATEGORY, 'Project exists', async () => {
      if (!reachable) {
        return {
          id: 'ado.project',
          category: CATEGORY,
          name: 'Project exists',
          status: 'warn' as const,
          detail: 'Skipped - organization not reachable',
          hint: 'Fix the organization check first.'
        };
      }
      if (!projectRes?.ok || !projectRes.data?.id) {
        return {
          id: 'ado.project',
          category: CATEGORY,
          name: 'Project exists',
          status: 'fail' as const,
          detail: `Project "${project}" not found in ${org} (${projectRes?.error ?? 'unknown error'})`,
          hint: `Run \`az devops project list --organization https://dev.azure.com/${org} -o table\` and set $env:ADO_PROJECT to the exact name.`
        };
      }
      projectId = projectRes.data.id;
      return {
        id: 'ado.project',
        category: CATEGORY,
        name: 'Project exists',
        status: 'pass' as const,
        detail: `"${projectRes.data.name}" (state: ${projectRes.data.state ?? 'unknown'})`,
        meta: { projectId, projectName: projectRes.data.name }
      };
    })
  );

  results.push(
    await safeCheck('ado.process-template', CATEGORY, 'Process template', async () => {
      if (!projectId) {
        return {
          id: 'ado.process-template',
          category: CATEGORY,
          name: 'Process template',
          status: 'warn' as const,
          detail: 'Skipped - project not resolved',
          hint: 'Fix the project check first.'
        };
      }
      const templateName = projectRes?.data?.capabilities?.processTemplate?.templateName;

      // Cross-check the raw project property against the reported capability.
      let propertyTemplateName: string | undefined;
      const props = await adoFetch<{ value?: Array<{ name?: string; value?: string }> }>(
        `${base}/_apis/projects/${projectId}/properties?api-version=7.1-preview.1`
      );
      const processProperty = props.data?.value?.find((p) => p.name === 'System.Process Template');
      if (processProperty?.value) {
        const processes = await adoFetch<{ value?: Array<{ id?: string; name?: string; typeId?: string }> }>(
          `${base}/_apis/process/processes?${API}`
        );
        propertyTemplateName = resolveProcessTemplateName(processProperty.value, processes.data?.value ?? []);
      }
      return compareProcessTemplate(templateName, propertyTemplateName);
    })
  );

  results.push(
    await safeCheck('ado.work-item-types', CATEGORY, 'Work item types', async () => {
      if (!projectId) {
        return {
          id: 'ado.work-item-types',
          category: CATEGORY,
          name: 'Work item types',
          status: 'warn' as const,
          detail: 'Skipped - project not resolved',
          hint: 'Fix the project check first.'
        };
      }
      const res = await adoFetch<{ value?: Array<{ name?: string }> }>(
        `${projectPath}/_apis/wit/workitemtypes?${API}`
      );
      if (!res.ok) {
        return {
          id: 'ado.work-item-types',
          category: CATEGORY,
          name: 'Work item types',
          status: 'fail' as const,
          detail: `Could not list work item types (${res.error ?? 'unknown error'})`,
          hint: `Run \`az boards work-item show --help\` after \`az devops configure --defaults organization=https://dev.azure.com/${org} project="${project}"\`.`
        };
      }
      const names = (res.data?.value ?? []).map((t) => t.name).filter((n): n is string => Boolean(n));
      return evaluateWorkItemTypes(names);
    })
  );

  results.push(
    await safeCheck('ado.github-connection', CATEGORY, 'GitHub connection and linked repository', async () => {
      if (!projectId) {
        return {
          id: 'ado.github-connection',
          category: CATEGORY,
          name: 'GitHub connection and linked repository',
          status: 'warn' as const,
          detail: 'Skipped - project not resolved',
          hint: 'Fix the project check first.'
        };
      }
      const res = await adoFetch<{ count?: number; value?: Array<{ id?: string }> }>(
        `${projectPath}/_apis/githubconnections?api-version=7.1-preview.1`
      );
      if (!res.ok) {
        return {
          id: 'ado.github-connection',
          category: CATEGORY,
          name: 'GitHub connection and linked repository',
          status: 'warn' as const,
          detail: `Could not read GitHub connections (${res.error ?? 'unknown error'})`,
          hint: `Check manually at Azure DevOps -> ${project} -> Project settings -> GitHub connections. The connection is required for AB# traceability and the native Copilot handoff from Boards.`
        };
      }
      const connections = res.data?.value ?? [];
      if (connections.length === 0) {
        return {
          id: 'ado.github-connection',
          category: CATEGORY,
          name: 'GitHub connection and linked repository',
          status: 'fail' as const,
          detail: 'No GitHub connection on the project — AB# traceability links will not be created and the native Copilot handoff from Boards will not work',
          hint: `Add one at Azure DevOps -> ${project} -> Project settings -> GitHub connections -> Connect your GitHub account, then link the ${ctx.ghOwner}/${ctx.ghRepo} repository.`,
          meta: { connectionCount: 0 }
        };
      }
      // Verify the expected repository appears in the linked repos for at least one connection.
      const expectedRepo = `${ctx.ghOwner}/${ctx.ghRepo}`;
      let foundRepo = false;
      const linkedRepos: string[] = [];
      for (const conn of connections) {
        if (!conn.id) continue;
        const reposRes = await adoFetch<{
          value?: Array<{
            gitHubRepositoryUrl?: string;
            gitHubRepository?: { fullName?: string };
            fullName?: string;
            name?: string;
          }>;
        }>(`${projectPath}/_apis/githubconnections/${conn.id}/repos?api-version=7.1-preview.1`);
        if (reposRes.ok && reposRes.data?.value) {
          for (const repo of reposRes.data.value) {
            // This endpoint identifies the repository by URL. `name` is
            // frequently returned empty and `fullName` is not present at all,
            // so deriving owner/repo from the URL is the only reliable route -
            // matching on the other fields silently reports a correctly linked
            // repository as missing.
            const fromUrl = repo.gitHubRepositoryUrl
              ? (/github\.com\/([^/]+\/[^/.]+)/i.exec(repo.gitHubRepositoryUrl)?.[1] ?? '')
              : '';
            const name = fromUrl || repo.gitHubRepository?.fullName || repo.fullName || repo.name || '';
            if (name) linkedRepos.push(name);
            if (name.toLowerCase() === expectedRepo.toLowerCase()) foundRepo = true;
          }
        }
      }
      if (!foundRepo) {
        return {
          id: 'ado.github-connection',
          category: CATEGORY,
          name: 'GitHub connection and linked repository',
          status: 'warn' as const,
          detail: `${connections.length} GitHub connection(s) found but "${expectedRepo}" is not among the linked repos (found: ${linkedRepos.length > 0 ? linkedRepos.join(', ') : 'none readable'})`,
          hint: `In Azure DevOps -> ${project} -> Project settings -> GitHub connections, add "${expectedRepo}" to the connection. Without it, AB# links, commit traceability, and the native Copilot handoff will not work.`,
          meta: { connectionCount: connections.length, expectedRepo, linkedRepos }
        };
      }
      return {
        id: 'ado.github-connection',
        category: CATEGORY,
        name: 'GitHub connection and linked repository',
        status: 'pass' as const,
        detail: `GitHub connection configured and "${expectedRepo}" is linked (${connections.length} connection(s), ${linkedRepos.length} repo(s) total)`,
        meta: { connectionCount: connections.length, expectedRepo, linkedRepos }
      };
    })
  );

  return results;
}
