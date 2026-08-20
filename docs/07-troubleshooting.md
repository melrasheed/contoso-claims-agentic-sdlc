# 07 — Troubleshooting

All bugs below were discovered and fixed during development of this accelerator. Each entry gives the symptom, root cause, exact fix, and how to verify it is resolved.

Bugs 1–10 were found while building the original implementation. Bugs 11–17 concern the GitHub Actions delivery model and the Azure Boards release gate — jump to [Delivery and release gate failures](#delivery-and-release-gate-failures) if that is what you are debugging.

---

## Bug 1 — ADO MCP server: wrong host URL

**Symptom:** Zero Azure DevOps tools load in Copilot Chat. Prompting an authored agent results in "I don't have any Azure DevOps tools available" or the agent falls back to REST calls that fail. No error message is shown — it fails silently.

**Cause:** The Azure DevOps MCP endpoint is on a **different host** from the regular ADO UI. `~/.copilot/mcp-config.json` was pointing at `https://dev.azure.com/<org>`, which returns a `203` status with an HTML sign-in page. The MCP client receives HTML, parses zero tools, and continues silently.

The correct MCP host is `https://mcp.dev.azure.com/<org>`. That URL returns `401` with a `WWW-Authenticate` header pointing at `/.well-known/oauth-protected-resource/`, which is the correct behaviour for an OAuth-protected API endpoint.

**Fix:**

In `~/.copilot/mcp-config.json` — the remote server speaks streamable HTTP, so it is configured as a `type: "http"` entry, not a `stdio` command:

```json
{
  "mcpServers": {
    "azure-devops": {
      "type": "http",
      "url": "https://mcp.dev.azure.com/<your-ado-org>",
      "tools": ["*"]
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

## Bug 4 — Process template: type and field availability

**Symptom:** Scripted creation of `Feature`, `Bug`, `User Story`, or `Product Backlog Item` work items fails on a Basic project. On an Agile project, severity-based release gate queries fail silently if the project was recently migrated.

**Cause:** The Azure DevOps **Basic process** is minimal — valid types are `Epic`, `Issue`, and `Task` only, with no severity field or acceptance criteria field. The **Agile process** adds `Feature`, `User Story`, `Bug`, `Task`, the `Microsoft.VSTS.Common.Severity` field, and the `Microsoft.VSTS.Common.AcceptanceCriteria` field.

This accelerator targets the **Agile process**. Changing from Basic to Agile is a portal-only operation — **there is no public REST API for it**.

**Fix option A — migrate to Agile (recommended):**

**[PORTAL]** Organisation settings → Boards → Process → Agile → Change team projects → select the project → Change.

> **Verified behaviour, and it is not what the mapping table implies.** Migrating Basic → Agile switches the *process*, but **existing work items keep their original type and state**. Items created as `Issue` remain `Issue` and keep Basic states such as `To Do` and `Doing`; they are **not** converted to `User Story`.
>
> This matters more than it looks. Agile also has an `Issue` type, but it models an impediment and sits in **no backlog category** — confirmed by querying `_apis/wit/workitemtypecategories`, where `Microsoft.RequirementCategory` contains only `User Story`. Since the native "Send to Copilot" action requires a Requirement- or Task-category type, a migrated `Issue` **cannot be handed to Copilot**, and a severity-based gate query will never match it because `Issue` is not a `Bug`.
>
> The symptom is confusing: the process reports as Agile, the new types are all available, and yet the backlog behaves as though nothing changed.

**Convert existing items after migrating.** Type and state can both be set in one PATCH:

```powershell
$tok = az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv
$h = @{ Authorization = "Bearer $tok"; 'Content-Type' = 'application/json-patch+json' }
$ops = @(
  @{ op='add'; path='/fields/System.WorkItemType'; value='User Story' }
  @{ op='add'; path='/fields/System.State';        value='New' }
) | ConvertTo-Json -Depth 5
Invoke-RestMethod "https://dev.azure.com/<org>/_apis/wit/workitems/<id>?api-version=7.1" `
  -Headers $h -Method PATCH -Body $ops
```

For defects, convert to `Bug` and set `Microsoft.VSTS.Common.Severity` (for example `1 - Critical`) so the release gate matches on severity rather than a tag.

**Fix option B — adapt to Basic (fallback, not recommended):** The bootstrap script and `ProcessMap.psm1` detect the process and use the correct types and fields for whatever process the project runs. On Basic, the release gate falls back to a `sev1` tag rather than a severity field. This produces correct gate behaviour but loses the `Bug` type, the Severity field, and the AcceptanceCriteria field — and, critically, leaves no Requirement-category type for the native Copilot handoff.

**How to verify:** confirm the process *and* the item types, because the first can be right while the second is wrong:

```powershell
# Process must report Agile
$p = (Invoke-WebRequest "https://dev.azure.com/<org>/_apis/projects/<projectId>?includeCapabilities=true&api-version=7.1" -Headers $h).Content |
     ConvertFrom-Json -AsHashtable
$p.capabilities.processTemplate.templateName          # -> Agile

# Requirement category must contain User Story
$c = (Invoke-WebRequest "https://dev.azure.com/<org>/<project>/_apis/wit/workitemtypecategories?api-version=7.1" -Headers $h).Content |
     ConvertFrom-Json -AsHashtable
($c.value | Where-Object referenceName -eq 'Microsoft.RequirementCategory').workItemTypes.name
```

Then confirm no work item is still of type `Issue`, and that the defect used by the gate demo is a `Bug` with a Severity value.

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

## Bug 7 — GitHub token scope: missing `workflow`

**Symptom:** A pipeline step fails with `HttpError: Resource not accessible by integration` or `403: refusing to allow GitHub App to create/update workflow file`. Changes to `.github/workflows/` are rejected.

**Cause:** The GitHub token does not have the `workflow` scope. The `workflow` scope is required to push to `.github/workflows/`. A token with only `repo` scope is rejected for workflow file changes.

**Fix:**

For pipeline steps that push to `.github/workflows/`:
- Create a PAT with scopes: `repo` + `workflow`
- Set as the relevant secret in GitHub Actions

**How to verify:**
```powershell
# Check which scopes the current token has:
gh auth status   # scopes must include 'workflow'
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

**Symptom:** Bicep deployment fails with `The selected pricing tier does not support deployment slots`. The `deploy-prod` job fails at the slot deployment step.

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

---

# Delivery and release gate failures

These concern the GitHub Actions delivery model. Delivery does **not** run on Azure Pipelines — see [`09-why-this-split.md`](09-why-this-split.md).

---

## Bug 11 — `azure/login` fails with AADSTS70021

**Symptom:**

```
AADSTS70021: No matching federated identity record found for presented assertion.
Assertion Issuer: 'https://token.actions.githubusercontent.com'.
Assertion Subject: 'repo:owner/repo:ref:refs/heads/main'.
```

**Cause:** OIDC federated credentials match on an exact **subject**. `tools/configure-github-oidc.ps1` creates environment-scoped subjects:

```
repo:owner/repo:environment:dev
repo:owner/repo:environment:prod
```

If the job does not declare `environment:`, GitHub presents `...:ref:refs/heads/main` instead, which matches nothing. Note the assertion subject in the error message tells you exactly what was presented — read it rather than guessing.

This is a **feature, not an obstacle**: it is what makes the environment approval enforceable by the identity system rather than only by workflow YAML.

**Fix:** either add the environment to the job:

```yaml
jobs:
  deploy-dev:
    environment:
      name: dev          # must match the federated credential subject
```

or, for a job that legitimately runs outside an environment (such as the release gate), add a branch-scoped credential:

```powershell
.\tools\configure-github-oidc.ps1 -Repository owner/repo `
    -SubscriptionId <id> -ResourceGroup <rg> -IncludeBranchCredential
```

**How to verify:**
```powershell
az ad app federated-credential list --id <app-id> --query "[].{name:name, subject:subject}" -o table
```
The subject list must contain exactly what the failing run reported.

---

## Bug 12 — Release gate passes when it should block

**Symptom:** A known Sev1 defect is open in Azure Boards, but the `boards-gate` job reports `blocking-count=0` and the deployment proceeds.

**Cause:** Almost always the **query**, not the gate. Two common variants:

1. **Wrong state exclusion.** Agile states are `New`, `Active`, `Resolved`, `Closed`. A query excluding `Closed` but not `Resolved` may miss resolved-but-not-closed bugs. Verify the query logic matches your team's closing conventions.
2. **Query path typo.** A mistyped `ADO_QUERY_PATH` raises an error rather than passing silently — but only because the gate fails closed.

**Fix:** run the query in the Azure Boards UI first and confirm it returns the item you expect. Then confirm the gate sees the same:

```powershell
$env:ADO_ORGANIZATION = "<org>"
$env:ADO_PROJECT      = "<project>"
$env:ADO_QUERY_PATH   = "Shared Queries/Release Gate - active Sev1 Sev2 bugs"
$env:GATE_ENFORCE     = "false"     # report without failing
node tools/delivery/boards-gate.mjs
```

**How to verify:** with an open Sev1 bug in Active state, the gate must exit `1` and name the item. A gate that has never been seen to block has never been tested.

---

## Bug 13 — Environment protection rules silently ignored

**Symptom:** `prod` has required reviewers configured, but deployments proceed without anyone approving.

**Cause:** Deployment protection rules on **private** repositories require GitHub Pro, Team or Enterprise. On a free private repository the environment is created and the rules are accepted by the API, but **not enforced**. Nothing warns you.

**Fix:** make the repository public, or upgrade the plan. `tools/configure-github-environments.ps1` prints a warning when it detects a private repository on a personal account.

**How to verify:** open Settings → Environments → prod. If the protection rules section is absent or greyed out, they are not being enforced. Do not rely on the API response — it returns success either way.

---

## Bug 14 — API deploys but returns 500 with MODULE_NOT_FOUND

**Symptom:** The deployment succeeds; the app fails to start. Log stream shows:

```
Error: Cannot find module '@contoso/shared'
```

**Cause:** `apps/api` depends on the `@contoso/shared` workspace package. npm workspaces links it with a **symlink**, and symlinks do not survive a zip archive. The deployed bundle therefore has a dependency that resolves to nothing.

**Fix:** the `build` job in `cd.yml` copies the built package in explicitly after the production install:

```bash
npm install --omit=dev --no-package-lock
mkdir -p node_modules/@contoso
cp -r "$GITHUB_WORKSPACE/packages/shared" node_modules/@contoso/shared
```

Order matters: `npm install` clobbers a pre-created `node_modules/@contoso`, so the copy must come **after**.

**How to verify:**
```powershell
curl https://<api-app>.azurewebsites.net/health   # expect 200
az webapp log tail --name <api-app> --resource-group <rg>
```

---

## Bug 15 — SPA calls localhost in production

**Symptom:** The deployed web app loads, but every API call fails. The browser console shows requests to `http://localhost:3001`.

**Cause:** Vite inlines `VITE_*` variables at **build** time, not run time. Setting `VITE_API_BASE_URL` as an App Service application setting does nothing — the value was already baked into the JavaScript bundle when it was built.

**Fix:** set it in the build step, before `vite build`:

```yaml
- name: Build web SPA with the real API URL
  env:
    VITE_API_BASE_URL: https://${{ env.API_APP_NAME }}.azurewebsites.net
  run: npm run build --workspace @contoso/claims-web
```

**How to verify:**
```powershell
# The built bundle should contain the real hostname
Select-String -Path apps/web/dist/assets/*.js -Pattern "azurewebsites.net" -SimpleMatch | Select-Object -First 1
```

---

## Bug 16 — Push to `main` rejected by branch protection

**Symptom:**

```
remote: error: GH013: Repository rule violations found for refs/heads/main.
remote: - Changes must be made through a pull request.
remote: - refusing to allow an OAuth App to create or update workflow
          `.github/workflows/cd.yml` without `workflow` scope
```

**Cause:** Two separate problems reported together.

1. The branch ruleset requires a pull request. This is the control working correctly.
2. The git credential in use lacks the `workflow` scope, which is required to push any file under `.github/workflows/`.

**Fix:** for the first, open a pull request rather than pushing to `main`. For the second, refresh the token scope:

```powershell
gh auth refresh -h github.com -s workflow
gh auth setup-git
```

Note that `gh auth token` and the credential git actually uses can differ — `GH_TOKEN` in the environment takes precedence over the keyring and often has narrower scopes. Clear it if in doubt.

**How to verify:**
```powershell
gh auth status   # scopes must include 'workflow'
```

---

## Bug 17 — Required status check never resolves: pull request stuck as "Waiting"

**Symptom:** A pull request against `main` shows a required check permanently in "Waiting" state. The check is listed in the branch ruleset, but no corresponding run ever appears in the PR's checks tab. Merging is blocked. CI is running and passing, but the specific required check context never resolves.

**Cause:** The required status check *context* in the branch ruleset did not match any job id reported by the CI workflow. GitHub's behaviour in this case is silent: it lists the check as required and waits indefinitely, producing no error and no warning. The branch still appears protected, but the check has effectively never been evaluated.

This is a configuration gap, not a bug in the workflow itself. The most common trigger is renaming a CI job without updating the ruleset, or copying a ruleset from another repository where the job had a different name.

In this repository the problem occurred because the CI job's display name was `"Lint, typecheck, test, build"` while the ruleset required the context `build-and-test`. They never matched. The fix was to give the job the stable id `build-and-test` in `ci.yml` and to update the ruleset.

The secondary consequence is significant: **a required context that matches nothing silently enforces nothing while the branch still appears protected**. The branch protection dashboard shows a green tick; in practice any PR could merge without tests passing.

**Fix:**

1. Check what contexts the ruleset currently requires:
   ```powershell
   gh api repos/<owner>/<repo>/rules/branches/main `
     --jq '.[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context'
   ```

2. Check what job ids the CI workflow actually reports on a recent run:
   ```powershell
   gh run list --workflow=ci.yml --limit=1 --json databaseId --jq '.[0].databaseId' | `
     ForEach-Object { gh run view $_ --json jobs --jq '.jobs[].name' }
   ```

3. The two lists must match exactly. Update the ruleset to use the job id (`build-and-test`), not the display name.

4. If you use `tools/configure-branch-protection.ps1`, it validates this automatically: it reads job names from `.github/workflows/` and refuses to apply a ruleset containing a context that matches no job. The `-SkipCheckNameVerification` flag bypasses this only for genuinely external checks (such as CodeQL or third-party scanners).

**How to verify:** Open a pull request and confirm the `build-and-test` check appears and resolves (green or red) within a few minutes of a push. "Waiting" means the context still does not match.
