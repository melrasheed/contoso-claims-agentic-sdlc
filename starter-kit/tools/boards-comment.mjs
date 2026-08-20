/**
 * Azure Boards deployment write-back
 * ==================================
 *
 * After a successful deployment, comments on every Azure Boards work item
 * referenced by an `AB#<id>` token in the deployed commits.
 *
 * WHY THIS EXISTS
 * ---------------
 * Azure Pipelines updates Azure Boards automatically: a work item shows the
 * builds and releases that carried it. Moving delivery to GitHub Actions loses
 * that, and Azure Boards silently stops being a complete record - it knows what
 * was planned and what was committed, but not what actually reached production.
 *
 * This script closes that gap. It is what keeps "Azure DevOps is the system of
 * record" an accurate statement rather than an aspiration.
 *
 * Zero dependencies; native fetch on Node 20+.
 *
 * ENVIRONMENT
 * -----------
 *   ADO_ORGANIZATION   required  e.g. "contoso"
 *   ADO_PROJECT        required  e.g. "Agentic SDLC"
 *   ADO_PAT            optional  PAT with Work Items (Read & Write). Omit to use
 *                                Entra ID via the Azure CLI.
 *   DEPLOY_ENVIRONMENT required  e.g. "prod"
 *   DEPLOY_VERSION     optional  release tag or version
 *   DEPLOY_URL         optional  the deployed application URL
 *   RUN_URL            optional  link back to the workflow run
 *   WORK_ITEM_IDS      optional  explicit space/comma separated ids. When set,
 *                                commit scanning is skipped.
 *   COMMIT_RANGE       optional  git range to scan, e.g. "v1.2.0..HEAD".
 *                                Defaults to the previous tag..HEAD.
 *   DRY_RUN            optional  "true" prints without writing.
 *
 * Never fails the build. A missing comment is an annoyance; a failed deployment
 * job after a successful production release is a genuine operational problem.
 */

import { execFile } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Well-known Azure DevOps application ID. A public constant, not a secret. */
const ADO_RESOURCE_ID = '499b84ac-1321-427f-aa17-267ca6975798';
const API_VERSION = '7.1';

/**
 * Extract Azure Boards work item ids from arbitrary text.
 * Matches the `AB#123` linking token that Azure Boards itself uses.
 * Deliberately case-insensitive: people type `ab#123`.
 */
export function extractWorkItemIds(text) {
  if (!text) return [];
  const ids = new Set();
  for (const match of String(text).matchAll(/\bAB#(\d+)\b/gi)) {
    const id = Number.parseInt(match[1], 10);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

export function buildComment({ environment, version, deployUrl, runUrl, repository }) {
  const parts = [
    `<b>Deployed to ${escapeHtml(environment)}</b>`,
    version ? `Version: ${escapeHtml(version)}` : null,
    deployUrl ? `Application: <a href="${escapeHtml(deployUrl)}">${escapeHtml(deployUrl)}</a>` : null,
    repository ? `Repository: ${escapeHtml(repository)}` : null,
    runUrl ? `Workflow run: <a href="${escapeHtml(runUrl)}">${escapeHtml(runUrl)}</a>` : null,
    '<i>Posted automatically by the GitHub Actions delivery workflow. ' +
      'Azure Boards remains the system of record for this work item.</i>',
  ].filter(Boolean);

  return parts.join('<br>');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function git(args) {
  try {
    const { stdout } = await execFileAsync('git', args, { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch {
    return '';
  }
}

/** Collect commit subjects and bodies for the range being deployed. */
async function collectCommitText(range) {
  if (range) return git(['log', '--format=%s%n%b', range]);

  // Default: everything since the previous tag, falling back to the last 50
  // commits on a repository that has never been tagged.
  const previousTag = (await git(['describe', '--tags', '--abbrev=0', 'HEAD^'])).trim();
  if (previousTag) return git(['log', '--format=%s%n%b', `${previousTag}..HEAD`]);
  return git(['log', '-n', '50', '--format=%s%n%b']);
}

async function authHeader(pat) {
  if (pat) return `Basic ${Buffer.from(`:${pat}`).toString('base64')}`;

  // See the note in boards-gate.mjs: POSIX uses an args array with no shell;
  // Windows needs a shell for the `az` .cmd shim, so the command is passed as
  // one fully-quoted string rather than as an args array.
  const args = ['account', 'get-access-token', '--resource', ADO_RESOURCE_ID, '--query', 'accessToken', '-o', 'tsv'];
  const { stdout } =
    process.platform === 'win32'
      ? await execFileAsync(
          `az ${args.map((a) => (/^[A-Za-z0-9_.:@=/-]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`)).join(' ')}`,
          { timeout: 60_000, shell: true },
        )
      : await execFileAsync('az', args, { timeout: 60_000 });

  const token = stdout.trim();
  if (!token) throw new Error('Azure CLI returned an empty Azure DevOps token.');
  return `Bearer ${token}`;
}

async function postComment({ organization, project, id, text, authorization }) {
  const url =
    `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}` +
    `/_apis/wit/workItems/${id}/comments?api-version=7.1-preview.3`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body.slice(0, 300)}`);
  }
}

async function summarise(lines) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target) return;
  await appendFile(target, `${lines.join('\n')}\n`, 'utf8');
}

