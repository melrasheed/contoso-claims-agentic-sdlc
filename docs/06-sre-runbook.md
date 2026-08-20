# 06 — SRE Agent runbook

The Azure SRE Agent (`Microsoft.App/agents`) is a first-party Azure managed service. This runbook covers deployment, configuration, the fault-injection demo, and teardown.

For the schema notes (API version, connector types, action mode values) that differ from official documentation, see the table at the end of this document.

---

## Table of contents

1. [What gets deployed by Bicep](#1-what-gets-deployed-by-bicep)
2. [Review vs Automatic mode](#2-review-vs-automatic-mode)
3. [Per-tool Allow / Ask / Deny permissions](#3-per-tool-allow--ask--deny-permissions)
4. [RBAC roles](#4-rbac-roles)
5. [Token-based billing](#5-token-based-billing)
6. [Deploying the SRE Agent](#6-deploying-the-sre-agent)
7. [Post-deploy portal steps (required)](#7-post-deploy-portal-steps-required)
8. [Fault-injection demo end to end](#8-fault-injection-demo-end-to-end)
9. [Verifying recovery](#9-verifying-recovery)
10. [Connector-clobbering hazard](#10-connector-clobbering-hazard)
11. [Tearing down after demos](#11-tearing-down-after-demos)
12. [Schema notes](#12-schema-notes-verified)

---

## 1. What gets deployed by Bicep

When `enableSreAgent=true` is set in the parameters, `infra/modules/sre-agent.bicep` creates:

| Resource | Purpose |
|---|---|
| `Microsoft.App/agents@2025-05-01-preview` | The SRE Agent itself |
| `Microsoft.App/agents/connectors` — `app-insights` | Application Insights connector (KQL) |
| `Microsoft.App/agents/connectors` — `log-analytics` | Log Analytics workspace connector (KQL) |
| Reader on target RG | Enumerate and describe resources |
| Log Analytics Reader on target RG | Run KQL queries |
| Monitoring Reader on agent RG | Read Azure Monitor metrics and alert rules |
| SRE Agent Administrator on agent | Portal + data-plane access for the deployer (optional) |

**Not deployed by Bicep — requires the portal or `apply-extras.sh`:**
- GitHub connector (OAuth / PAT — data-plane only)
- Azure DevOps connector (PAT / Entra ID — data-plane only)
- Skills, subagents, hooks, scheduled tasks (data-plane only — not yet exposed in ARM)
- Per-tool Parameter Policy (portal only)

---

## 2. Review vs Automatic mode

The `sreAgentMode` parameter controls this. **Default is `Review`.**

| Mode | Behaviour | When to use |
|---|---|---|
| `Review` | Every proposed action appears in the portal for human approval before execution | **Always** for demos — shows the agent's reasoning |
| `Automatic` | Agent executes actions autonomously | Only in controlled environments where the Parameter Policy has been explicitly reviewed |

> **Critical warning — Automatic mode.** In `Automatic` mode, tools configured as `Ask` in the per-tool Parameter Policy **execute without human approval**. This means the agent can restart services, modify configuration, redeploy code, or create resources autonomously. A security-conscious customer will ask about this. Your answer:
> - The default deployment always uses `Review`.
> - Switching to `Automatic` requires an explicit parameter change (`sreAgentMode=Automatic`) and must be accompanied by a reviewed Parameter Policy.
> - Even in `Automatic` mode, tools can be set to `Deny` to create hard blocks (e.g., deny all delete operations on production resources).
> - `accessLevel=Low` (the default) limits the agent to Reader + Log Analytics Reader. It cannot modify resources unless you explicitly set `accessLevel=High` (Contributor).

---

## 3. Per-tool Allow / Ask / Deny permissions

**[PORTAL only — not configurable in Bicep]**

Navigate to `https://sre.azure.com` → your agent → **Tools**.

| Permission | Behaviour in Review mode | Behaviour in Automatic mode |
|---|---|---|
| `Allow` | Tool executes automatically | Tool executes automatically |
| `Ask` | Agent proposes, human approves | **Executes without approval** |
| `Deny` | Tool is never used | Tool is never used |

**Parameter Policy:** Each tool also supports a Parameter Policy that restricts the arguments the tool can use — for example, restricting `az webapp restart` to a specific app name. This is the primary blast-radius mitigation for Automatic mode.

**Recommended minimum for demo environments:**

| Tool category | Setting |
|---|---|
| Read-only investigation (list resources, query logs, check metrics) | Allow |
| Restart / redeploy | Ask |
| Delete resources | Deny |
| Modify configuration | Ask + Parameter Policy locking target resource |

---

## 4. RBAC roles

All roles are assigned to the agent's **system-assigned managed identity**.

| Role | Scope | Role Definition ID | When needed |
|---|---|---|---|
| Reader | Target RG | `acdd72a7-3385-48ef-bd42-f606fba81ae7` | Always |
| Log Analytics Reader | Target RG | `73c42c96-874c-492b-b04d-ab87d138a893` | Always |
| Contributor | Target RG | `b24988ac-6180-42a0-ab88-20f7382dd24c` | Only when `accessLevel=High` |
| Monitoring Reader | Agent RG | `43d0d8ad-25c7-4714-9337-8ba259a9fe05` | Always |
| SRE Agent Administrator | Agent resource | `e79298df-d852-4c6d-84f9-5d13249d1e55` | Deployer portal access |

Additional roles you may assign manually:
- **SRE Agent User** — users who can chat with the agent in the portal
- **SRE Agent Reader** — users who can view but not interact

---

## 5. Token-based billing

**The SRE Agent bills on consumed AI tokens, not on uptime.** There is no "off" state — it processes incidents as they arrive.

| Scenario | Agent Units / incident | Notes |
|---|---|---|
| Simple investigation (read-only) | ~100–500 | Log query, metric check, summary |
| Full investigation + PR | ~500–2000 | Logs, code, GitHub branch, ADO work item |
| Complex multi-step remediation | ~2000–10000 | Restart, redeploy, verify |

**For demo environments:**
- Use `sreAgentMonthlyUnitLimit=10000` (default) to cap monthly spend. When the limit is reached the agent stops processing until the next billing cycle.
- Scope the agent to the narrowest possible target resource group.
- **Delete the agent resource after each demo session** (see §11). The App Service, monitoring resources, and application continue to exist independently.
- `accessLevel=Low` generates fewer tokens because the agent skips remediation planning.

---

## 6. Deploying the SRE Agent

### 6.1 Get your deployer object ID

```powershell
$deployerObjectId = az ad signed-in-user show --query id -o tsv
```

### 6.2 Enable the SRE Agent in the parameters file

Add or update these values in `infra/main.parameters.json`:

```json
{
  "parameters": {
    "enableSreAgent":             { "value": true },
    "sreAgentMode":               { "value": "Review" },
    "sreAgentAccessLevel":        { "value": "Low" },
    "sreAgentMonthlyUnitLimit":   { "value": 10000 },
    "sreAgentDeployerObjectId":   { "value": "<your-object-id>" }
  }
}
```

### 6.3 Deploy

```powershell
.\infra\deploy.ps1 -EnvironmentName dev -NamePrefix <your-prefix>
```

The deploy script reads the parameters file. Alternatively, deploy directly with `az deployment group create`:

```powershell
$rg    = "<your-prefix>-rg-dev"
$objId = az ad signed-in-user show --query id -o tsv

az deployment group create `
    --resource-group $rg `
    --template-file infra/main.bicep `
    --parameters "@infra/main.parameters.json" `
    --parameters enableSreAgent=true `
                 sreAgentMode=Review `
                 sreAgentDeployerObjectId=$objId
```

### 6.4 Get the portal URL

After deployment, the agent portal URL is in the deployment outputs:

```powershell
az deployment group show `
    --resource-group $rg `
    --name <deployment-name> `
    --query properties.outputs.sreAgentPortalUrl.value -o tsv
```

The URL has the form: `https://sre.azure.com/#/agent/<subscriptionId>/<rg>/<agentName>`

---

## 7. Post-deploy portal steps (required)

**[PORTAL]** Navigate to `https://sre.azure.com` → your agent.

### 7.1 Add the GitHub connector

Connectors → Add → GitHub

- Authorise via OAuth or provide a PAT with `repo`, `issues`, `pull_requests` scopes
- Add repository: `<owner>/contoso-claims-agentic-sdlc`

This enables the agent to read source code and open fix branches.

### 7.2 Add the Azure DevOps connector

Connectors → Add → Azure DevOps

- Authenticate via managed identity (recommended) or PAT with `Work Items (Read & Write)`, `Code (Read)`, `Build (Read)` scopes
- Org: `https://dev.azure.com/<your-ado-org>`, Project: `Agentic SDLC`

This enables the agent to file work items after an incident.

### 7.3 Configure per-tool Parameter Policy

Tools → review each tool → set Allow, Ask, or Deny. See §3 for recommendations.

### 7.4 Wire the alert Action Group

**[PORTAL]** This is optional — the alert rules in `infra/modules/alerts.bicep` fire to an Action Group. To route alerts to the SRE Agent:

Azure Monitor → Alerts → your alert rule → Action group → Add action → SRE Agent webhook trigger.

The webhook URL is available from the agent's Automations → Incident Platforms tab.

---

## 8. Fault-injection demo end to end

### 8.1 Prerequisites

- The demo environment is deployed
- The SRE Agent is deployed and connectors are configured
- `ADMIN_ENABLED` is **not** currently set on the App Service (confirm before starting)

### 8.2 Enable the admin endpoint

**[PORTAL]** Azure Portal → App Service `<prefix>-api-dev` → Configuration → Application settings:

| Name | Value |
|---|---|
| `ADMIN_ENABLED` | `true` |

Click Save. The app restarts.

### 8.3 Inject the fault

```powershell
$apiUrl = "https://<prefix>-api-dev.azurewebsites.net"

Invoke-RestMethod `
    -Uri "$apiUrl/api/admin/fault" `
    -Method POST `
    -ContentType "application/json" `
    -Body '{"mode":"error","durationSeconds":300}'
```

Available modes: `none` | `latency` | `error` | `memory`

- `error` — returns HTTP 500 on all claim operations
- `latency` — adds a delay (useful for demonstrating the P95 latency alert)
- `memory` — allocates memory progressively (demonstrates resource pressure)

### 8.4 Wait for the alert to fire

The alert rule `<prefix>-alert-5xx-dev` fires when 5xx count exceeds 5 in a 5-minute window. Allow 3–5 minutes.

> **Screenshot:** Azure Monitor → Alerts showing the alert in "Fired" state.

### 8.5 Accept the SRE Agent's investigation steps

At `https://sre.azure.com` → your agent → active incident, approve each step in turn:

1. Query Application Insights traces
2. Query Log Analytics for error patterns
3. Check deployment history
4. Read source code (finds the fault injection endpoint)
5. Propose mitigation (set `ADMIN_ENABLED=false`)
6. Commit fix branch
7. File GitHub issue
8. File Azure DevOps work item

In Review mode, each step appears as a card you approve. Show customers the structured reasoning at each step — this is the demo highlight.

### 8.6 Clear the fault manually (parallel to the SRE Agent's fix)

While the agent is working, show that the operational fix is immediate:

```powershell
Invoke-RestMethod `
    -Uri "$apiUrl/api/admin/fault" `
    -Method POST `
    -ContentType "application/json" `
    -Body '{"mode":"none"}'
```

---

## 9. Verifying recovery

1. Check Application Insights: Live Metrics → confirm error rate returns to near zero.
2. Check the Azure Monitor alert: it should resolve within the next evaluation window (5 minutes).
3. Call the API directly:

```powershell
Invoke-RestMethod -Uri "$apiUrl/api/claims" -Method GET
# Expect 200 with an empty or populated claims array
```

4. Engage the `sre-liaison` agent to verify the SRE Agent's own claims:

```
@sre-liaison
The Azure SRE Agent has mitigated the fault-injection incident on <prefix>-api-dev. 
Verify recovery from telemetry, review the fix branch, and recommend whether 
the mitigation should become permanent.
```

---

## 10. Connector-clobbering hazard

**Reference:** [github.com/microsoft/sre-agent issue #30](https://github.com/microsoft/sre-agent/issues/30)

**Problem:** Redeploying the parent `Microsoft.App/agents` resource via ARM can delete existing connector children. ARM performs a full PUT on the parent which may reconcile child state to nothing if connectors are not explicitly re-listed.

**Mitigations in this codebase:**
1. Connectors in `sre-agent.bicep` use an `existing` parent reference. Connector resources are created/updated independently without triggering a re-PUT of the parent.
2. Connectors deploy serially (`dependsOn` chaining) to prevent concurrent PUT requests from clobbering each other.
3. If you are updating infrastructure without changing the SRE Agent, set `enableSreAgent=false` to skip the agent module entirely.
4. If you must redeploy with `enableSreAgent=true` after configuring connectors in the portal, set `sreAgentSkipRbac=true` and verify connectors are still present after deployment.

---

## 11. Tearing down after demos

```powershell
# Remove the SRE Agent only (leaves the app running):
$agentId = az resource show `
    -g "<prefix>-rg-dev" `
    -n "<prefix>-sre-agent-dev" `
    --resource-type Microsoft.App/agents `
    --query id -o tsv

az resource delete --ids $agentId --verbose

# Remove everything:
.\infra\teardown.ps1 -EnvironmentName dev -NamePrefix <your-prefix>
```

Confirm with `yes` when prompted. Deletion is asynchronous.

**Why teardown matters:** The agent bills on consumed tokens even when idle (background health checks). `monthlyAgentUnitLimit=10000` is a guard, not a kill switch. Delete the resource after demos.

---

## 12. Schema notes (verified)

These differences from official documentation were discovered during deployment validation of this codebase.

| Aspect | Documented / expected | Actual (verified) |
|---|---|---|
| API version | Unspecified in early docs | `2025-05-01-preview` — the version used in official `microsoft/sre-agent` templates. The `2026-01-01` GA version exists but lacks `monthlyAgentUnitLimit` and `experimentalSettings`. |
| `actionMode` values | `'Autonomous'` (GA docs) | `'Automatic'` in the preview API. Different strings on different API versions. This Bicep uses `'Automatic'`. |
| Child resource type | `dataConnectors` (some docs) | `connectors` — the resource type is `Microsoft.App/agents/connectors`. |
| GitHub / ADO connectors | Expressible as ARM resources | **Not possible via ARM** — data-plane only. ARM does not expose these connector types. Must be configured at `https://sre.azure.com`. |
| `agentIdentity.initialSponsorGroupId` | Present in GA schema | Not used in official templates in practice; system-assigned MI is sufficient. |
