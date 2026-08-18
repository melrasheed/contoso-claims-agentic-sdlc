# 07 — Troubleshooting

All ten bugs below were discovered and fixed during development of this accelerator. Each entry gives the symptom, root cause, exact fix, and how to verify it is resolved.

---

## Bug 1 — ADO MCP server: wrong host URL

**Symptom:** Zero Azure DevOps tools load in Copilot Chat. Prompting an authored agent results in "I don't have any Azure DevOps tools available" or the agent falls back to REST calls that fail. No error message is shown — it fails silently.

**Cause:** The Azure DevOps MCP endpoint is on a **different host** from the regular ADO UI. `~/.copilot/mcp-config.json` was pointing at `https://dev.azure.com/<org>`, which returns a `203` status with an HTML sign-in page. The MCP client receives HTML, parses zero tools, and continues silently.

The correct MCP host is `https://mcp.dev.azure.com/<org>`. That URL returns `401` with a `WWW-Authenticate` header pointing at `/.well-known/oauth-protected-resource/`, which is the correct behaviour for an OAuth-protected API endpoint.

**Fix:**

In `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "azure-devops": {
      "command": "npx",
      "args": ["-y", "@azure-devops/mcp-server"],
      "env": {
        "AZURE_DEVOPS_ORG_URL": "https://mcp.dev.azure.com/<your-ado-org>"
      }
    }
  }
}
```

**How to verify:** After updating the config, open a new Copilot Chat session and prompt:
```
@sdlc-orchestrator List all work items in the backlog.
```
The agent should invoke ADO tools and return a list of work items. If it returns content from Boards without an error, the host is correct.

You can also verify the host directly:
```powershell
Invoke-WebRequest "https://mcp.dev.azure.com/<org>" -Method HEAD
# Expect: StatusCode 401, WWW-Authenticate header present

Invoke-WebRequest "https://dev.azure.com/<org>" -Method HEAD
# Returns: StatusCode 200/203 with HTML content-type — wrong host
```

---

## Bug 2 — MCP config schema differs by client

**Symptom:** MCP server works in VS Code but not in the Copilot CLI (or vice versa). Both are configured from what looks like the same file.

**Cause:** VS Code and the Copilot CLI use **different config file paths and different JSON keys**:

| Client | Config file | JSON key for servers |
|---|---|---|
| Copilot CLI | `~/.copilot/mcp-config.json` | `"mcpServers"` |
| VS Code | `.vscode/mcp.json` (workspace) or user settings | `"servers"` |

The same server definition, two different shapes. If you copy a VS Code config to the CLI config without changing the key, the CLI finds no servers.

**Fix:** Use the correct key for the target client.

For the Copilot CLI (`~/.copilot/mcp-config.json`):
```json
{ "mcpServers": { "azure-devops": { ... } } }
```

For VS Code (`.vscode/mcp.json`):
```json
{ "servers": { "azure-devops": { ... } } }
```

**How to verify:** After updating the config, restart the target client and confirm ADO tools appear as per Bug 1 verification above.

---

## Bug 3 — `System.Process Template` project property lies

**Symptom:** `VS402323: Work item type Feature does not exist in project`. The bootstrap script or an authored agent tries to create a `Feature` work item in a project that reports `Scrum` as its process template, but Feature creation fails.

**Cause:** The `System.Process Template` project property returned by the standard project API reported `Scrum` for this project. The project is actually running the **Basic** process. The Basic process has only `Epic`, `Issue`, and `Task` — no `Feature`, `User Story`, `Product Backlog Item`, or `Bug`.

The correct process template is in the `capabilities.processTemplate.templateName` field, which requires fetching the project with `?includeCapabilities=true`:

```
GET https://dev.azure.com/{org}/_apis/projects/{project}?includeCapabilities=true&api-version=7.1
```

The bootstrap script (`tools/ado-bootstrap/bootstrap.ps1`) and the `ProcessMap.psm1` module always use `includeCapabilities=true`. **Do not trust the `System.Process Template` project property.**

**Fix:** Fetch the project with `includeCapabilities=true` and read `capabilities.processTemplate.templateName`. The bootstrap script does this automatically. For manual REST calls:

```powershell
$result = az devops project show `
    --project "Agentic SDLC" `
    --org "https://dev.azure.com/<org>" `
    --query "capabilities.processTemplate.templateName" `
    -o tsv

Write-Host "Real process: $result"
# Should output: Basic
```

**How to verify:** Run `bootstrap.ps1 -WhatIf` — the output should show `Process template: Basic` and only attempt to create `Epic`, `Issue`, and `Task` types.

---

## Bug 4 — Basic process limitations (no Feature, no Bug, no acceptance criteria field)

**Symptom:** Scripted creation of `Feature`, `Bug`, `User Story`, or `Product Backlog Item` work items fails. Adding acceptance criteria, repro steps, or severity fields to work items fails.

