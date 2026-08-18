# Agentic SDLC Accelerator — Pipelines

This directory contains Azure Pipelines YAML for building, securing, and deploying the Contoso Claims app.

---

## Directory structure

```
pipelines/
├── azure-pipelines.yml          Main multi-stage pipeline
├── configure-checks.ps1         Script to configure ADO environment checks
├── README.md                    This file
└── templates/
    ├── build-job.yml            Stage 1: Build all workspaces
    ├── security-scan-job.yml    Stage 2: Security scan (blocking)
    ├── deploy-job.yml           Stage 3 / dev deploy template
    ├── deploy-prod-job.yml      Stage 5: Prod slot-swap deployment + rollback
    ├── verify-job.yml           Stage 4: Smoke tests
    └── post-deploy-job.yml      Stage 6: Telemetry + release annotation
```

---

## Stages

| # | Stage | Trigger | Purpose |
|---|-------|---------|---------|
| 1 | **Build** | Every push | `npm ci`, lint, typecheck, unit tests with coverage, build all workspaces, publish artifacts |
| 2 | **SecurityScan** | After Build | `npm audit --audit-level=high`, Microsoft Security DevOps (CredScan), CodeQL placeholder |
| 3 | **DeployDev** | After SecurityScan (not PR) | Bicep infra + API + Web SPA to dev environment |
| 4 | **VerifyDev** | After DeployDev | Smoke tests: `/health`, `/api/claims` |
| 5 | **DeployProd** | After VerifyDev (main branch only) | Bicep prod + API to staging slot → health check → swap → rollback if health fails |
| 6 | **PostDeploy** | After DeployProd | Final health check + App Insights release annotation |

---

## Service Connection (OIDC / Workload Identity Federation)

**Recommended: Workload Identity Federation (no secrets)**

1. In Azure DevOps: **Project Settings → Service connections → New service connection → Azure Resource Manager → Workload identity federation (automatic)**
2. Name it exactly: `azure-svc-connection`
3. Subscription: `8327fd6b-5af3-4e8d-86d3-d48e5d12d8c7` (ME-MngEnvMCAP493490)
4. Leave "Resource Group" blank (pipeline-level scope)
5. Grant access to all pipelines, or lock to this pipeline specifically
6. This creates a federated credential on a new App Registration — no client secrets to rotate

> If OIDC is unavailable (e.g., older ADO agent), fall back to **Service Principal with certificate** (never a plain client secret).

---

## Variable Groups

Create these in **Pipelines → Library → Variable Groups**:

### `agentic-sdlc-common`
| Variable | Example value |
|----------|---------------|
| `AZURE_SUBSCRIPTION_ID` | `8327fd6b-5af3-4e8d-86d3-d48e5d12d8c7` |
| `AZURE_TENANT_ID` | `e9aef5a6-034f-43b1-b250-31b77e3e427b` |
| `NAME_PREFIX` | `contoso` |
| `ALERT_EMAIL` | `ops-team@example.com` |

### `agentic-sdlc-dev`
| Variable | Example value |
|----------|---------------|
| `VITE_API_BASE_URL` | `https://contoso-api-dev.azurewebsites.net` |
| `AZURE_RESOURCE_GROUP` | `contoso-rg-dev` |
| `AZURE_LOCATION` | `eastus` |

### `agentic-sdlc-prod`
| Variable | Example value |
|----------|---------------|
| `VITE_API_BASE_URL` | `https://contoso-api-prod.azurewebsites.net` |
| `AZURE_RESOURCE_GROUP` | `contoso-rg-prod` |
| `AZURE_LOCATION` | `eastus` |

---

## Environments

Create two environments in **Pipelines → Environments**:

| Environment | Checks |
|-------------|--------|
| `dev` | None (auto-deploys) |
| `prod` | Approvals + Checks (see §Gates below) |

---

## Gates on the `prod` Environment

> **Run `pipelines/configure-checks.ps1`** to automate what is API-configurable, then complete the manual steps below.

### Checks to configure in the portal (Environments → prod → Approvals and checks → +):

#### 1. ✅ Query Work Items *(REQUIRED — must be done in portal)*
Blocks deployment if any active Sev1 or Sev2 bugs exist.

**Setup:**
1. Create a shared work item query in **Boards → Queries → New query → Shared Queries**:
   - Name: `Active Critical Bugs`
   - Type: Flat list
   - Filters:
     ```
     Work Item Type = Bug
     AND Severity IN (1 - Critical, 2 - High)
     AND State NOT IN (Closed, Resolved, Done)
     ```
   - Save to: Shared Queries / `Agentic SDLC`

2. Add the check:
   - Check type: **Query Work Items**
   - Query: `Active Critical Bugs` (shared query above)
   - Maximum threshold: `0`
   - This blocks deployment if ANY active Sev1/Sev2 bugs exist

#### 2. ✅ Business Hours *(configurable via API — run configure-checks.ps1)*
- Time zone: UTC
- Days: Monday – Friday
- Hours: 09:00 – 17:00

#### 3. ✅ Exclusive Lock *(configurable via API — run configure-checks.ps1)*
Prevents concurrent deployments to prod.

#### 4. ✅ Approvals *(REQUIRED — must be done in portal)*
- Add your release manager or approval group
- Instructions: "Confirm no active Sev1/Sev2 bugs and business hours check is satisfied."

---

## CodeQL

Full CodeQL analysis requires **GitHub Advanced Security (GHAS) for Azure DevOps**.

To enable:
1. Go to **Project Settings → Microsoft Security → GitHub Advanced Security**
2. Enable on the repository
3. In `security-scan-job.yml`, replace the placeholder script with:
   ```yaml
   - task: AdvancedSecurity-Codeql-Init@1
     inputs:
       languages: 'javascript'
   - task: AdvancedSecurity-Codeql-Autobuild@1
   - task: AdvancedSecurity-Codeql-Analyze@1
   ```

---

## Microsoft Security DevOps Extension

The SecurityScan stage uses the `MicrosoftSecurityDevOps@1` task which requires the **Microsoft Security DevOps** Azure DevOps extension.

Install from: https://marketplace.visualstudio.com/items?itemName=ms-securitydevops.microsoft-security-devops-azdevops

---

## Importing the pipeline into Azure DevOps

1. **Pipelines → New Pipeline**
2. **Where is your code?** → GitHub (or Azure Repos)
3. Select repository: `melrasheed/contoso-claims-agentic-sdlc`
4. **Configure your pipeline** → Existing Azure Pipelines YAML file
5. Branch: `main`, Path: `/pipelines/azure-pipelines.yml`
6. Review → Save (don't run yet — set up variable groups and service connection first)

---

## SKU / Slot decision

| Environment | SKU | Slots | Monthly cost (approx) |
|-------------|-----|-------|-----------------------|
| dev | B1 | none | ~$26/mo (2 apps on 1 plan) |
| prod | S1 | staging on API | ~$56/mo (1 plan) |

- **B1 (Basic) does NOT support deployment slots** — Azure API rejects slot creation.
- `enableSlots=false` → B1 (cheapest dev budget)
- `enableSlots=true` → automatically promotes to **S1 (Standard)** minimum
- prod parameters file sets `enableSlots=true` and `sku=S1` explicitly

---

## VITE_API_BASE_URL note

Vite **inlines** environment variables at **build time**. The `VITE_API_BASE_URL` value in the variable group must be set to the correct API URL **before** the build step runs. It is NOT read at runtime by the SPA.

The app setting on the Web App is a documentation marker only.
