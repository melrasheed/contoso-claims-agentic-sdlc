# 01 — Tutorial: From empty org to live incident

This is the complete walkthrough. Every command is real and matches the actual scripts. Follow it in order.

**Time estimate:** 90–120 minutes for a first run; 30–40 minutes once familiar.

---

## Before you start

Complete `docs/00-quickstart.md` prerequisites first. You need:

- Azure CLI logged in: `az account show`
- PowerShell 7.4+
- Node 20 LTS
- Azure DevOps org admin rights
- GitHub repo admin rights
- GitHub Copilot Business or Enterprise

---

## Phase 1 — Azure DevOps setup (30 minutes)

### 1.1 Create the Azure DevOps project

**[PORTAL]** In `https://dev.azure.com/<your-org>`:

1. New project → Name: `Agentic SDLC` → Visibility: Private → Version control: Git → Work item process: **Basic**
2. Click **Create**.

> **Screenshot:** New project dialog with Basic process selected.

> **Why Basic?** The bootstrap script and bridge are process-aware and support all four ADO processes. Basic is the simplest starting point. If your org mandates Agile or Scrum, the tools detect and adapt automatically — see `tools/ado-bootstrap/ProcessMap.psm1`.

### 1.2 Bootstrap the project structure

```powershell
cd C:\path\to\contoso-claims-agentic-sdlc

.\tools\ado-bootstrap\bootstrap.ps1 `
    -Organization <your-ado-org> `
    -Project "Agentic SDLC"
```

The script uses your `az login` token — no PAT required. It creates:

- Area paths: `Contoso Claims`, `Platform`, `Infrastructure`
- Iterations: current sprint and next two sprints
- Four shared queries including `Active Critical Bugs` (used by the release gate)
- Sample Epic and child items tagged `ai-ready`

Expected output:
```
=== Resolving process template ===
  = Process template: Basic
=== Creating area paths ===
  + areas/Contoso Claims
  + areas/Platform
  + areas/Infrastructure
=== Creating iterations ===
  + iterations/Sprint 1
  + iterations/Sprint 2
  + iterations/Sprint 3
=== Creating work items ===
  + Epic 'Agentic SDLC Demo' (#1)
  + Issue 'Add dual-approval for high-value claims' (#2)
  + Issue 'Show risk score banding in claims list' (#3)
  + Task 'Bootstrap infrastructure' (#4)
=== Creating shared queries ===
  + Shared Queries/Active Critical Bugs
  + Shared Queries/AI Ready Items
  + Shared Queries/AI Implementing
  + Shared Queries/Release Gate
Summary: created 14  found 0
```

> **Screenshot:** Azure Boards showing the bootstrapped backlog with Epic #1 and items #2, #3, #4.

### 1.3 Verify the work items

**[PORTAL]** Open Azure Boards → Backlogs. Confirm you see Epic #1 with Issues #2 and #3 as children.

Check that items #2 and #3 carry the tag `ai-ready`. That tag is what the bridge watches.

---

## Phase 2 — GitHub setup (15 minutes)

### 2.1 Create or confirm the GitHub repository

This walkthrough uses `melrasheed/contoso-claims-agentic-sdlc`. Replace with your own `<owner>/<repo>`.

The repository must:
- Have the `.github/agents/` and `.github/copilot-instructions.md` files pushed to `main`
- Have GitHub Copilot enabled at the organisation level

### 2.2 Configure the MCP server

The authored agents use the Azure DevOps MCP server. Add it to `~/.copilot/mcp-config.json`:

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

> **Critical:** the MCP endpoint is `https://mcp.dev.azure.com/<org>`, **not** `https://dev.azure.com/<org>`. The wrong URL returns an HTML sign-in page with status 203, and zero ADO tools load. See `docs/07-troubleshooting.md` bug #1 for the diagnosis.

> **Note for VS Code users:** VS Code uses `"servers"` (not `"mcpServers"`) in `.vscode/mcp.json`. Same server definition, different key. See bug #2 in `docs/07-troubleshooting.md`.

### 2.3 Verify agent tools load

Open Copilot Chat in VS Code or GitHub.com. Type:

```
@sdlc-orchestrator What work items are currently in the backlog?
```

If ADO tools loaded correctly you will see the agent query Azure Boards and return a list. If you see "No tools available" or an empty list, consult `docs/07-troubleshooting.md` bug #1.

---

