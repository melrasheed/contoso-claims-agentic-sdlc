# 00 — Quickstart

Get the Agentic SDLC Accelerator running against your own Azure DevOps organisation and GitHub repository in under 30 minutes.

---

## Prerequisites

| Requirement | Version / notes |
|---|---|
| Node.js | 20 LTS (`node --version` should show `v20.x`) |
| npm | 10+ (ships with Node 20) |
| PowerShell | 7.4+ (`$PSVersionTable.PSVersion`) |
| Azure CLI | 2.60+ (`az --version`) |
| Git | Any recent version |
| Azure subscription | Owner or Contributor on the target subscription |
| Azure DevOps | Organisation admin, or the ability to create projects |
| GitHub | Repository admin on the target repo |
| GitHub Copilot | Copilot Business or Enterprise licence on the org |
| GitHub CLI | 2.40+ (`gh --version`), authenticated with `gh auth login` |

> **Delivery runs on GitHub Actions.** Azure DevOps is used for planning only. You will not create a service connection, a variable group or an Azure Pipeline anywhere in this guide. See `docs/09-why-this-split.md` for the reasoning.

**Verify Node and npm:**
```powershell
node --version   # v20.x
npm --version    # 10.x
```

**Log in to Azure:**
```powershell
az login
az account show --query "{subscription:name, id:id}" -o table
```

---

## Step 1 — Clone the repository

```powershell
git clone https://github.com/melrasheed/contoso-claims-agentic-sdlc.git
cd contoso-claims-agentic-sdlc
```

---

## Step 2 — Install dependencies and run tests

```powershell
npm ci
npm test
```

Expected: all tests pass (182 at the time of writing).

---

## Step 3 — Bootstrap Azure DevOps

```powershell
.\tools\ado-bootstrap\bootstrap.ps1 `
    -Organization <your-ado-org> `
    -Project "Agentic SDLC"
```

The script authenticates using `az login` (no PAT required). It creates area paths, iterations, four shared queries, and a sample backlog. It is idempotent — safe to re-run.

Preview what it would create without making changes:
```powershell
.\tools\ado-bootstrap\bootstrap.ps1 `
    -Organization <your-ado-org> `
    -Project "Agentic SDLC" `
    -WhatIf
```

**Success looks like:**
```
=== Resolving process template ===
  = Process template: Basic
=== Creating area paths ===
  + areas/Contoso Claims
  + areas/Platform
...
Summary: created 14  found 0
```

---

## Step 4 — Deploy infrastructure to Azure

```powershell
.\infra\deploy.ps1 -EnvironmentName dev -NamePrefix <your-prefix>
```

`<your-prefix>` must be 10 characters or fewer, letters and numbers only. It is used in all resource names.

Preview with what-if:
```powershell
.\infra\deploy.ps1 -EnvironmentName dev -NamePrefix <your-prefix> -WhatIf
```

**Success looks like:**
```
✓ Deployment succeeded!
Deployment Outputs:
{ "apiAppUrl": { "value": "https://<prefix>-api-dev.azurewebsites.net" }, ... }
```

Note the API URL — the CD workflow bakes it into the SPA at build time.

---

## Step 5 — Wire GitHub Actions to Azure (OIDC, no secrets)

Delivery runs on GitHub Actions. There is no Azure DevOps service connection, no variable group, and no stored credential.

**a. Federate GitHub to Azure:**

```powershell
.\tools\configure-github-oidc.ps1 `
    -Repository <owner>/<repo> `
    -SubscriptionId <your-subscription-id> `
    -ResourceGroup rg-agentic-sdlc-dev
```

This creates an Entra ID application, federates it to the `dev` and `prod` GitHub environments, grants Contributor on that resource group only, and sets `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and `AZURE_SUBSCRIPTION_ID` as repository **variables**. They are identifiers, not secrets.

**b. Create the environments and their protection rules:**

```powershell
.\tools\configure-github-environments.ps1 `
    -Repository <owner>/<repo> `
    -Reviewers <your-github-username>
```

`dev` is deliberately unprotected. `prod` requires a human approval, prevents self-review, and only accepts deployments from protected branches.

**Success looks like:**
```
=== Environment: prod ===
  + prod
  +   required reviewers: alice
  +   protected branches only
  +   self-review prevented
```

> On a **private** repository, environment protection rules need GitHub Pro, Team or Enterprise. On a free private repo the rules are silently ignored — check the environment settings page rather than assuming.

---

## Step 6 — Configure the bridge

Set environment variables for the ADO–GitHub bridge:

```powershell
$env:ADO_ORG       = "<your-ado-org>"
$env:ADO_PROJECT   = "Agentic SDLC"
$env:GH_OWNER      = "<your-github-org-or-user>"
$env:GH_REPO       = "contoso-claims-agentic-sdlc"
$env:GITHUB_TOKEN  = "<your-github-pat>"   # needs repo + issues scope
```

Verify connectivity:
```powershell
npx --prefix tools/ado-github-bridge ts-node -e "
  const {loadConfig} = require('./src/config.js');
  console.log(loadConfig());
" 
# or run the compiled binary:
node tools/ado-github-bridge/dist/cli.js doctor
```

---

## Step 7 — Run a sync

```powershell
node tools/ado-github-bridge/dist/cli.js sync --dry-run
```

Review what would be created, then run for real:
```powershell
node tools/ado-github-bridge/dist/cli.js sync
```

**Success looks like:**
```
Bridging contoso/Agentic SDLC -> contoso/contoso-claims-agentic-sdlc
--- Summary ---
  + AB#2 Add dual-approval for high-value claims -> #2 [copilot]
created=1 already-synced=0 skipped=0 failed=0
```

---

## Step 8 — Watch the release gate work

This is the control that keeps Azure Boards authoritative over releases even though delivery runs on GitHub Actions.

```powershell
gh workflow run cd.yml -f gate-only=true
gh run watch
```

The sample backlog includes an open Sev1 defect, so the first run **fails on purpose**:

```
### Azure Boards release gate — BLOCKED

Blocking work items: 1 (tolerance 0)

| ID | Type  | Title                                                    | State |
| 4  | Issue | Adjudicating an already-paid claim returns 200 not 409   | To Do |
```

Close work item #4 in Azure Boards and re-run. The gate passes and the deployment proceeds.

A blocked release here is a **success**, not a failure — the system refused to ship on top of a known critical defect.

---

## What to do next

- Follow the full tutorial: `docs/01-tutorial.md`
- Read the agent catalog: `docs/02-agent-catalog.md`
- Understand the gates: `docs/04-release-gates.md`
- Understand the architecture choice: `docs/09-why-this-split.md`
- Set up the SRE Agent: `docs/06-sre-runbook.md`

If anything fails, see `docs/07-troubleshooting.md`.