**Cause:** The Azure DevOps **Basic process** is minimal. Valid work item types are `Epic`, `Issue`, and `Task` only. There are no `Feature`, `User Story`, `PBI`, or `Bug` types, and no acceptance criteria, repro-steps, or severity fields. Valid states are `To Do`, `Doing`, `Done`.

**There is no public REST API to change a project's process.** Changing from Basic to Agile/Scrum/CMMI is a portal-only operation.

**Fix option A — adapt (what this codebase does):** The bootstrap script and ProcessMap.psm1 detect the process and use the correct types and fields for whatever process the project runs. On Basic, acceptance criteria fold into the Description field under a clear heading. The bridge forwards it either way.

**Fix option B — change the process (if migration is acceptable):**

**[PORTAL]** Organization settings → Boards → Process → select the target process (e.g. Agile) → Change team projects → select the project → Change.

This is irreversible in the direction Basic → Agile/Scrum (there is a forward migration; there is no supported rollback to Basic after migration).

**How to verify:** After bootstrap, confirm work item #1 is an `Epic` and work items #2, #3 are `Issue` type (not `Feature`). The bootstrap script output should show no errors on item creation.

---

## Bug 5 — PowerShell `ConvertFrom-Json` fails on ADO responses with empty-string property names

**Symptom:** `ConvertFrom-Json` throws `InvalidOperationException: Key '' already present` (or similar) when parsing an Azure DevOps API response. The response parses successfully in jq or JavaScript.

**Cause:** Some Azure DevOps REST API responses contain a property with an empty string as the key. PowerShell's `ConvertFrom-Json` without `-AsHashtable` maps JSON to PSCustomObject, which cannot have an empty-string property name and throws an exception.

**Fix:** Always use `ConvertFrom-Json -AsHashtable` when parsing ADO API responses in PowerShell:

```powershell
# Wrong — may throw on some ADO responses
$result = $json | ConvertFrom-Json

# Correct
$result = $json | ConvertFrom-Json -AsHashtable
```

The bootstrap script (`tools/ado-bootstrap/bootstrap.ps1`) uses `-AsHashtable` throughout.

**How to verify:** Run `bootstrap.ps1` against the project with no `-WhatIf` flag. If there are no `ConvertFrom-Json` exceptions, the fix is in place.

---

## Bug 6 — GitHub issue search returns pull requests (bridge idempotency broken)

**Symptom:** Running `node tools/ado-github-bridge/dist/cli.js sync` with `--dry-run` shows `already-synced` for a work item that has never been synced. On a real run, the bridge does not create the GitHub issue. The Copilot coding agent never receives the work item.

**Cause:** The bridge checks idempotency by searching GitHub for an issue whose body contains a unique marker (`<!-- ADO-BRIDGE: AB#<id> -->`). The GitHub issue search API returns both issues **and pull requests** by default. When the Copilot coding agent opens a draft PR, it copies the issue body into the PR body (including the marker). The bridge's search matched the PR instead of the issue and concluded the item was already synced.

**Fix:** Add `is:issue` to the search query and filter out any result with a `pull_request` field:

```typescript
// In tools/ado-github-bridge/src/github.ts
const query = `repo:${owner}/${repo} is:issue "${marker}" in:body`;
const results = await octokit.search.issuesAndPullRequests({ q: query });
const issue = results.data.items.find(item => !item.pull_request);
```

The bridge already includes this fix. If you fork the bridge or write your own idempotency check, add `is:issue` to the query.

**How to verify:**
```powershell
node tools/ado-github-bridge/dist/cli.js sync --dry-run
```
The output should show `skipped` for items that have a GitHub issue and show `would create` for items that have no issue. Items with only a PR (but no issue) should show `would create`.

---

## Bug 7 — GitHub token scope: missing `workflow`

**Symptom:** The bridge or a pipeline step fails with `HttpError: Resource not accessible by integration` or `403: refusing to allow GitHub App to create/update workflow file`. Changes to `.github/workflows/` are rejected.

**Cause:** The GitHub token does not have the `workflow` scope. The `workflow` scope is required to push to `.github/workflows/`. A token with only `repo` scope is rejected for workflow file changes.

Secondary issue: the default `GITHUB_TOKEN` that Actions provides **cannot assign the Copilot coding agent**. Assigning Copilot requires a Personal Access Token.

**Fix:**

For the bridge (PAT):
- Create a PAT with scopes: `repo`, `issues` (for normal operation) + `workflow` (if the bridge must touch `.github/workflows/`)
- Set as `GITHUB_TOKEN` environment variable

For assigning Copilot:
- Create a PAT with `repo` scope
- Set as a separate secret (e.g., `COPILOT_ASSIGN_TOKEN`) in Azure DevOps Library or GitHub Actions secrets
- Do not store it in source

