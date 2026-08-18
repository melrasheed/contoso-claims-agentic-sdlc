#!/usr/bin/env node
/**
 * CLI for the Azure Boards <-> GitHub bridge.
 *
 *   ado-github-bridge sync            Sync all work items tagged `ai-ready`
 *   ado-github-bridge sync 42 43      Sync specific work item IDs
 *   ado-github-bridge sync --dry-run  Show what would happen, change nothing
 *   ado-github-bridge doctor          Verify configuration and connectivity
 */

import { loadConfig, describeConfig, type BridgeConfig } from './config.js';
import { Bridge, type SyncOutcome } from './sync.js';
import { AdoClient } from './ado.js';
import { GitHubClient } from './github.js';

function parseArgs(argv: string[]): { command: string; ids: number[]; flags: Set<string> } {
  const flags = new Set<string>();
  const positional: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith('--')) flags.add(arg.slice(2));
    else positional.push(arg);
  }
  const command = positional[0] ?? 'sync';
  const ids = positional
    .slice(1)
    .map((v) => Number.parseInt(v.replace(/^AB#/i, ''), 10))
    .filter((n) => Number.isFinite(n));
  return { command, ids, flags };
}

function printSummary(outcomes: SyncOutcome[]): number {
  if (outcomes.length === 0) {
    console.log('\nNothing to do.');
    return 0;
  }

  console.log('\n--- Summary ---');
  for (const o of outcomes) {
    const icon =
      o.status === 'created'
        ? '+'
        : o.status === 'already-synced'
          ? '='
          : o.status === 'skipped'
            ? '-'
            : '!';
    const issue = o.issueNumber ? ` -> #${o.issueNumber}` : '';
    const copilot = o.assignedToCopilot ? ' [copilot]' : '';
    const reason = o.reason ? ` (${o.reason})` : '';
    console.log(`  ${icon} AB#${o.workItemId} ${o.title}${issue}${copilot}${reason}`);
  }

  const counts = outcomes.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `\ncreated=${counts['created'] ?? 0} already-synced=${counts['already-synced'] ?? 0} ` +
      `skipped=${counts['skipped'] ?? 0} failed=${counts['failed'] ?? 0}`,
  );

  return counts['failed'] ? 1 : 0;
}

async function doctor(config: BridgeConfig): Promise<number> {
  console.log('Bridge configuration:');
  console.table(describeConfig(config));

  let failures = 0;

  process.stdout.write('Azure DevOps connectivity... ');
  try {
    const ado = new AdoClient(config);
    const ids = await ado.findReadyWorkItems();
    console.log(`OK (${ids.length} item(s) tagged "${config.readyTag}" awaiting sync)`);
  } catch (error) {
    failures += 1;
    console.log(`FAILED\n  ${error instanceof Error ? error.message : String(error)}`);
  }

  process.stdout.write('GitHub connectivity... ');
  try {
    const github = new GitHubClient(config);
    const copilotId = await github.findCopilotActorId();
    console.log(
      copilotId
        ? 'OK (Copilot coding agent is assignable on this repository)'
        : 'OK (but the Copilot coding agent is NOT assignable - issues will be left for a human)',
    );
  } catch (error) {
    failures += 1;
    console.log(`FAILED\n  ${error instanceof Error ? error.message : String(error)}`);
  }

  return failures === 0 ? 0 : 1;
}

async function main(): Promise<number> {
  const { command, ids, flags } = parseArgs(process.argv.slice(2));

  if (flags.has('help') || command === 'help') {
    console.log(
      [
        'Azure Boards <-> GitHub bridge',
        '',
        'Usage:',
        '  ado-github-bridge sync [workItemId...] [--dry-run] [--no-copilot]',
        '  ado-github-bridge doctor',
        '',
        'Required environment:',
        '  ADO_ORG, ADO_PROJECT, GH_OWNER, GH_REPO, GITHUB_TOKEN',
        'Optional:',
        '  ADO_PAT (otherwise Entra ID via DefaultAzureCredential)',
        '  BRIDGE_READY_TAG, BRIDGE_SYNCED_TAG, BRIDGE_ISSUE_LABELS,',
        '  BRIDGE_ASSIGN_COPILOT, BRIDGE_STATE_AFTER_SYNC, BRIDGE_MAX_ITEMS, BRIDGE_DRY_RUN',
      ].join('\n'),
    );
    return 0;
  }

  const config = loadConfig({
    ...(flags.has('dry-run') ? { dryRun: true } : {}),
    ...(flags.has('no-copilot') ? { assignCopilot: false } : {}),
  });

  if (command === 'doctor') return doctor(config);

  if (command !== 'sync') {
    console.error(`Unknown command "${command}". Try --help.`);
    return 2;
  }

  console.log(
    `Bridging ${config.adoOrg}/${config.adoProject} -> ${config.ghOwner}/${config.ghRepo}` +
      (config.dryRun ? '  [DRY RUN]' : ''),
  );

  const bridge = new Bridge(config);
  const outcomes = await bridge.run(ids);
  return printSummary(outcomes);
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(`\nBridge failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
