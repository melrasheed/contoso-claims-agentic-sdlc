# 01 — Tutorial: From empty org to live incident

This is the complete walkthrough. Every command is real and matches the actual scripts. Follow it in order.

**Time estimate:** 90–120 minutes for a first run; 30–40 minutes once familiar.

> **Architecture note.** Azure DevOps is used for **planning only**. All CI/CD runs on **GitHub Actions**. You will not create an Azure Pipeline, a service connection or a variable group anywhere in this tutorial. Azure Boards keeps one delivery responsibility — it is the authority consulted before a production release, enforced by the gate in Phase 4. See [`09-why-this-split.md`](09-why-this-split.md).

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

> **Process prerequisite.** This accelerator uses the **Agile** process (`Epic`, `Feature`, `User Story`, `Bug`, `Task`; states `New`, `Active`, `Resolved`, `Closed`). Switching from Basic to Agile is a portal-only operation — there is no public REST API for it. **[PORTAL]** Organisation settings → Boards → Process → Agile → Change team projects → select the project → Change. This mapping is automatic: `Epic` stays `Epic`, `Issue` becomes `User Story`, `Task` stays `Task`. This is irreversible; test in a throwaway project first.

**[PORTAL]** In `https://dev.azure.com/<your-org>`:

1. New project → Name: `Agentic SDLC` → Visibility: Private → Version control: Git → Work item process: **Agile**
2. Click **Create**.

