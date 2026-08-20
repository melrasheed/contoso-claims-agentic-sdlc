/**
 * Azure Boards release gate
 * =========================
 *
 * Blocks a deployment while blocking work items are open in Azure Boards.
 *
 * WHY THIS EXISTS
 * ---------------
 * Azure Pipelines ships a built-in "Query Work Items" check: a release is held
 * while, say, an active Sev1 bug exists. When delivery moves to GitHub Actions
 * that control disappears - GitHub Environments offer required reviewers, wait
 * timers and branch policies, but nothing that consults an external backlog.
 *
 * This script restores it. Azure DevOps stays authoritative over whether a
 * release may proceed, without Azure DevOps running the release.
 *
 * DESIGN NOTES
 * ------------
 * - Zero dependencies. Native fetch on Node 20+. Nothing to install, nothing
 *   to keep patched, and it runs unchanged on any CI - not only GitHub.
 * - Prefers a *named shared query* over inline WIQL, so the definition of
 *   "blocking" stays owned and auditable by the delivery team in Azure DevOps
 *   rather than being buried in YAML that only engineers can change.
 * - Fails closed. If Azure DevOps cannot be reached, the gate blocks. A control
 *   that fails open is not a control. Override deliberately with
 *   GATE_FAIL_ON_ERROR=false and record why.
 *
 * ENVIRONMENT
 * -----------
 *   ADO_ORGANIZATION    required  e.g. "contoso"
 *   ADO_PROJECT         required  e.g. "Agentic SDLC"
 *   ADO_QUERY_PATH      optional  e.g. "Shared Queries/Release Gate - active Sev1 Sev2 bugs"
 *   ADO_WIQL            optional  raw WIQL, used only when ADO_QUERY_PATH is empty
 *   GATE_MAX_BLOCKING   optional  tolerated matches before blocking (default 0)
 *   GATE_ENFORCE        optional  "false" reports without failing (default true)
 *   GATE_FAIL_ON_ERROR  optional  "false" lets query errors pass (default true)
 *   GATE_SUMMARY        optional  "false" suppresses the job summary (default true)
 *   ADO_PAT             optional  PAT with Work Items (Read). Omit to use Entra ID
 *                                 via the Azure CLI, which stores no secret.
 *
 * EXIT CODES
 *   0  gate passed (or enforcement disabled)
 *   1  gate blocked the deployment
 *   2  configuration or query error while failing closed
 */

import { execFile } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Well-known Azure DevOps application ID. A public constant, not a secret. */
const ADO_RESOURCE_ID = '499b84ac-1321-427f-aa17-267ca6975798';
const API_VERSION = '7.1';

const EXIT_PASS = 0;
const EXIT_BLOCKED = 1;
const EXIT_ERROR = 2;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function bool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['false', '0', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function loadConfig(env = process.env) {
  const organization = (env.ADO_ORGANIZATION ?? '').trim();
  const project = (env.ADO_PROJECT ?? '').trim();
  const queryPath = (env.ADO_QUERY_PATH ?? '').trim();
  const wiql = (env.ADO_WIQL ?? '').trim();

  const missing = [];
  if (!organization) missing.push('ADO_ORGANIZATION');
  if (!project) missing.push('ADO_PROJECT');
  if (missing.length) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }
  if (!queryPath && !wiql) {
    throw new Error('Provide either ADO_QUERY_PATH (preferred) or ADO_WIQL.');
  }

  const maxBlocking = Number.parseInt(env.GATE_MAX_BLOCKING ?? '0', 10);

  return {
    organization,
    project,
    queryPath,
    wiql,
    maxBlocking: Number.isFinite(maxBlocking) && maxBlocking >= 0 ? maxBlocking : 0,
    enforce: bool(env.GATE_ENFORCE, true),
    failOnError: bool(env.GATE_FAIL_ON_ERROR, true),
    summary: bool(env.GATE_SUMMARY, true),
    pat: (env.ADO_PAT ?? '').trim(),
  };
}

// ---------------------------------------------------------------------------
// Azure DevOps access
// ---------------------------------------------------------------------------

/**
 * Acquire an Azure DevOps access token from the Azure CLI.
 *
 * Cross-platform spawn is fiddly here:
 * - On POSIX, `az` is a real executable, so execFile with an args array is
 *   correct and avoids any shell.
 * - On Windows, `az` is a `.cmd` shim. Node refuses to spawn `.cmd` without a
 *   shell (EINVAL, hardening for CVE-2024-27980), but passing an args array
 *   *with* a shell concatenates instead of escaping them (DEP0190) - the same
 *   argument-injection class CodeQL flags elsewhere in this repository.
 *
 * So on Windows we build one fully-quoted command string and pass no args
 * array. Every argument here is a fixed constant, but it is quoted anyway
 * rather than relying on that staying true.
 */