**How to verify:**
```powershell
# Check which scopes the current token has:
curl -s -I -H "Authorization: token <your-token>" https://api.github.com | grep -i x-oauth-scopes
# Should include: repo, issues (and workflow if needed)
```

---

## Bug 8 — Azure SRE Agent: API version, action mode, and connector type mismatches

**Symptom:** Bicep deployment fails with errors such as:
- `The property 'actionMode' contains value 'Autonomous' that is not valid for API version 2025-05-01-preview`
- `Resource type 'Microsoft.App/agents/dataConnectors' not found`
- `Deployment validation failed: The API version '2026-01-01' does not support the 'monthlyAgentUnitLimit' property`

**Cause:** The Azure SRE Agent API has discrepancies between different API versions and between documentation and reality. Three separate mismatches:

1. **API version.** The `2026-01-01` GA version lacks `monthlyAgentUnitLimit` and `experimentalSettings`. Use `2025-05-01-preview`.
2. **`actionMode` value.** The value is `'Automatic'` in the preview API, not `'Autonomous'`. The GA docs show `'Autonomous'` — these are different strings on different API versions.
3. **Child resource type.** The child resource for connectors is `Microsoft.App/agents/connectors`, not `Microsoft.App/agents/dataConnectors`.
4. **GitHub/ADO connectors.** These cannot be created through ARM at all. They are data-plane only and must be configured at `https://sre.azure.com`.

**Fix:** The `infra/modules/sre-agent.bicep` in this codebase uses the correct values:
- API version: `2025-05-01-preview`
- `actionMode`: `'Automatic'` or `'Review'` (not `'Autonomous'`)
- Child resource: `Microsoft.App/agents/connectors`

If you copy Bicep from official documentation or other samples, verify these three values before deploying.

**How to verify:**
```powershell
az bicep build --file infra/modules/sre-agent.bicep
# Must produce no errors

az deployment group validate `
    --resource-group <prefix>-rg-dev `
    --template-file infra/main.bicep `
    --parameters "@infra/main.parameters.json" `
    --parameters enableSreAgent=true
# Must return: { "error": null }
```

---

## Bug 9 — SRE Agent connector clobbering on redeploy

**Symptom:** After redeploying the Bicep stack with `enableSreAgent=true`, the GitHub and Azure DevOps connectors configured in the portal are gone. The agent no longer files GitHub issues or ADO work items after incidents.

**Cause:** ARM performs a full PUT on the parent `Microsoft.App/agents` resource during redeploy. This can reconcile child connector state to "nothing" if connectors are not explicitly included in the same deployment pass. The GitHub and ADO connectors are data-plane only (not expressible in ARM), so they are always absent from the ARM template — and get deleted on a full parent PUT.

**Reference:** [github.com/microsoft/sre-agent issue #30](https://github.com/microsoft/sre-agent/issues/30)

**Fix:**
1. If updating infrastructure without SRE Agent changes, set `enableSreAgent=false` in the parameters file before deploying. This skips the `sre-agent.bicep` module entirely.
2. If you must redeploy with `enableSreAgent=true`, pass `sreAgentSkipRbac=true` to avoid conflict errors, and verify connectors in the portal after deployment.
3. After redeployment, navigate to `https://sre.azure.com` → your agent → Connectors. If GitHub or ADO connectors are missing, re-add them per `docs/06-sre-runbook.md` §7.

**How to verify:** After redeployment, navigate to the SRE Agent portal and confirm the Connectors tab shows both the Application Insights connector (from Bicep) and the GitHub/ADO connectors (from the portal). If the portal connectors are missing, the clobbering occurred.

---

## Bug 10 — App Service slots require Standard tier

**Symptom:** Bicep deployment fails with `The selected pricing tier does not support deployment slots`. The pipeline's DeployProd stage fails at the slot creation step.

**Cause:** Azure App Service deployment slots are only available on Standard tier (S1) or above. The Basic tier (B1) does not support slots. If `enableSlots=true` is set with `sku=B1`, Azure rejects slot creation.

**Fix:** The `infra/modules/appservice.bicep` in this codebase automatically promotes the App Service Plan to S1 when `enableSlots=true`. This is intentional — silently shipping a pipeline that fails at deploy time is worse than the cost difference (approximately £26/month for B1 vs £56/month for S1 on a single plan).

For dev environments where cost matters and slot-based canary is not required, use `enableSlots=false` (the default). The prod parameters file (`infra/main.parameters.prod.json`) sets `enableSlots=true` and `sku=S1` explicitly.

**How to verify:**
```powershell
.\infra\deploy.ps1 -EnvironmentName dev -NamePrefix <prefix> -EnableSlots -WhatIf
# Output should show plan SKU as S1, not B1

.\infra\deploy.ps1 -EnvironmentName dev -NamePrefix <prefix> -WhatIf
# Output should show plan SKU as B1 (slots disabled)
```