async function main() {
  const organization = (process.env.ADO_ORGANIZATION ?? '').trim();
  const project = (process.env.ADO_PROJECT ?? '').trim();
  const environment = (process.env.DEPLOY_ENVIRONMENT ?? '').trim();

  if (!organization || !project || !environment) {
    console.warn('::warning::ADO_ORGANIZATION, ADO_PROJECT and DEPLOY_ENVIRONMENT are required; skipping write-back.');
    return 0;
  }

  const dryRun = String(process.env.DRY_RUN ?? '').toLowerCase() === 'true';

  let ids;
  if (process.env.WORK_ITEM_IDS?.trim()) {
    ids = process.env.WORK_ITEM_IDS.split(/[\s,]+/)
      .map((v) => Number.parseInt(String(v).replace(/^AB#/i, ''), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  } else {
    ids = extractWorkItemIds(await collectCommitText(process.env.COMMIT_RANGE?.trim()));
  }

  if (ids.length === 0) {
    console.log('No AB# work item references found in the deployed commits.');
    await summarise([
      '### Azure Boards write-back',
      '',
      'No `AB#` references found in the deployed commits, so no work items were updated.',
      '',
      '> Every change should carry an `AB#<id>` token. If this is unexpected, it indicates a traceability gap.',
    ]);
    return 0;
  }

  const comment = buildComment({
    environment,
    version: process.env.DEPLOY_VERSION?.trim(),
    deployUrl: process.env.DEPLOY_URL?.trim(),
    runUrl: process.env.RUN_URL?.trim(),
    repository: process.env.GITHUB_REPOSITORY?.trim(),
  });

  if (dryRun) {
    console.log(`[dry-run] would comment on ${ids.length} work item(s): ${ids.join(', ')}`);
    return 0;
  }

  let authorization;
  try {
    authorization = await authHeader((process.env.ADO_PAT ?? '').trim());
  } catch (err) {
    console.warn(`::warning::Could not authenticate to Azure DevOps: ${err instanceof Error ? err.message : String(err)}`);
    console.warn('::warning::Skipping Boards write-back. The deployment itself is unaffected.');
    return 0;
  }

  const updated = [];
  const failed = [];
  for (const id of ids) {
    try {
      await postComment({ organization, project, id, text: comment, authorization });
      updated.push(id);
      console.log(`Commented on AB#${id}`);
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : String(err) });
      console.warn(`::warning::Could not comment on AB#${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const projectUrl = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}`;
  const lines = ['### Azure Boards write-back', ''];
  lines.push(`Environment: \`${environment}\``);
  lines.push(`Work items updated: **${updated.length}** of ${ids.length}`);
  lines.push('');
  if (updated.length) {
    lines.push('| Work item | Link |');
    lines.push('| --- | --- |');
    for (const id of updated) {
      lines.push(`| AB#${id} | ${projectUrl}/_workitems/edit/${id} |`);
    }
  }
  if (failed.length) {
    lines.push('', '**Not updated:**', '');
    for (const f of failed) lines.push(`- AB#${f.id}: ${f.error}`);
  }
  await summarise(lines);

  // Deliberately always succeeds: a missing comment must never fail a job that
  // has already put code into production.
  return 0;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;

if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.warn(`::warning::Boards write-back failed unexpectedly: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(0);
    });
}

export { buildComment as buildDeploymentComment, main };