async function runAzForToken() {
  const args = ['account', 'get-access-token', '--resource', ADO_RESOURCE_ID, '--query', 'accessToken', '-o', 'tsv'];

  if (process.platform !== 'win32') {
    return execFileAsync('az', args, { timeout: 60_000 });
  }

  const quoted = args.map((a) => (/^[A-Za-z0-9_.:@=/-]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`));
  return execFileAsync(`az ${quoted.join(' ')}`, { timeout: 60_000, shell: true });
}

async function authHeader(config) {
  if (config.pat) {
    // Azure DevOps PAT auth is HTTP Basic with an empty username.
    return `Basic ${Buffer.from(`:${config.pat}`).toString('base64')}`;
  }

  try {
    const { stdout } = await runAzForToken();
    const token = stdout.trim();
    if (!token) throw new Error('empty token');
    return `Bearer ${token}`;
  } catch (err) {
    throw new Error(
      'Could not acquire an Azure DevOps token via the Azure CLI. ' +
        'Add an `azure/login` step with OIDC before this one, or supply ADO_PAT. ' +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function adoRequest(url, authorization, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: authorization,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Azure DevOps ${init.method ?? 'GET'} ${new URL(url).pathname} returned ` +
        `${response.status} ${response.statusText}: ${text.slice(0, 400)}`,
    );
  }
  return response.json();
}

/**
 * Resolve the WIQL to execute. A named shared query wins over inline WIQL so
 * the rule lives in Azure DevOps where the delivery team can see and change it.
 */
export async function resolveWiql(config, authorization, request = adoRequest) {
  if (!config.queryPath) return config.wiql;

  const projectUrl = `https://dev.azure.com/${encodeURIComponent(config.organization)}/${encodeURIComponent(config.project)}`;
  // Each path segment is encoded separately so the slashes stay meaningful.
  const encodedPath = config.queryPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  const query = await request(
    `${projectUrl}/_apis/wit/queries/${encodedPath}?$expand=wiql&api-version=${API_VERSION}`,
    authorization,
  );

  if (!query?.wiql) {
    throw new Error(
      `Shared query "${config.queryPath}" was found but has no WIQL. ` +
        'Check that the path points at a query rather than a folder.',
    );
  }
  return query.wiql;
}

async function runQuery(config, authorization, wiql) {
  const projectUrl = `https://dev.azure.com/${encodeURIComponent(config.organization)}/${encodeURIComponent(config.project)}`;
  const result = await adoRequest(
    `${projectUrl}/_apis/wit/wiql?api-version=${API_VERSION}`,
    authorization,
    { method: 'POST', body: JSON.stringify({ query: wiql }) },
  );
  return (result.workItems ?? []).map((item) => item.id);
}

async function fetchDetails(config, authorization, ids) {
  if (ids.length === 0) return [];

  const orgUrl = `https://dev.azure.com/${encodeURIComponent(config.organization)}`;
  const projectUrl = `${orgUrl}/${encodeURIComponent(config.project)}`;
  const wanted = ids.slice(0, 200); // batch endpoint caps at 200

  const response = await adoRequest(
    `${orgUrl}/_apis/wit/workitemsbatch?api-version=${API_VERSION}`,
    authorization,
    {
      method: 'POST',
      body: JSON.stringify({
        ids: wanted,
        fields: [
          'System.Id',
          'System.WorkItemType',
          'System.Title',
          'System.State',
          'System.AssignedTo',
        ],
      }),
    },
  );

  return (response.value ?? []).map((item) => ({
    id: item.id,
    type: item.fields?.['System.WorkItemType'] ?? '',
    title: item.fields?.['System.Title'] ?? '(untitled)',
    state: item.fields?.['System.State'] ?? '',
    assignedTo: item.fields?.['System.AssignedTo']?.displayName ?? 'Unassigned',
    url: `${projectUrl}/_workitems/edit/${item.id}`,
  }));
}

// ---------------------------------------------------------------------------
// Decision and reporting
// ---------------------------------------------------------------------------

/**
 * Pure decision function, separated so it can be unit tested without network.
 */
export function decide({ count, maxBlocking, enforce }) {
  const overLimit = count > maxBlocking;
  if (!overLimit) return { passed: true, reason: 'clear' };
  if (!enforce) return { passed: true, reason: 'not-enforced' };
  return { passed: false, reason: 'blocked' };
}

