# Adoption checklist

Work through this list in order. Steps marked **[PORTAL]** cannot be scripted and require a browser. Steps marked **[PREREQ]** must be completed before the step that follows can proceed.

Time estimates are for someone familiar with Azure and GitHub. Allow roughly double for a first run.

---

## Phase 0 — Prerequisites (30 minutes)

- [ ] **0.1** [PREREQ] Node.js 20 LTS installed: `node --version`
- [ ] **0.2** [PREREQ] PowerShell 7.4+ installed: `$PSVersionTable.PSVersion`
- [ ] **0.3** [PREREQ] Azure CLI 2.60+ installed: `az --version`
- [ ] **0.4** [PREREQ] `az login` completed and correct subscription selected: `az account show`
- [ ] **0.5** [PREREQ] GitHub account with Copilot Business or Enterprise licence
- [ ] **0.6** [PREREQ] Azure DevOps organisation admin access or ability to create projects
- [ ] **0.7** [PREREQ] GitHub repository created (can be empty at this stage)
- [ ] **0.8** [PREREQ] Azure subscription with at least Contributor role at subscription scope

---

## Phase 1 — Configure the starter kit (15 minutes)

- [ ] **1.1** Copy `starter-kit/` contents into your target repository.

- [ ] **1.2** Run the configurator:
  ```powershell
  .\starter-kit\init.ps1
  ```
  Alternatively, non-interactive:
  ```powershell
  .\starter-kit\init.ps1 -NonInteractive `
      -AdoOrg "<your-org>" `
      -AdoProject "<your-project>" `
      -GhOwner "<gh-owner>" `
      -GhRepo "<gh-repo>" `
      -AppName "<app-name>" `
      -NamePrefix "<prefix>" `
      -AzureLocation "<region>" `
      -CodeownersTeam "@<your-team>" `
      -AlertEmail "<email>"
  ```

- [ ] **1.3** Review every file under `.github/` for remaining `<PLACEHOLDER>` markers:
  ```powershell
  Select-String -Path ".github\*\*.md", ".github\*.md" -Pattern "<[A-Z_]+>" -Recurse
  ```
  Resolve any that `init.ps1` did not cover.

- [ ] **1.4** Update `.github/copilot-instructions.md`:
  - Add the application's domain model and key entities
  - Add data sensitivity rules (PII fields, audit requirements)
  - Add architecture summary (components, responsibilities, boundaries)
  - Add any regulatory or compliance context agents should know

- [ ] **1.5** Update `.github/agents/threat-modeler.agent.md`:
  - Replace the Contoso Claims domain-specific section with your domain's equivalent

- [ ] **1.6** Update `.github/CODEOWNERS`:
  - Replace `@<your-team>` with real GitHub teams
  - Add paths for your application's most sensitive code (money paths, auth, PII)

---

## Phase 2 — Azure DevOps setup (20 minutes)

- [ ] **2.1** [PORTAL] Create the Azure DevOps project:
  - `https://dev.azure.com/<org>` → New project → select process (Basic recommended for simplicity)

- [ ] **2.2** Bootstrap the project structure:
  ```powershell
  .\tools\ado-bootstrap\bootstrap.ps1 `
      -Organization <your-org> `
      -Project "<your-project>"
  ```
  Verify: `Summary: created N  found 0` with no errors.

- [ ] **2.3** [PORTAL] Verify Boards shows the bootstrapped area paths, iterations, and sample backlog.

- [ ] **2.4** [PORTAL] Add real team members to the project with appropriate permission levels.

- [ ] **2.5** Note: if you need to change the project process from Basic to Agile/Scrum:
  - [PORTAL] Organization settings → Boards → Process → target process → Change team projects
  - This is irreversible — test in a throwaway project first.

---

## Phase 3 — GitHub setup (20 minutes)

- [ ] **3.1** Push the starter-kit `.github/` contents to your repository's `main` branch.

- [ ] **3.2** [PORTAL] Enable GitHub Copilot on the repository (Settings → Copilot).

