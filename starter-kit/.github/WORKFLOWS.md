# Starter kit — GitHub Actions delivery

> Copy these into `.github/workflows/` and `tools/` in your repository.

This kit deliberately separates **planning** from **delivery**:

- **Azure DevOps** is used for project management only — Boards, work items, queries.
- **GitHub Actions** runs all CI/CD.
- Azure Boards keeps one delivery responsibility: it is the authority consulted before a production release.

There is no `azure-pipelines.yml`, no service connection and no variable group. If you need the reasoning to defend this in an architecture review, see `docs/09-why-this-split.md` in the reference implementation.

---

## What to copy

| From the reference implementation | To your repository | Purpose |
|---|---|---|
| `.github/workflows/ci.yml` | same path | PR validation: lint, typecheck, test, build |
| `.github/workflows/codeql.yml` | same path | SAST |
| `.github/workflows/dependency-review.yml` | same path | Dependency scanning on PRs |
| `.github/workflows/cd.yml` | same path | Delivery: build, deploy, gate, approve, swap, release |
| `.github/workflows/ado-bridge.yml` | same path | Syncs `ai-ready` work items into GitHub issues |
| `tools/delivery/boards-gate.mjs` | same path | **The Azure Boards release gate** |
| `tools/delivery/boards-comment.mjs` | same path | Deployment write-back to Azure Boards |
| `tools/configure-github-oidc.ps1` | same path | Federates GitHub to Azure — no secrets |
| `tools/configure-github-environments.ps1` | same path | Creates environments and protection rules |

`boards-gate.mjs` and `boards-comment.mjs` are dependency-free ESM. They need Node 20 and nothing else, and they run unchanged on any CI system — not only GitHub Actions.

---

## Required changes in `cd.yml`

The workflow has an `env:` block at the top. Everything customer-specific lives there.

```yaml
env:
  NODE_VERSION: '20'
  AZURE_RESOURCE_GROUP: <your-resource-group>
  NAME_PREFIX: <your-prefix>
  API_APP_NAME: <your-api-app-name>
  WEB_APP_NAME: <your-web-app-name>
  ADO_ORGANIZATION: <your-ado-org>
  ADO_PROJECT: <your-ado-project>
  RELEASE_GATE_QUERY: Shared Queries/Release Gate - active Sev1 Sev2 bugs
```

Then adapt:

1. **Build commands.** The `build` job runs `npm ci`, lint, typecheck, test and build across npm workspaces. Replace with your toolchain.
2. **Packaging.** The reference implementation packages a Node API and a static SPA. If your application is a container, replace the zip steps with a container build and `az webapp config container set`.
3. **Smoke tests.** `verify-dev` calls `/health`, `/api/claims` and `/api/stats`. Point these at endpoints your application actually exposes. **Do not skip this** — a deployment that succeeds while the app is broken is worse than a failed deployment.
4. **Production variables.** `deploy-prod` reads `vars.PROD_RESOURCE_GROUP`, `vars.PROD_API_APP_NAME`, `vars.PROD_WEB_APP_NAME`. Set these as repository variables.

---

## Setup, in order

### 1. Federate GitHub to Azure

```powershell
./tools/configure-github-oidc.ps1 `
    -Repository <owner>/<repo> `
    -SubscriptionId <subscription-id> `
    -ResourceGroup <resource-group>
```

Creates an Entra ID application, federates it to the `dev` and `prod` environments, grants Contributor on one resource group, and sets `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_SUBSCRIPTION_ID` as repository variables. None of these is a secret.

### 2. Create environments and protection rules

```powershell
./tools/configure-github-environments.ps1 `
    -Repository <owner>/<repo> `
    -Reviewers <username1>,<username2>
```

> Deployment protection rules on **private** repositories require GitHub Pro, Team or Enterprise. On a free private repository the rules are accepted by the API and silently not enforced. Verify on the environment settings page.

### 3. Create the release gate query in Azure Boards

`tools/ado-bootstrap/bootstrap.ps1` creates `Release Gate - active Sev1 Sev2 bugs` for you, adapted to your process template.

If you write your own, **test that it returns rows**. A query that matches nothing is a gate that always passes — the most dangerous possible failure, because it looks identical to a healthy system. On the Basic process there is no `Bug` type and no severity field, so filter on a tag instead.

### 4. Prove the gate blocks

```powershell
gh workflow run cd.yml -f gate-only=true
```

With a blocking work item open, this must fail. **A gate you have never seen block has never been tested.**

---

## Mapping from Azure Pipelines

| Azure Pipelines | GitHub equivalent |
|---|---|
| Stage | Job with `needs:` |
| Environment + Approvals check | GitHub Environment + required reviewers |
| Business Hours check | Environment wait timer |
| Exclusive Lock check | `concurrency:` group |
| **Query Work Items check** | **`tools/delivery/boards-gate.mjs`** |
| Service connection | OIDC federated credential |
| Variable group | Repository / environment variables |

---

## Two things people get wrong

**Environment-scoped credentials.** Federated credentials match an exact subject such as `repo:owner/repo:environment:prod`. A job that omits `environment:` presents a branch subject instead and fails with `AADSTS70021`. This is a feature: it means the production approval is enforced by the identity system, not merely by workflow YAML.

**The gate fails closed.** If Azure DevOps is unreachable, the release is blocked. A control that cannot evaluate its condition must not permit the action it guards. Override with `GATE_FAIL_ON_ERROR=false` only with a recorded, accepted risk.