export function buildSummary({ config, items, count, decision, wiqlSource }) {
  const lines = [];
  const heading = decision.passed
    ? decision.reason === 'not-enforced'
      ? '### Azure Boards release gate — reporting only'
      : '### Azure Boards release gate — passed'
    : '### Azure Boards release gate — BLOCKED';

  lines.push(heading, '');
  lines.push(`Source: \`${wiqlSource}\``);
  lines.push(`Project: \`${config.organization}/${config.project}\``);
  lines.push(`Blocking work items: **${count}** (tolerance ${config.maxBlocking})`);
  lines.push('');

  if (count === 0) {
    lines.push('No blocking work items. The deployment may proceed.');
    return lines.join('\n');
  }

  lines.push('| ID | Type | Title | State | Assigned to |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const item of items) {
    const safeTitle = String(item.title).replace(/\|/g, '\\|');
    lines.push(
      `| [${item.id}](${item.url}) | ${item.type} | ${safeTitle} | ${item.state} | ${item.assignedTo} |`,
    );
  }
  lines.push('');

  if (decision.passed && decision.reason === 'not-enforced') {
    lines.push(
      '> Enforcement is disabled (`GATE_ENFORCE=false`), so the deployment continues. ' +
        'These items would have blocked it.',
    );
  } else if (!decision.passed) {
    lines.push(
      '> Close, resolve or re-triage these work items in Azure Boards, then re-run this workflow. ' +
        'Do not bypass the gate to make a release proceed.',
    );
  }

  return lines.join('\n');
}

async function writeGithubFile(envVar, content) {
  const target = process.env[envVar];
  if (!target) return;
  await appendFile(target, `${content}\n`, 'utf8');
}

async function setOutputs(outputs) {
  const target = process.env.GITHUB_OUTPUT;
  if (!target) return;
  const lines = Object.entries(outputs).map(([key, value]) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (text.includes('\n')) {
      const delimiter = `ghadelim_${Math.random().toString(36).slice(2)}`;
      return `${key}<<${delimiter}\n${text}\n${delimiter}`;
    }
    return `${key}=${text}`;
  });
  await appendFile(target, `${lines.join('\n')}\n`, 'utf8');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`::error::${err instanceof Error ? err.message : String(err)}`);
    return EXIT_ERROR;
  }

  let items = [];
  let count = 0;
  let wiqlSource = config.queryPath ? `shared query: ${config.queryPath}` : 'inline WIQL';

  try {
    const authorization = await authHeader(config);
    const wiql = await resolveWiql(config, authorization);
    const ids = await runQuery(config, authorization, wiql);
    count = ids.length;
    items = await fetchDetails(config, authorization, ids);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (config.failOnError) {
      console.error(`::error::Release gate could not evaluate Azure Boards: ${message}`);
      console.error(
        '::error::Failing closed. A gate that cannot check its condition must not allow a release. ' +
          'Set GATE_FAIL_ON_ERROR=false only with an accepted, recorded risk.',
      );
      await writeGithubFile(
        'GITHUB_STEP_SUMMARY',
        `### Azure Boards release gate — ERROR\n\nCould not evaluate the gate, so the deployment was blocked.\n\n\`\`\`\n${message}\n\`\`\``,
      );
      return EXIT_ERROR;
    }
    console.warn(`::warning::Release gate could not evaluate Azure Boards: ${message}`);
    console.warn('::warning::GATE_FAIL_ON_ERROR is false, so the deployment continues unchecked.');
    await setOutputs({ 'blocking-count': '0', 'blocking-items': '[]', passed: 'true' });
    return EXIT_PASS;
  }

  const decision = decide({ count, maxBlocking: config.maxBlocking, enforce: config.enforce });

  if (config.summary) {
    await writeGithubFile(
      'GITHUB_STEP_SUMMARY',
      buildSummary({ config, items, count, decision, wiqlSource }),
    );
  }

  await setOutputs({
    'blocking-count': String(count),
    'blocking-items': JSON.stringify(items),
    passed: String(decision.passed),
  });

  if (!decision.passed) {
    console.error(`::error::Release gate blocked: ${count} blocking work item(s) in Azure Boards.`);
    for (const item of items) {
      console.error(`::error::  ${item.type} ${item.id} [${item.state}] ${item.title} - ${item.url}`);
    }
    return EXIT_BLOCKED;
  }

  if (decision.reason === 'not-enforced' && count > 0) {
    console.warn(`::warning::${count} blocking work item(s) found, but enforcement is disabled.`);
  } else {
    console.log(`Release gate passed. No blocking work items (tolerance ${config.maxBlocking}).`);
  }
  return EXIT_PASS;
}

// Only run when executed directly, so the pure functions above stay importable.
const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;

if (invokedDirectly || process.env.BOARDS_GATE_FORCE_RUN === 'true') {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`::error::Unexpected failure: ${err instanceof Error ? err.stack : String(err)}`);
      process.exit(EXIT_ERROR);
    });
}

export { loadConfig, main };
