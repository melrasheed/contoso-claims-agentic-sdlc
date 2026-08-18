# Azure SRE Agent — Agentic SDLC Accelerator

> **What this is:** The Azure SRE Agent (`Microsoft.App/agents`) is a first-party Azure service that receives incidents from Azure Monitor, investigates using logs, metrics, deployments, and source code, then mitigates, opens fix branches, and files GitHub issues and Azure DevOps work items.
>
> This file documents everything needed to deploy, configure, and operate the SRE Agent in the Agentic SDLC demo — what Bicep handles, what requires the portal, and what the real tradeoffs are.

---

## Table of Contents

1. [What gets deployed by Bicep](#what-gets-deployed-by-bicep)
2. [Review vs Autonomous decision](#review-vs-autonomous-decision)
3. [Per-tool Allow / Ask permission model](#per-tool-allow--ask-permission-model-portal-only)
4. [Token-based billing model](#token-based-billing-model)
5. [RBAC roles](#rbac-roles)
6. [Connectors](#connectors)
7. [Connector-clobbering hazard](#connector-clobbering-hazard)
8. [Deploying the SRE Agent](#deploying-the-sre-agent)
9. [Post-deploy portal steps](#post-deploy-portal-steps-required)
10. [Schema notes: what differed from the docs](#schema-notes-what-differed-from-the-docs)
11. [Tearing down after demos](#tearing-down-after-demos)

---

## What gets deployed by Bicep

When `enableSreAgent=true`, `infra/modules/sre-agent.bicep` creates:

| Resource | Purpose |
|----------|---------|
| `Microsoft.App/agents@2025-05-01-preview` | The SRE Agent itself |
| `Microsoft.App/agents/connectors` — `app-insights` | Application Insights connector (KQL queries) |
| `Microsoft.App/agents/connectors` — `log-analytics` | Log Analytics workspace connector (KQL queries) |
| Role assignment: Reader on target RG | Enumerate/describe resources in the monitored RG |
| Role assignment: Log Analytics Reader on target RG | Run KQL queries against the workspace |
| Role assignment: Monitoring Reader on agent RG | Read Azure Monitor metrics, alert rules, action groups |
| Role assignment: SRE Agent Administrator on agent | Deployer gets portal + data-plane access (optional — see `deployerObjectId`) |

**Not deployed by Bicep** (requires portal or `apply-extras.sh`):
- GitHub connector (OAuth PAT — data-plane only)
- Azure DevOps connector (PAT/AAD token — data-plane only)
- Skills, subagents, hooks, scheduled tasks (data-plane only — ARM sub-resources not yet exposed)
- Per-tool Parameter Policy (portal only)

---

## Review vs Autonomous decision

The `sreAgentMode` parameter controls this. **Default: `Review`.**

| Mode | Behaviour | When to use |
|------|-----------|-------------|
| `Review` | Every proposed action appears in the portal for human approval before execution | **Always** for demos. Shows the agent's reasoning and keeps humans in the loop. |
| `Automatic` | Agent executes actions autonomously | **Only** in controlled environments where every tool's policy has been explicitly reviewed. See warning below. |

> **⚠ CRITICAL WARNING — AUTONOMOUS MODE:**
>
> In `Automatic` mode, tools configured as **"Ask"** in the portal per-tool Parameter Policy will execute **without human approval**. This means the agent can restart services, modify configuration, redeploy code, or create/delete resources autonomously.
>
> A security-conscious customer **will ask about this**. Your answer:
> - Default deployment always uses `Review`.
> - Switching to `Automatic` requires an explicit parameter change (`sreAgentMode=Automatic`).
> - Even in `Automatic` mode, you can configure individual tools as `Deny` in the Parameter Policy to create hard blocks (e.g., deny all `DELETE` operations on production resources).
> - Access level `Low` (default) limits the agent to `Reader` + `Log Analytics Reader` — it can investigate and diagnose but cannot modify resources unless you explicitly grant `High` (Contributor).

---

## Per-tool Allow / Ask permission model (portal only)

**This is NOT configurable in Bicep.** It is configured in the SRE Agent portal at `https://sre.azure.com`.

After deploying, navigate to the agent → **Tools** → for each tool, set:

| Permission | Behaviour |
|------------|-----------|
| `Allow` | Tool executes automatically (in both Review and Automatic modes) |
| `Ask` | In Review mode: agent proposes, human approves. In **Automatic** mode: **executes without approval**. |
| `Deny` | Tool is never used, regardless of mode. Use for hard safety blocks. |

**Parameter Policy**: Each tool also has a Parameter Policy that lets you restrict the _arguments_ the tool can use — e.g., restricting the `az webapp restart` tool to only allow specific app names. This is the primary mitigation for blast-radius in Automatic mode.

**Recommended minimum for production demos:**
- `Deny` all tools that can DELETE resources
- `Ask` for restart/redeploy tools  
- `Allow` for read-only investigation tools (list resources, query logs, check metrics)

---

## Token-based billing model

**The SRE Agent bills on consumed AI tokens, not on uptime.** There is no "off" state for a deployed agent — it processes incidents as they arrive.

For demo environments:
- Use `monthlyAgentUnitLimit` (default: `10000`) to cap monthly spend. When the limit is reached, the agent stops processing new incidents until the next billing cycle.
- Scope the agent to the narrowest possible `targetResourceGroup` — a broader scope means more context loaded per investigation, which means more tokens consumed.
- **Tear down the agent resource group after each demo session** (see [Tearing down after demos](#tearing-down-after-demos)). The App Service Plan, monitoring resources, and application continue to exist independently.
- Access level `Low` generates fewer tokens than `High` because the agent skips remediation planning when it knows it cannot act.

Approximate cost guide (FY2026 pricing, subject to change):

| Scenario | Agent Units / incident | Notes |
|----------|------------------------|-------|
| Simple investigation (read-only) | ~100–500 | Log query, metric check, summary |
| Full investigation + PR | ~500–2000 | Logs, code, GitHub branch, ADO workitem |
| Complex multi-step remediation | ~2000–10000 | Restart, redeploy, verify |

---

## RBAC Roles

All roles are assigned to the agent's **system-assigned managed identity**:

| Role | Scope | Role Definition ID | Why needed |
|------|-------|--------------------|------------|
| Reader | Target RG | `acdd72a7-3385-48ef-bd42-f606fba81ae7` | Enumerate / describe all resources |
| Log Analytics Reader | Target RG | `73c42c96-874c-492b-b04d-ab87d138a893` | Run KQL queries against the workspace |
| Contributor | Target RG | `b24988ac-6180-42a0-ab88-20f7382dd24c` | **Only when `accessLevel=High`**: apply remediations |
| Monitoring Reader | Agent RG | `43d0d8ad-25c7-4714-9337-8ba259a9fe05` | Read Azure Monitor metrics, alert rules, action groups |
| SRE Agent Administrator | Agent resource | `e79298df-d852-4c6d-84f9-5d13249d1e55` | Portal + data-plane access for the deployer |

Additional roles you may need to assign manually (IAM → Add role assignment):
- **SRE Agent User** — grant to users who can chat with the agent in the portal
- **SRE Agent Reader** — grant to users who can view but not interact

---

## Connectors

### What Bicep deploys

| Connector | Type | Auth |
|-----------|------|------|
| `app-insights` | `AppInsights` | System-assigned MI (MSI) |
| `log-analytics` | `LogAnalytics` | System-assigned MI (MSI) |

These are the two connectors the `azmon-lawappinsights` recipe uses. They enable the agent to:
- Query App Insights via KQL (`traces`, `requests`, `exceptions`, `dependencies`)
- Query Log Analytics workspace data
- Correlate incidents with application telemetry

### What requires the portal / CLI

**GitHub connector** — not expressible in Bicep ARM. The resource provider does not expose a GitHub connector type through ARM today. Setup:

1. Navigate to `https://sre.azure.com` → your agent → **Connectors** → **Add** → **GitHub**
2. Authorise via OAuth or provide a PAT with `repo`, `issues`, `pull_requests` scopes
3. Add the repo: `melrasheed/contoso-claims-agentic-sdlc`
4. The agent can then read source code context and open fix branches / file issues

**Azure DevOps connector** — also data-plane only. Setup:

1. `https://sre.azure.com` → agent → **Connectors** → **Add** → **Azure DevOps**
2. Authenticate via:
   - **Managed Identity (recommended)**: grant the agent's system MI `Basic` access on the ADO project
   - **PAT**: create a PAT with `Work Items (Read & Write)`, `Code (Read)`, `Build (Read)` scopes
3. Add the org: `https://dev.azure.com/melrasheed`, project: `Agentic SDLC`

Alternatively, use the official `apply-extras.sh` from `microsoft/sre-agent`:
```bash
# Set before running:
export ADO_ORG=https://dev.azure.com/melrasheed
export ADO_PAT=<your-pat>
export GITHUB_PAT=<your-github-pat>

./bin/apply-extras.sh my-agent/
```

---

## Connector-clobbering hazard

> **Reference:** [github.com/microsoft/sre-agent issue #30](https://github.com/microsoft/sre-agent/issues/30)

**Problem:** Redeploying the parent `Microsoft.App/agents` resource via ARM can DELETE existing connector children. ARM performs a full PUT on the parent which may reconcile child state to "nothing" if connectors are not explicitly re-listed in the same deployment pass.

**Mitigation in this codebase:**
1. Connectors in `sre-agent.bicep` use an `existing` parent reference. This means the connector resources are created/updated independently without triggering a re-PUT of the parent agent.
2. Connectors deploy serially (`dependsOn` chaining) to prevent concurrent PUT requests from clobbering each other.
3. **On re-deploy:** if you are only updating infrastructure (App Service, monitoring) without changing the SRE Agent, set `enableSreAgent=false` to skip the agent module entirely on that run.
4. If you must redeploy with `enableSreAgent=true` after connectors have been configured in the portal, pass `sreAgentSkipRbac=true` and verify connectors are still present in the portal afterwards.

---

## Deploying the SRE Agent

### Prerequisites

```powershell
# Get your object ID for the deployer role assignment
$deployerObjectId = az ad signed-in-user show --query id -o tsv
```

### Enable in parameters

Update `infra/main.parameters.json` or pass inline:

```powershell
.\infra\deploy.ps1 `
  -EnvironmentName dev `
  -NamePrefix contoso `
  -AdditionalParams "enableSreAgent=true sreAgentMode=Review sreAgentDeployerObjectId=$deployerObjectId"
```

Or via `az deployment group create` directly:

```bash
az deployment group create \
  --resource-group contoso-rg-dev \
  --template-file infra/main.bicep \
  --parameters @infra/main.parameters.json \
  --parameters enableSreAgent=true \
              sreAgentMode=Review \
              sreAgentDeployerObjectId=$(az ad signed-in-user show --query id -o tsv)
```

### After deployment

The agent portal URL is emitted as an output:
```
sreAgentPortalUrl: https://sre.azure.com/#/agent/<subscriptionId>/<rg>/<agentName>
```

Open this URL to verify the agent is running and to complete the portal-only steps below.

---

## Post-deploy portal steps (required)

Navigate to `https://sre.azure.com` → your agent.

### 1. Add GitHub connector (required for code context + fix branches)
- Connectors → Add → GitHub → OAuth or PAT
- Repo: `melrasheed/contoso-claims-agentic-sdlc`

### 2. Add Azure DevOps connector (required for work item filing)
- Connectors → Add → Azure DevOps → PAT or managed identity
- Org: `https://dev.azure.com/melrasheed`, Project: `Agentic SDLC`

### 3. Configure per-tool Parameter Policy
- Tools → review each tool → set `Allow`, `Ask`, or `Deny`
- Minimum recommended: deny all destructive tools for `accessLevel=Low` deployments

### 4. Wire the alert Action Group (optional — automatic for Azure Monitor alerts)
The alert rules deployed by `infra/modules/alerts.bicep` fire to an Action Group.
To route these alerts to the SRE Agent as incidents:
- Alerts → `contoso-alert-5xx-dev` → Action group → Add action → SRE Agent webhook trigger
- The webhook URL is available from the agent's **Automations → Incident Platforms** tab

### 5. Add knowledge files / runbooks (recommended)
- Knowledge → Upload → add your operational runbooks, architecture diagrams, etc.
- The agent uses these during investigation to provide better context

---

## Schema notes: what differed from the docs

| Aspect | What was described | What is real (verified) |
|--------|-------------------|------------------------|
| API version | Not specified | `2025-05-01-preview` is what the official `microsoft/sre-agent` templates use. `2026-01-01` GA exists but lacks `monthlyAgentUnitLimit` and `experimentalSettings`. |
| `actionMode` values | `'Autonomous'` | `'Automatic'` in the preview API. The GA docs show `'Autonomous'` — these are different strings on different API versions. |
| Child resource name | `dataConnectors` | `connectors` — the resource type is `Microsoft.App/agents/connectors`, not `dataConnectors`. Confirmed from official Bicep templates. |
| GitHub/ADO connectors | Expressed as Bicep child resources | **Not possible via ARM** — data-plane only. The ARM resource provider does not expose these connector types. |
| `agentIdentity.initialSponsorGroupId` | Present in GA schema | Not used in practice in official templates — the system-assigned MI is sufficient for most scenarios. |

---

## Tearing down after demos

```powershell
# Tear down only the SRE Agent (leaves everything else running):
az resource delete \
  --ids $(az resource show -g contoso-rg-dev -n contoso-sre-agent-dev --resource-type Microsoft.App/agents --query id -o tsv) \
  --verbose

# Tear down the whole demo environment:
.\infra\teardown.ps1 -EnvironmentName dev -NamePrefix contoso
```

**Why tear down matters:**  
The SRE Agent bills on consumed tokens even when no incidents are actively being investigated (background health checks, scheduled tasks). For a demo budget:
- `monthlyAgentUnitLimit=10000` is a guard, not a kill switch — delete the resource after demos.
- Deleting only the `Microsoft.App/agents` resource leaves the App Service, Application Insights, and Log Analytics intact for the next demo session.
