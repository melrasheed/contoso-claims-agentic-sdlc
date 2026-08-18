# Deployment Guide — Agentic SDLC Accelerator (Dev)

## Live URLs

| Service | URL |
|---------|-----|
| **API** | `https://asdlcmel-api-dev.azurewebsites.net` |
| **Web SPA** | `https://asdlcmel-web-dev.azurewebsites.net` |

---

## Resource Inventory

**Resource Group:** `rg-agentic-sdlc-dev` | **Region:** `westus2`

| Resource Name | Type | Notes |
|---------------|------|-------|
| `asdlcmel-asp-dev` | App Service Plan (B1 Linux) | Shared by both apps |
| `asdlcmel-api-dev` | Web App (Node 20) | Express API |
| `asdlcmel-web-dev` | Web App (Node 20) | Vite SPA via `serve` |
| `asdlcmel-ai-dev` | Application Insights | Workspace-based |
| `asdlcmel-law-dev` | Log Analytics Workspace | |
| `asdlcmel-id-dev` | User-Assigned Managed Identity | |
| `asdlcmel-ag-dev` | Action Group | Email: ops-team@example.com |
| `asdlcmel-alert-5xx-dev` | Metric Alert (Sev1) | HTTP 5xx > 5 over 5 min |
| `asdlcmel-alert-responsetime-dev` | Metric Alert (Sev2) | P95 > 3s over 5 min |

---

## Exact Deployment Commands

### 1. Prerequisites

```powershell
# Logged into Azure
az account set --subscription 8327fd6b-5af3-4e8d-86d3-d48e5d12d8c7
az account show --query name -o tsv   # ME-MngEnvMCAP493490-melrasheed-1

# Install dependencies (lock file may be out of sync after workspace additions)
npm install   # NOT npm ci — regenerates package-lock.json if needed
```

### 2. Build All Workspaces

```powershell
npm run build --workspaces --if-present
# Output: packages/shared/dist, apps/api/dist, apps/web/dist
```

### 3. Deploy Infrastructure

```powershell
# IMPORTANT: Use westus2. eastus has zero B1 quota on this subscription.
.\infra\deploy.ps1 `
    -EnvironmentName dev `
    -NamePrefix asdlcmel `
    -Location westus2 `
    -Subscription 8327fd6b-5af3-4e8d-86d3-d48e5d12d8c7

# deploy.ps1 creates rg-agentic-sdlc-dev and runs az deployment group create
# Outputs: apiDefaultHostname, webDefaultHostname, appInsightsConnectionString
```

### 4. Build Web with Real API URL (CRITICAL — Vite inlines at build time)

```powershell
$env:VITE_API_BASE_URL = "https://asdlcmel-api-dev.azurewebsites.net"
npm run build -w apps/web
# Rebuilds dist/assets/*.js with the real API hostname baked in
```

### 5. Package and Deploy the API

The core challenge: `@contoso/shared` is a workspace symlink. A naive zip of `apps/api/` fails at
runtime with `ERR_MODULE_NOT_FOUND` for `@contoso/shared`.

**Solution chosen: manual self-contained bundle**

```powershell
# Create staging area
New-Item -ItemType Directory -Path deploy-staging\api -Force
Copy-Item -Recurse apps\api\dist deploy-staging\api\dist

# Create standalone package.json (no workspace:* references, no @contoso/shared)
# See deploy-staging/api/package.json — mirrors apps/api/package.json
# with @contoso/shared removed from dependencies.
Set-Content deploy-staging\api\package.json (Get-Content apps\api\package.json -Raw `
    | ConvertFrom-Json | ...serialize without @contoso/shared... | ConvertTo-Json)

# Install prod-only deps
Push-Location deploy-staging\api
npm install --omit=dev
Pop-Location

# Re-inject @contoso/shared AFTER npm install (npm would clobber a pre-created directory)
New-Item -ItemType Directory -Path deploy-staging\api\node_modules\@contoso\shared -Force
Copy-Item packages\shared\dist\*.js  deploy-staging\api\node_modules\@contoso\shared\
Copy-Item packages\shared\dist\*.d.ts deploy-staging\api\node_modules\@contoso\shared\ -ErrorAction SilentlyContinue
Copy-Item packages\shared\package.json deploy-staging\api\node_modules\@contoso\shared\

# Zip and deploy
Compress-Archive deploy-staging\api\* deploy-staging\api.zip -Force
az webapp deploy -g rg-agentic-sdlc-dev -n asdlcmel-api-dev `
    --src-path deploy-staging\api.zip --type zip --timeout 600
```

**Why this approach was chosen over alternatives:**

- `npm pack` + unpacking: still needs shared injected into node_modules, same steps
- Bundling with esbuild/rollup: invasive, risk of breaking ESM import semantics for this app
- Deploy from repo root with Oryx build: Oryx can't resolve workspace symlinks without custom build script
- Run `npm install --include-workspace-root`: includes the entire monorepo root's node_modules (~300MB)

### 6. Deploy the Web SPA