> **Screenshot:** New project dialog with Agile process selected.

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
  = Process template: Agile
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
  + User Story 'Add dual-approval for high-value claims' (#2)
  + User Story 'Show risk score banding in claims list' (#3)
  + Bug 'Adjudicating an already-paid claim returns 200 not 409' (#4)
=== Creating shared queries ===
  + Shared Queries/Active Critical Bugs
  + Shared Queries/AI Ready Items
  + Shared Queries/AI Implementing
  + Shared Queries/Release Gate
Summary: created 14  found 0
```

> **Screenshot:** Azure Boards showing the bootstrapped backlog with Epic #1 and items #2, #3 as User Stories.

### 1.3 Verify the work items

**[PORTAL]** Open Azure Boards → Backlogs. Confirm you see Epic #1 with User Stories #2 and #3 as children.

Check that items #2 and #3 carry the tag `ai-ready`. The `ai-ready` tag is a human triage signal — it means the item is refined and ready to hand to Copilot. No automation watches it; a human makes the deliberate decision to invoke Copilot from Boards.

---

## Phase 2 — GitHub setup (15 minutes)

### 2.1 Create or confirm the GitHub repository

This walkthrough uses `melrasheed/contoso-claims-agentic-sdlc`. Replace with your own `<owner>/<repo>`.

The repository must:
- Have the `.github/agents/` and `.github/copilot-instructions.md` files pushed to `main`
- Have GitHub Copilot enabled at the organisation level

### 2.2 Connect Azure Boards to GitHub

**[PORTAL]** In Azure DevOps → Project settings → GitHub connections → Add connection → select `<owner>/<repo>` and authorise.

This connection enables the native Copilot handoff. Once configured, any work item in Boards gains a **Send to Copilot** action. When a human invokes it, Copilot creates a `copilot/` branch and opens a draft pull request linked to the work item. No GitHub issue is created at any point.

### 2.3 Configure the MCP server

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

### 2.4 Verify agent tools load

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

### 3.3 Tag the item as ready for Copilot

The `ai-ready` tag is a human triage signal. When the business analyst agent has completed refinement, apply it:

**[PORTAL]** Azure Boards → AB#2 → Tags → add `ai-ready`.

The saved query `AI Ready Items` shows all items with this tag — it is a triage view for the person deciding what to hand to Copilot next. No automation acts on it.

### 3.4 Send the work item to Copilot from Boards

This is the governed handoff. A human makes a deliberate decision and a Copilot branch is created in one step.

**[PORTAL]** Azure Boards → AB#2 → context menu (the `...` icon) → **Send to Copilot** (or the equivalent action in the Boards UI after the GitHub connection is established).

Copilot receives the work item title, description, and acceptance criteria, creates a `copilot/` branch, and opens a draft pull request. The PR body contains `AB#2`, which Azure Boards links automatically.

> **No GitHub issue is created.** The handoff goes directly from the Azure Boards work item to a GitHub pull request. The GitHub issues tab stays empty by design.

### 3.5 Verify the Copilot branch and draft PR

**[PORTAL]** GitHub → Pull requests → confirm a draft PR exists on branch `copilot/<workitem-2-slug>`.

Verify the PR body contains `AB#2` — Azure Boards links to it automatically when it detects that token.

> **Screenshot:** Draft PR with `AB#2` in the body, showing Copilot as author.

---

## Phase 4 — Review and delivery (25 minutes)

### 4.1 Review the draft PR

The PR is a draft — Copilot does not auto-submit. Open it and:

1. Read the diff.
2. Run Copilot code review: PR → **Re-request review** → Copilot.
3. Engage the security reviewer agent:
   ```
   @security-reviewer
   Review the diff in PR #<N> for exploitable vulnerabilities.
   ```
4. Engage the test engineer:
   ```
   @test-engineer
   Map the acceptance criteria on AB#2 to tests and identify any coverage gaps in this PR.
   ```

### 4.2 Mark the PR ready and approve

Once reviews are satisfied, mark the PR **Ready for review** and add your approval.

> The rule: **Copilot cannot approve its own PR, and the person who triggered the agent cannot be the sole approver.** Require at least one additional human approval.

### 4.3 Wire GitHub Actions to Azure

Delivery runs on GitHub Actions. There is **no Azure Pipeline, no service connection and no variable group** — see `docs/09-why-this-split.md`.

Federate GitHub to Azure once:

```powershell
.\tools\configure-github-oidc.ps1 `
    -Repository <owner>/<repo> `
    -SubscriptionId <your-subscription-id> `
    -ResourceGroup rg-agentic-sdlc-dev
```

This creates an Entra ID application, federates it to the `dev` and `prod` environments, grants Contributor on that one resource group, and publishes `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_SUBSCRIPTION_ID` as repository variables. Nothing it creates is a secret.

Then create the environments and their protection rules:

```powershell
.\tools\configure-github-environments.ps1 `
    -Repository <owner>/<repo> `
    -Reviewers <your-github-username>
```

> **Verify, do not assume.** On a private repository, environment protection rules require GitHub Pro, Team or Enterprise. The API accepts them either way. Open Settings → Environments → prod and confirm the rules are actually shown.

### 4.4 Watch the release gate block a deployment

This is the control that keeps Azure Boards authoritative over releases.

```powershell
gh workflow run cd.yml -f gate-only=true
gh run watch
```

The run **fails on purpose**, because the sample backlog contains an open Sev1 bug:

```
### Azure Boards release gate — BLOCKED

Blocking work items: 1 (tolerance 0)

| ID | Type | Title                                                  | State  |
| 4  | Bug  | Adjudicating an already-paid claim returns 200 not 409 | Active |
```

Azure Pipelines provides this as a built-in *Query Work Items* check. GitHub Environments cannot consult an external backlog, so `tools/delivery/boards-gate.mjs` implements it. It **fails closed** — an unreachable Azure DevOps blocks the release rather than silently allowing it.

Now close work item #4 in Azure Boards and re-run:

```powershell
gh workflow run cd.yml -f gate-only=true
```

The gate passes.

> A blocked release here is a **success**. The system refused to ship on top of a known critical defect, and the decision came from the backlog rather than from the pipeline.

### 4.5 Deploy through the workflow

```powershell
# Deploy to dev only
gh workflow run cd.yml

# Deploy through to production (requires approval on the prod environment)
gh workflow run cd.yml -f deploy-prod=true
```

The workflow runs: build → deploy-dev → verify-dev → boards-gate → *(approval)* → staging slot → health check → swap → post-swap health check → GitHub Release → Azure Boards write-back.

If the post-swap health check fails, the workflow **swaps back automatically** and marks the run failed.

Check that Azure Boards received the deployment record:

**[PORTAL]** Boards → AB#2 → Discussion. There should be a comment naming the environment, version and workflow run.

> **Screenshot:** the `cd.yml` run graph with the boards-gate job, alongside the deployment comment on the work item.

---

## Phase 5 — Deploy infrastructure directly (10 minutes)

The workflow deploys application code to infrastructure that already exists. To create or change the infrastructure itself:

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
2. Work item sent to Copilot natively from Azure Boards; Copilot created a draft pull request
3. Draft PRs reviewed by agents and humans
4. Code delivered through GitHub Actions, blocked by an Azure Boards gate until the backlog was clear
5. A live incident detected, investigated, and mitigated by the Azure SRE Agent
6. Incident fed back as a governed backlog item

Next: `docs/02-agent-catalog.md` explains every agent in detail.