- [ ] **3.3** [PORTAL] Configure branch protection on `main`:
  - Require pull request before merging
  - Require status checks to pass: the exact job names from `ci.yml` (for example `Lint, typecheck, test, build`), `Analyze javascript-typescript`, and `Review dependency changes`
  - Require at least 1 approval
  - Require review from CODEOWNERS
  - Do not allow bypassing the above settings

- [ ] **3.4** Configure the ADO MCP server at `~/.copilot/mcp-config.json`:
  ```json
  {
    "mcpServers": {
      "azure-devops": {
        "command": "npx",
        "args": ["-y", "@azure-devops/mcp-server"],
        "env": {
          "AZURE_DEVOPS_ORG_URL": "https://mcp.dev.azure.com/<your-org>"
        }
      }
    }
  }
  ```
  **Note:** The host is `mcp.dev.azure.com`, not `dev.azure.com`. See `docs/07-troubleshooting.md` bug #1.

- [ ] **3.5** Verify ADO tools load in Copilot Chat:
  ```
  @sdlc-orchestrator List the current backlog items.
  ```
  If no tools load, consult `docs/07-troubleshooting.md` bugs #1 and #2.

---

## Phase 4 — Azure infrastructure (30 minutes)

- [ ] **4.1** Preview the infrastructure deployment:
  ```powershell
  .\infra\deploy.ps1 -EnvironmentName dev -NamePrefix <your-prefix> -WhatIf
  ```
  Confirm the planned resources match expectations.

- [ ] **4.2** Deploy dev infrastructure:
  ```powershell
  .\infra\deploy.ps1 -EnvironmentName dev -NamePrefix <your-prefix>
  ```
  Note the API URL from the deployment outputs.

- [ ] **4.3** Verify the API is running:
  ```powershell
  Invoke-RestMethod -Uri "https://<prefix>-api-dev.azurewebsites.net/health" -Method GET
  # Expect: { "status": "ok" }
  ```

- [ ] **4.4** When ready for production:
  ```powershell
  .\infra\deploy.ps1 -EnvironmentName prod -NamePrefix <your-prefix> -EnableSlots
  ```
  Note: `-EnableSlots` promotes the plan to S1 (Standard tier). B1 does not support slots.

---

## Phase 5 — Delivery setup: GitHub Actions (25 minutes)

> No Azure Pipeline, no service connection, no variable group. Delivery runs on GitHub Actions. See `.github/WORKFLOWS.md`.

- [ ] **5.1** Copy the workflows and delivery tooling into your repository:
  - `.github/workflows/` — `ci.yml`, `codeql.yml`, `dependency-review.yml`, `cd.yml`, `ado-bridge.yml`
  - `tools/delivery/boards-gate.mjs`, `tools/delivery/boards-comment.mjs`
  - `tools/configure-github-oidc.ps1`, `tools/configure-github-environments.ps1`

- [ ] **5.2** Edit the `env:` block at the top of `cd.yml` — resource group, app names, ADO organisation and project, and the release gate query path.

