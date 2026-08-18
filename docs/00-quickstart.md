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

Expected: all 126 tests pass.

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

Note the API URL — you need it for the pipeline variable group in the next step.

---

## Step 5 — Configure the pipeline

1. **Create variable groups** in Azure DevOps → Pipelines → Library → Variable Groups. See `pipelines/README.md` §Variable Groups for the exact variable names and values.

2. **Create a service connection** (OIDC / Workload Identity Federation):
   - Project Settings → Service connections → New → Azure Resource Manager → Workload identity federation (automatic)
   - Name it exactly: `azure-svc-connection`

3. **Create environments**:
   - Pipelines → Environments → New → `dev` (no checks)
   - Pipelines → Environments → New → `prod` (add approval later)

4. **Import the pipeline**:
   - Pipelines → New Pipeline → GitHub → your repository
   - Existing YAML file → branch `main`, path `/pipelines/azure-pipelines.yml`
   - Save (do not run yet)

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

## What to do next

- Follow the full tutorial: `docs/01-tutorial.md`
- Read the agent catalog: `docs/02-agent-catalog.md`
- Configure release gates: `docs/04-release-gates.md`
- Set up the SRE Agent: `docs/06-sre-runbook.md`

If anything fails, see `docs/07-troubleshooting.md`.
