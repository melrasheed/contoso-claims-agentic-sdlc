import { firstLine, run, safeCheck } from '../exec.js';
import type { CheckResult, PreflightContext } from '../types.js';

const CATEGORY = 'Azure' as const;

export const REQUIRED_PROVIDERS = ['Microsoft.App', 'Microsoft.OperationalInsights'] as const;

const WRITE_ROLES = ['Owner', 'Contributor', 'User Access Administrator'];

/** Pure: resource provider registration state -> check result. */
export function evaluateProviderState(provider: string, state: string | undefined): CheckResult {
  const id = `azure.provider.${provider.toLowerCase()}`;
  const name = `Provider ${provider} registered`;
  if (!state) {
    return {
      id,
      category: CATEGORY,
      name,
      status: 'warn',
      detail: `Could not read registration state for ${provider}`,
      hint: `Run \`az provider show -n ${provider} --query registrationState -o tsv\` and register with \`az provider register -n ${provider}\`.`
    };
  }
  if (state === 'Registered') {
    return { id, category: CATEGORY, name, status: 'pass', detail: `${provider}: Registered`, meta: { provider, state } };
  }
  if (state === 'Registering') {
    return {
      id,
      category: CATEGORY,
      name,
      status: 'warn',
      detail: `${provider}: Registering (not ready yet)`,
      hint: `Wait and re-check with \`az provider show -n ${provider} --query registrationState -o tsv\`.`,
      meta: { provider, state }
    };
  }
  return {
    id,
    category: CATEGORY,
    name,
    status: 'fail',
    detail: `${provider}: ${state}`,
    hint: `Run \`az provider register -n ${provider} --wait\`.`,
    meta: { provider, state }
  };
}

/** Pure: role assignments -> can we create resources? */
export function evaluateRoles(roles: string[]): CheckResult {
  const id = 'azure.permissions';
  const name = 'Permission to create resources';
  const writable = roles.filter((r) => WRITE_ROLES.includes(r));
  if (roles.length === 0) {
    return {
      id,
      category: CATEGORY,
      name,
      status: 'warn',
      detail: 'No role assignments visible at subscription scope (listing roles may itself be blocked)',
      hint: 'Ask a subscription owner to grant "Contributor", or verify with `az role assignment list --all -o table`.'
    };
  }
  if (writable.length === 0) {
    return {
      id,
      category: CATEGORY,
      name,
      status: 'warn',
      detail: `No write-capable role found at subscription scope (roles: ${roles.join(', ')})`,
      hint: 'Request "Contributor" on the subscription, or scope the demo to a resource group where you already have write access.',
      meta: { roles }
    };
  }
  return {
    id,
    category: CATEGORY,
    name,
    status: 'pass',
    detail: `Role(s) granting write access: ${writable.join(', ')}`,
    meta: { roles }
  };
}