- [ ] **5.3** Federate GitHub to Azure (creates no secrets):
  ```powershell
  .\tools\configure-github-oidc.ps1 `
      -Repository <owner>/<repo> `
      -SubscriptionId <subscription-id> `
      -ResourceGroup <resource-group>
  ```
  Sets `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` as repository variables.

- [ ] **5.4** Create the environments and protection rules:
  ```powershell
  .\tools\configure-github-environments.ps1 `
      -Repository <owner>/<repo> `
      -Reviewers <username1>,<username2>
  ```

- [ ] **5.5** [PORTAL] **Verify** the protection rules are actually enforced: Settings → Environments → `prod`. On a private repository they require GitHub Pro, Team or Enterprise, and are silently ignored otherwise. The API returns success either way — do not trust it.

- [ ] **5.6** Confirm the release gate query returns rows. `bootstrap.ps1` creates `Release Gate - active Sev1 Sev2 bugs`; open it in Azure Boards and check it matches a real blocking item.

  > A query that matches nothing is a gate that always passes — indistinguishable from a healthy system.

- [ ] **5.7** **Prove the gate blocks**, with a blocking work item open:
  ```powershell
  gh workflow run cd.yml -f gate-only=true
  ```
  This must **fail**. A gate you have never seen block has never been tested.

- [ ] **5.8** Close the blocking work item, re-run, and confirm the gate passes.

- [ ] **5.9** Run a full deployment and confirm the Azure Boards write-back comment appears on the work item:
  ```powershell
  gh workflow run cd.yml
  ```

- [ ] **5.10** Set the required status check contexts in the branch ruleset to match the **exact** job names reported by `ci.yml`. A mismatch means the check is required but never runs.

---

## Phase 6 — Bridge configuration (15 minutes)

- [ ] **6.1** Build the bridge:
  ```powershell
  cd tools/ado-github-bridge
  npm ci
  npm run build
  cd ../..
  ```

- [ ] **6.2** Set environment variables:
  ```powershell
  $env:ADO_ORG      = "<your-org>"
  $env:ADO_PROJECT  = "<your-project>"
  $env:GH_OWNER     = "<gh-owner>"
  $env:GH_REPO      = "<gh-repo>"
  $env:GITHUB_TOKEN = "<your-github-pat>"
  ```
  Token must have `repo` and `issues` scopes. Add `workflow` if the bridge must push to `.github/workflows/`.

- [ ] **6.3** Verify connectivity:
  ```powershell
  node tools/ado-github-bridge/dist/cli.js doctor
  ```
  Both `Azure DevOps connectivity... OK` and `GitHub connectivity... OK` must appear.

- [ ] **6.4** Run a dry-run sync:
  ```powershell
  node tools/ado-github-bridge/dist/cli.js sync --dry-run
  ```

- [ ] **6.5** Run the first real sync:
  ```powershell
  node tools/ado-github-bridge/dist/cli.js sync
  ```

- [ ] **6.6** Verify write-back in Azure Boards: confirm state `Doing`, tags `synced-to-github` and `ai-implementing`, and a hyperlink relation to the GitHub issue.

---

## Phase 7 — SRE Agent (optional, 45 minutes) [PREVIEW]

- [ ] **7.1** Get your deployer object ID:
  ```powershell
  $oid = az ad signed-in-user show --query id -o tsv
  ```

- [ ] **7.2** Add SRE Agent parameters to `infra/main.parameters.json`:
  ```json
  "enableSreAgent":           { "value": true },
  "sreAgentMode":             { "value": "Review" },
  "sreAgentDeployerObjectId": { "value": "<your-oid>" }
  ```

- [ ] **7.3** Deploy with SRE Agent enabled:
  ```powershell
  .\infra\deploy.ps1 -EnvironmentName dev -NamePrefix <your-prefix>
  ```

- [ ] **7.4** [PORTAL] Navigate to `https://sre.azure.com` → your agent.

- [ ] **7.5** [PORTAL] Add the GitHub connector (Connectors → Add → GitHub).

- [ ] **7.6** [PORTAL] Add the Azure DevOps connector (Connectors → Add → Azure DevOps).

- [ ] **7.7** [PORTAL] Configure per-tool Parameter Policy (Tools → set Allow/Ask/Deny for each tool).

- [ ] **7.8** Wire Azure Monitor alerts to the SRE Agent webhook (optional — see `docs/06-sre-runbook.md` §7.4).

---

## Phase 8 — Verify end to end (15 minutes)

- [ ] **8.1** Create a work item in Azure Boards, tag it `ai-ready`, and run a bridge sync. Confirm a GitHub issue is created and Copilot is assigned.

- [ ] **8.2** Confirm Copilot opens a draft PR referencing the work item. Review it.

- [ ] **8.3** Merge the PR and confirm `cd.yml` runs: build, deploy to dev, verify, and the Azure Boards release gate.

- [ ] **8.4** If the SRE Agent is deployed: run the fault-injection demo per `docs/06-sre-runbook.md` §8.

---

## After adoption

- Update `docs/` for your application's domain-specific runbooks, ADRs, and threat models.
- Replace the Contoso Claims reference app entirely once your application is in place.
- Review `docs/05-security-model.md` and document how the system satisfies your organisation's security and compliance requirements.
- Schedule a quarterly review of the agent files — they define AI behaviour across the whole lifecycle and should be treated as governance artefacts.