```powershell
New-Item -ItemType Directory -Path deploy-staging\web -Force
Copy-Item -Recurse apps\web\dist deploy-staging\web\dist

# Create package.json and install serve
Set-Content deploy-staging\web\package.json '{"name":"contoso-web","version":"1.0.0","scripts":{"start":"./node_modules/.bin/serve dist -s -l 8080"}}'
Push-Location deploy-staging\web
npm install serve@14 --save-exact
Pop-Location

# Set startup command (use local binary, not npx, to avoid network dependency at cold start)
az webapp config set -g rg-agentic-sdlc-dev -n asdlcmel-web-dev `
    --startup-file "./node_modules/.bin/serve dist -s -l 8080"

Compress-Archive deploy-staging\web\* deploy-staging\web.zip -Force
az webapp deploy -g rg-agentic-sdlc-dev -n asdlcmel-web-dev `
    --src-path deploy-staging\web.zip --type zip --timeout 600
```

### 7. Post-Deploy Config

```powershell
# Enable CORS on API (required for browser → API calls)
az webapp config appsettings set -g rg-agentic-sdlc-dev -n asdlcmel-api-dev --settings `
    CORS_ORIGIN="https://asdlcmel-web-dev.azurewebsites.net"
```

---

## Verification

All of these were verified live on 2026-08-18.

```
GET /health → 200 {"status":"ok","service":"contoso-claims-api","env":"dev","uptimeSeconds":277}
GET /api/stats → 200 {"totalClaims":12,"byStatus":{...},"totalAmountRequested":309725.4}
GET /api/claims → 200 [{"id":"CLM-000001",...}, ...]  (12 claims)
Web SPA root → 200 (494 bytes HTML, assets load from /assets/)

FAULT INJECTION:
  POST /api/admin/fault {"mode":"error","durationSeconds":60}
  → 200 {"mode":"error","activatedAt":"...","expiresAt":"..."}

  GET /api/claims (during fault)
  → 500 {"type":"...problems/injected-fault","title":"Internal Server Error",
         "detail":"Injected fault: the claims service failed to load claims."}

  POST /api/admin/fault {"mode":"none"}
  → 200 {"mode":"none"}

  GET /api/claims (after reset)
  → 200 [...12 claims...]
```

**Telemetry:**
- `APPLICATIONINSIGHTS_CONNECTION_STRING` confirmed present on `asdlcmel-api-dev`
- Connection string: `InstrumentationKey=30da5ffc-...;IngestionEndpoint=https://westus2-2.in.applicationinsights.azure.com/`
- Both alert rules confirmed `enabled: true` via `az monitor metrics alert list`

---

## Known Issues on First Deploy

### 1. B1 quota zero in eastus (CRITICAL)
The subscription has zero B1 App Service Plan quota in `eastus`. The Bicep deploy will partially
succeed (identity + Log Analytics created) then fail with `InternalSubscriptionIsOverQuotaForSku`.

**Fix:** Use `westus2` or `swedencentral`. This subscription has existing plans in `westus2`.
Delete the partial RG first: `az group delete -n rg-agentic-sdlc-dev --yes --no-wait`

### 2. Lock file out of sync
`npm ci` will fail if a new workspace was added after the lock file was committed. Use `npm install`
to regenerate, then commit the updated `package-lock.json`.

### 3. API cold start is slow (~4 minutes)
App Service Oryx re-archives `node_modules` as a `.tar.gz` on first deploy, then re-extracts it on
every cold start (~35MB, ~3.5 min on B1). The `az webapp deploy` command will appear stuck on
"Starting the site..." for 3-4 minutes.

**This is normal.** The deploy succeeds; just wait. The startup command (`node dist/server.js`)
runs after extraction completes.

### 4. Wrong startup command in Bicep default
`infra/modules/appservice.bicep` had `node dist/server.js` but the initial Bicep had
`dist/index.js`. The Bicep was correct; the app service config was set correctly by the deploy
script. If the API shows 503/timeout, verify:

```powershell
az webapp config show -g rg-agentic-sdlc-dev -n asdlcmel-api-dev --query appCommandLine -o tsv
# Should be: node dist/server.js
```

If wrong, fix with:
```powershell
az webapp config set -g rg-agentic-sdlc-dev -n asdlcmel-api-dev --startup-file "node dist/server.js"
az webapp restart -g rg-agentic-sdlc-dev -n asdlcmel-api-dev
```

### 5. @contoso/shared re-injection required on every rebuild
If `packages/shared` changes, you must rebuild shared, re-run `tsc` for the API, rebuild the
deploy bundle, and re-inject the shared files. The automation above handles this if run from the
repo root.

---

## Teardown

```powershell
.\infra\teardown.ps1 -EnvironmentName dev -NamePrefix asdlcmel
# Prompts for confirmation. Add -Force to skip.
# Deletes: rg-agentic-sdlc-dev and all resources in it.
```

> **Note for SRE Agent demos:** The SRE Agent (`enableSreAgent=true`) is billed by token consumption.
> Deploy it only for live demos and tear it down afterwards. See `infra/sre-agent-README.md`.

---

## Redeployment Checklist

For code-only changes (no infra change):

1. `npm install && npm run build --workspaces --if-present`
2. If `apps/web` changed: rebuild with `$env:VITE_API_BASE_URL=... ; npm run build -w apps/web`
3. Rebuild deploy bundle and re-inject `@contoso/shared`
4. `Compress-Archive ... -Force && az webapp deploy ...`

For infra changes:

1. Run `.\infra\deploy.ps1` (idempotent)
2. If outputs changed (e.g., new API hostname), rebuild web with new `VITE_API_BASE_URL`