export async function runAzureChecks(ctx: PreflightContext): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  let subscriptionId: string | undefined;
  let signedInUser: string | undefined;

  results.push(
    await safeCheck('azure.subscription', CATEGORY, 'Subscription accessible', async () => {
      const res = await run('az', ['account', 'show', '-o', 'json'], { timeoutMs: 90_000 });
      if (!res.ok) {
        return {
          id: 'azure.subscription',
          category: CATEGORY,
          name: 'Subscription accessible',
          status: 'fail' as const,
          detail: 'No accessible Azure subscription',
          hint: 'Run `az login`, then `az account set --subscription <subscription-id>`.'
        };
      }
      const account = JSON.parse(res.stdout) as {
        id?: string;
        name?: string;
        state?: string;
        tenantId?: string;
        user?: { name?: string };
      };
      subscriptionId = account.id;
      signedInUser = account.user?.name;
      if (!subscriptionId) {
        return {
          id: 'azure.subscription',
          category: CATEGORY,
          name: 'Subscription accessible',
          status: 'fail' as const,
          detail: 'Azure CLI returned an account without a subscription id',
          hint: 'Run `az account list -o table` then `az account set --subscription <subscription-id>`.'
        };
      }
      return {
        id: 'azure.subscription',
        category: CATEGORY,
        name: 'Subscription accessible',
        status: account.state === 'Enabled' ? ('pass' as const) : ('warn' as const),
        detail: `"${account.name ?? subscriptionId}" (state: ${account.state ?? 'unknown'})`,
        ...(account.state === 'Enabled'
          ? {}
          : { hint: 'The subscription is not Enabled - check Azure portal -> Subscriptions -> Overview.' }),
        meta: { subscriptionId, subscriptionName: account.name, tenantId: account.tenantId }
      };
    })
  );

  for (const provider of REQUIRED_PROVIDERS) {
    results.push(
      await safeCheck(`azure.provider.${provider.toLowerCase()}`, CATEGORY, `Provider ${provider} registered`, async () => {
        if (!subscriptionId) {
          return evaluateProviderState(provider, undefined);
        }
        const res = await run('az', ['provider', 'show', '-n', provider, '--query', 'registrationState', '-o', 'tsv'], {
          timeoutMs: 120_000
        });
        return evaluateProviderState(provider, res.ok ? firstLine(res.stdout) || undefined : undefined);
      })
    );
  }

  results.push(
    await safeCheck('azure.resource-group', CATEGORY, 'Demo resource group', async () => {
      if (!subscriptionId) {
        return {
          id: 'azure.resource-group',
          category: CATEGORY,
          name: 'Demo resource group',
          status: 'warn' as const,
          detail: 'Skipped - no accessible subscription',
          hint: 'Run `az login` first.'
        };
      }
      const res = await run('az', ['group', 'exists', '-n', ctx.resourceGroup], { timeoutMs: 90_000 });
      const exists = res.ok && /true/i.test(res.stdout);
      if (exists) {
        return {
          id: 'azure.resource-group',
          category: CATEGORY,
          name: 'Demo resource group',
          status: 'pass' as const,
          detail: `Resource group "${ctx.resourceGroup}" exists`,
          meta: { resourceGroup: ctx.resourceGroup, exists: true }
        };
      }
      // Not existing before first deployment is the expected state on a fresh clone.
      // Report as PASS with a note rather than WARN so pre-deployment environments
      // don't produce false alarm warnings that train people to ignore the output.
      return {
        id: 'azure.resource-group',
        category: CATEGORY,
        name: 'Demo resource group',
        status: 'pass' as const,
        detail: `Resource group "${ctx.resourceGroup}" not deployed yet (expected on a fresh clone)`,
        hint: `When ready: \`az group create -n ${ctx.resourceGroup} -l westeurope\`, or set $env:DEMO_RESOURCE_GROUP to an existing group.`,
        meta: { resourceGroup: ctx.resourceGroup, exists: false }
      };
    })
  );

  results.push(
    await safeCheck('azure.permissions', CATEGORY, 'Permission to create resources', async () => {
      if (!subscriptionId) {
        return {
          id: 'azure.permissions',
          category: CATEGORY,
          name: 'Permission to create resources',
          status: 'warn' as const,
          detail: 'Skipped - no accessible subscription',
          hint: 'Run `az login` first.'
        };
      }
      const assignee = signedInUser;
      if (!assignee) {
        return evaluateRoles([]);
      }
      const res = await run(
        'az',
        [
          'role',
          'assignment',
          'list',
          '--assignee',
          assignee,
          '--scope',
          `/subscriptions/${subscriptionId}`,
          '--include-inherited',
          '--query',
          '[].roleDefinitionName',
          '-o',
          'json'
        ],
        { timeoutMs: 120_000 }
      );
      if (!res.ok) {
        // Listing role assignments needs Microsoft Graph access; degrade gracefully.
        return {
          id: 'azure.permissions',
          category: CATEGORY,
          name: 'Permission to create resources',
          status: 'warn' as const,
          detail: 'Could not enumerate role assignments (best-effort check skipped)',
          hint: 'Verify manually: Azure portal -> Subscriptions -> <subscription> -> Access control (IAM) -> View my access.'
        };
      }
      try {
        const roles = (JSON.parse(res.stdout) as string[]).filter((r) => typeof r === 'string');
        return evaluateRoles(roles);
      } catch {
        return evaluateRoles([]);
      }
    })
  );

  return results;
}