## Phase 3 — Run the SDLC lifecycle (20 minutes)

### 3.1 Refine a work item with the Business Analyst agent

Open Copilot Chat. Prompt:

```
@business-analyst
Work item AB#2 is "Add dual-approval for high-value claims". 
Refine this into a well-formed backlog item with Given/When/Then acceptance criteria 
and write it back to Azure Boards.
```

The agent reads the repository, drafts acceptance criteria, and updates the work item. Verify in Azure Boards that AB#2 now has a description with acceptance criteria.

### 3.2 Request an architecture decision

```
@architect
AB#2 requires a dual-approval workflow for claims above £50,000. 
Produce an ADR and link it to the work item.
```

The architect agent produces `docs/adr/0001-dual-approval-workflow.md` and adds a link to AB#2.

### 3.3 Tag the item as ready

If the business analyst agent has not already applied the tag, do it now:

**[PORTAL]** Azure Boards → AB#2 → Tags → add `ai-ready`.

### 3.4 Run the bridge to create a GitHub issue

Build the bridge first if not already done:

```powershell
cd tools/ado-github-bridge
npm ci
npm run build
cd ../..
```

Set environment variables:
```powershell
$env:ADO_ORG      = "<your-ado-org>"
$env:ADO_PROJECT  = "Agentic SDLC"
$env:GH_OWNER     = "<your-github-owner>"
$env:GH_REPO      = "contoso-claims-agentic-sdlc"
$env:GITHUB_TOKEN = "<your-github-pat>"
```

Dry run first:
```powershell
node tools/ado-github-bridge/dist/cli.js sync --dry-run
```

Then sync for real:
```powershell
node tools/ado-github-bridge/dist/cli.js sync
```

Expected output:
```
Bridging <org>/Agentic SDLC -> <owner>/contoso-claims-agentic-sdlc
--- Summary ---
  + AB#2 Add dual-approval for high-value claims -> #2 [copilot]
created=1 already-synced=0 skipped=0 failed=0
```

> **Screenshot:** GitHub issue #2 showing the rich context body, assigned to Copilot.

### 3.5 Verify the Azure Boards write-back

**[PORTAL]** Open Azure Boards → AB#2. Confirm:
- State changed to `Doing`
- Tags include `synced-to-github` and `ai-implementing`
- A Hyperlink relation exists pointing at the GitHub issue

> **Screenshot:** AB#2 showing the state, tags, and hyperlink relation.

### 3.6 Wait for Copilot to create a draft PR

The Copilot coding agent picks up the assigned issue and creates a draft pull request, typically within a few minutes. The PR body includes `AB#2` which links it back to Azure Boards automatically.

**[PORTAL]** GitHub → Pull requests → confirm a draft PR exists on branch `copilot/issue-2-*`.

> **Screenshot:** Draft PR with `AB#2` in the body, showing Copilot as author.

---

## Phase 4 — Review and pipeline (20 minutes)

### 4.1 Review the draft PR

The PR is a draft — Copilot does not auto-submit. Open it and:

1. Read the diff.
2. Run Copilot code review: PR → **Re-request review** → Copilot.
3. Engage the security reviewer agent:
   ```
   @security-reviewer
   Review the diff in PR #2 for exploitable vulnerabilities.
   ```
4. Engage the test engineer:
   ```
   @test-engineer
   Map the acceptance criteria on AB#2 to tests and identify any coverage gaps in PR #2.
   ```

### 4.2 Mark the PR ready and approve

Once reviews are satisfied, mark the PR **Ready for review** and add your approval.

> The rule: **Copilot cannot approve its own PR, and the person who triggered the agent cannot be the sole approver.** Require at least one additional human approval.

### 4.3 Run the pipeline

After merge, the pipeline triggers automatically. In Azure DevOps → Pipelines → the run progresses through:

1. **Build** — `npm ci`, lint, typecheck, 126 unit tests, Vite build
2. **SecurityScan** — `npm audit`, CredScan
3. **DeployDev** — Bicep + app deploy to dev
4. **VerifyDev** — smoke tests against the deployed API
5. **DeployProd** — staging slot → health check → swap (requires prod environment approval)
6. **PostDeploy** — App Insights release annotation

> **Screenshot:** Pipeline run showing all six stages green.

---

## Phase 5 — Deploy infrastructure (10 minutes)

If you have not already deployed to Azure:

```powershell
# Preview first
.\infra\deploy.ps1 -EnvironmentName dev -NamePrefix <your-prefix> -WhatIf

# Deploy
.\infra\deploy.ps1 -EnvironmentName dev -NamePrefix <your-prefix>
```

Prod deployment with staging slot (requires Standard tier — see `docs/04-release-gates.md`):
```powershell
.\infra\deploy.ps1 -EnvironmentName prod -NamePrefix <your-prefix> -EnableSlots
```

---

## Phase 6 — Trigger a live incident (15 minutes)

This demonstrates the Azure SRE Agent closing the feedback loop.

### Prerequisites for this phase

The SRE Agent must be deployed (see `docs/06-sre-runbook.md` §Deploying the SRE Agent) and the GitHub and ADO connectors must be configured in the portal.

### 6.1 Enable the fault injection endpoint

The API has a deliberate fault injection endpoint at `POST /api/admin/fault`. It requires the `ADMIN_ENABLED=true` environment variable on the App Service.

**[PORTAL]** Azure Portal → App Service (`<prefix>-api-dev`) → Configuration → Application settings → `ADMIN_ENABLED` = `true` → Save.

> This setting must never be enabled in a real production environment.

### 6.2 Inject a fault

```powershell
$apiUrl = "https://<prefix>-api-dev.azurewebsites.net"

# Inject 5xx errors
Invoke-RestMethod -Uri "$apiUrl/api/admin/fault" `
    -Method POST `
    -ContentType "application/json" `
    -Body '{"mode":"error","durationSeconds":300}'
```

The API now returns 500 errors on all claim operations.

### 6.3 Wait for the alert to fire

The Azure Monitor alert rule `<prefix>-alert-5xx-dev` fires when HTTP 5xx count exceeds 5 in a 5-minute window. This typically takes 3–5 minutes.

> **Screenshot:** Azure Monitor alert showing "Fired" state.

### 6.4 Observe the SRE Agent investigation

Navigate to `https://sre.azure.com` → your agent. In Review mode, each proposed action appears for approval. Accept:

1. **Query Application Insights** — agent retrieves exception traces
2. **Check deployment history** — agent correlates the fault with deployment events
3. **Read source code** — agent finds the fault injection endpoint
4. **Propose mitigation** — agent suggests disabling `ADMIN_ENABLED`

The agent then:
- Commits a fix to a new branch
- Files a GitHub issue
- Files an Azure DevOps work item (a Bug in Agile/Scrum, an Issue in Basic)
- Emits a structured remediation summary

### 6.5 Clear the fault and verify recovery

```powershell
Invoke-RestMethod -Uri "$apiUrl/api/admin/fault" `
    -Method POST `
    -ContentType "application/json" `
    -Body '{"mode":"none"}'
```

Confirm the alert resolves and Application Insights shows the error rate returning to zero.

### 6.6 Review the SRE Agent's fix branch

Open the fix branch PR in GitHub. Engage the SRE liaison agent:

```
@sre-liaison
The Azure SRE Agent has opened a fix branch for the incident where ADMIN_ENABLED 
was set in dev. Review the remediation summary, verify the fix addresses root cause, 
and assess whether the applied mitigation should become the permanent fix.
```

The sre-liaison agent verifies the fix, reviews the code, and advises on permanent remediation. Any surviving changes go through the **same** PR checks, Copilot code review, and release gates as human-authored code.

---

## Phase 7 — Tear down (optional)

```powershell
# Remove SRE Agent only (leaves app running)
az resource delete `
    --ids (az resource show `
        -g <prefix>-rg-dev `
        -n <prefix>-sre-agent-dev `
        --resource-type Microsoft.App/agents `
        --query id -o tsv)

# Remove everything
.\infra\teardown.ps1 -EnvironmentName dev -NamePrefix <your-prefix>
```

Confirm with `yes` when prompted. Deletion is asynchronous — monitor in the Azure Portal.

---

## Summary

You have walked through the complete agentic SDLC loop:

1. Backlog created and refined in Azure DevOps
2. Work items bridged to GitHub issues and assigned to Copilot
3. Draft PRs reviewed by agents and humans
4. Code deployed through a six-stage gated pipeline
5. A live incident detected, investigated, and mitigated by the Azure SRE Agent
6. Incident fed back as a governed backlog item

Next: `docs/02-agent-catalog.md` explains every agent in detail.
