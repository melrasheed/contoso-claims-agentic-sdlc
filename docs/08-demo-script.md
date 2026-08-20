# 08 — Demo script (20 minutes)

This is a timed runbook for a live customer or management presentation. It assumes the environment is pre-deployed and pre-staged. Read the pre-staging section before you start.

---

## Audience

Enterprise customers evaluating an AI-augmented SDLC, or a Microsoft/GitHub manager reviewing the work. Assume a sceptical, technical audience. Do not overclaim.

---

## Pre-staging (30–60 minutes before the demo)

Complete all of these before arriving or opening the screen share.

### Environment

- [ ] Dev environment deployed: `.\infra\deploy.ps1 -EnvironmentName dev -NamePrefix <prefix>`
- [ ] Azure portal open and authenticated in browser
- [ ] `https://sre.azure.com` open and authenticated in browser, agent visible
- [ ] Azure DevOps open to the `Agentic SDLC` project, Boards view
- [ ] GitHub open to `<owner>/contoso-claims-agentic-sdlc`, PRs tab
- [ ] VS Code open with the repository, Copilot Chat panel open
- [ ] MCP server running and ADO tools verified: `@sdlc-orchestrator list all work items`

### Boards state

- [ ] AB#2 and AB#3 exist, tagged `ai-ready`, state `New`
- [ ] **AB#4 exists as a `Bug` with Severity `1 - Critical`, state `Active`** — this is what makes the release gate block on cue. Verify with the `Release Gate - active Sev1 Sev2 bugs` shared query; it must return exactly one row
- [ ] No stray tags on the demo items (re-run bootstrap if needed)

### Delivery state

- [ ] `gh auth status` shows the `workflow` scope
- [ ] Repository variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` are set
- [ ] `dev` and `prod` GitHub Environments exist; `prod` has a required reviewer
- [ ] A previous successful `cd.yml` run exists to show as a baseline

### GitHub state

- [ ] No draft PRs from a previous run on `copilot/*` branches
- [ ] Copilot is enabled on the repository
- [ ] The Azure Boards → GitHub connection is configured in Project settings → GitHub connections

### SRE Agent state

- [ ] Agent deployed, GitHub and ADO connectors configured
- [ ] Alert rules are enabled (verify in Azure Monitor → Alert rules)
- [ ] `ADMIN_ENABLED` is **not** set on the App Service (check in Azure Portal → Configuration)

### Test the fault injection path

Five minutes before presenting, inject a fault in a private window to confirm it works, then clear it:
```powershell
$api = "https://<prefix>-api-dev.azurewebsites.net"
Invoke-RestMethod -Uri "$api/api/admin/fault" -Method POST -ContentType "application/json" -Body '{"mode":"error","durationSeconds":30}'
Start-Sleep 35
Invoke-RestMethod -Uri "$api/api/claims" -Method GET  # Should return 200
```

---

## Minute-by-minute script

### 0:00–2:00 — Opening: the problem (no slides needed)

**Say:** "Every AI coding tool makes developers faster. That is not what we are here to talk about. The question is: when you have AI generating code at speed, how do you know what got into production and why? How does a regulator examine that? How does your SOC respond to an incident at 3am when AI wrote the service?"

"This system is one answer. It is not theoretical — it is running. Let me show you."

**Show:** The Azure Boards backlog with AB#2 and AB#3. Two items, tagged `ai-ready`.

"Every unit of work starts here, in Azure Boards. This is your system of record. Nothing moves to code without a work item."

---

### 2:00–5:00 — The handoff: a deliberate human decision

**Say:** "The `ai-ready` tag is a triage signal — it means the item has been refined and is ready for Copilot. But nothing happens automatically. A human makes a deliberate decision. Watch."

**Do:**
**[PORTAL]** Azure Boards → AB#2 → context menu → **Send to Copilot**.

**Show:** Copilot immediately creates a branch and a draft pull request.

**Say:** "That is it. No bridge script. No GitHub issue. The work item goes directly to Copilot. The draft PR body contains `AB#2` — Azure Boards links to it automatically."

**Show:** Azure Boards → AB#2. Point out:
- The GitHub PR link has appeared as a development link on the work item

**Say:** "Every unit of work still starts in Azure Boards. This is your system of record. Nothing moves to code without a work item and a human decision."

> **Screenshot:** AB#2 showing the development link to the Copilot draft PR.

**If it breaks:** If the Send to Copilot action is not visible, verify the GitHub connection is configured in Project settings → GitHub connections. Fall back to showing a pre-run draft PR and explaining the native integration.

---

### 5:00–9:00 — Copilot implements; the PR is a conversation

**Show:** GitHub → issue #2. Point out:
- Rich context body: work item details, acceptance criteria, area path, iteration
- Assigned to Copilot coding agent

**Say:** "Copilot picks this up autonomously. It has the acceptance criteria from Azure Boards, not just a title. That context is what determines code quality."

Wait a moment, then:

**Show:** The draft PR on a `copilot/` branch. Point out:
- `AB#2` in the PR body — Azure Boards links this automatically
- Author: `github-copilot[bot]`
- PR template filled in: Risk, Rollback, Test evidence

**Say:** "Copilot received the work item title, description, and acceptance criteria directly from Boards. That context is what determines code quality."

**Say:** "Copilot cannot approve its own PR. This is enforced by the platform. The person who triggered the agent cannot be its sole approver. This is the separation of duties argument — the same argument you apply to human developers."

**Show:** Engage Copilot code review on the PR.

**Say:** "Copilot code reviews the code too. And if I want a security-focused review, I have an agent for that."

```
@security-reviewer
Review the diff in this PR for exploitable vulnerabilities.
Focus on the dual-approval workflow and whether the authorisation check is server-side.
```

> **Screenshot:** Security reviewer agent returning a clean review or a finding.

**If it breaks:** If the draft PR does not exist yet, show the preview of an existing PR from a previous run, or show the business-analyst agent refining a work item instead.

---

### 9:00–13:00 — Delivery on GitHub Actions, and a gate that actually blocks

**Say:** "Delivery runs on GitHub Actions. Azure DevOps is used for planning only. But notice what that costs us."

**Show:** `.github/workflows/cd.yml` — the job list: build, deploy-dev, verify-dev, **boards-gate**, deploy-prod, post-deploy.

**Say:** "Azure Pipelines has a built-in check called *Query Work Items*. It holds a release while a critical bug is open. GitHub Environments have required reviewers, wait timers, branch policies — but they cannot consult an external backlog. Move delivery to Actions and you lose that control."

"So we rebuilt it."

**Do — the moment the whole demo is built around:**
```powershell
gh workflow run cd.yml -f gate-only=true
gh run watch
```

**Show:** the run **fails**, and the job summary:

```
### Azure Boards release gate — BLOCKED

Blocking work items: 1 (tolerance 0)

| ID | Type | Title                                                  | State  |
| 4  | Bug  | Adjudicating an already-paid claim returns 200 not 409 | Active |
```

**Say:** "That is a real work item in Azure Boards, and the deployment just stopped because of it. Nobody wrote a rule in the pipeline saying 'don't ship' — a delivery manager put a Sev1 in the backlog, and the release respected it."

"Here is the part that matters for audit. I have write access to this repository. I could edit that workflow. But I **cannot** quietly close that work item — different system, different permission, visible act by a named person. That is separation of duties as a control, not a convention."

**Do:** close AB#4 in Azure Boards, re-run:
```powershell
gh workflow run cd.yml -f gate-only=true
```

**Show:** the gate now passes.

**Say:** "And production requires a human approval on top — bound to the GitHub environment. The credentials to deploy to production are federated to that environment, so if you skip the approval, the identity doesn't even exist. The approval is enforced by Entra ID, not by YAML anyone could edit."

**Say:** "There is no fast lane for AI-authored code. A Copilot fix branch and a human fix branch go through the same checks."

> **Screenshot:** the failed run's job summary naming work item #4, side by side with the Boards item.

**If it breaks:**
- Gate passes when it should block: the backing query is wrong. Show the query in Boards and verify it filters on `[Microsoft.VSTS.Common.Severity] <= 2` and `[System.WorkItemType] = 'Bug'`. See `docs/07-troubleshooting.md` §12.
- `azure/login` fails: OIDC subject mismatch — §11. Fall back to running `node tools/delivery/boards-gate.mjs` locally with `az login`, which produces the same output.

---

### 13:00–18:00 — The SRE Agent: the feedback loop

**Say:** "Let me show you what happens when something goes wrong in production."

**Do:** Enable `ADMIN_ENABLED` on the App Service for the fault-injection demo:
```powershell
az webapp config appsettings set `
  --resource-group <your-resource-group> `
  --name <prefix>-api-dev `
  --settings ADMIN_ENABLED=true
```
Or: Azure Portal → App Service (`<prefix>-api-dev`) → Configuration → Application settings → add `ADMIN_ENABLED` = `true` → Save.

> Turn this back off after the demo. `ADMIN_ENABLED` defaults to `false` so a fresh deployment never exposes the fault-injection endpoints unless someone deliberately enables them.
```powershell
$api = "https://<prefix>-api-dev.azurewebsites.net"
Invoke-RestMethod -Uri "$api/api/admin/fault" -Method POST -ContentType "application/json" -Body '{"mode":"error","durationSeconds":300}'
```

"The API is now returning 500 errors on all claim operations."

**Wait 3 minutes.** During this time:

"This is the Azure SRE Agent. It is a first-party Azure managed service. It is already watching our Application Insights and Log Analytics. The moment the alert fires, it starts investigating."

After the alert fires, show `https://sre.azure.com` → the agent.

**Say:** "In Review mode — which is the default — every action the agent proposes appears here for approval. I can see its reasoning at each step."

**Accept each step** while narrating:
1. "It is querying Application Insights. It can see the exception pattern."
2. "It is reading the source code. It found the fault injection endpoint."
3. "It is proposing to disable ADMIN_ENABLED. That is the right mitigation."
4. "It is opening a fix branch on GitHub and filing a work item in Azure Boards."

**Show:** GitHub → a new issue and fix branch created by the SRE Agent. Azure Boards → a new work item.

**Say:** "That fix branch goes through the same PR checks. Copilot code reviews it. A human approves it. The SRE Agent does not have a fast lane either."

**Clear the fault:**
```powershell
Invoke-RestMethod -Uri "$api/api/admin/fault" -Method POST -ContentType "application/json" -Body '{"mode":"none"}'
```

"The incident is cleared. The SRE Agent's remediation goes into the governed backlog, not into a JIRA ticket that nobody reads."

> **Screenshot:** SRE Agent portal showing the structured remediation summary.

**If it breaks:**
- Alert does not fire in 3 minutes: show the Azure Monitor alert rule configuration and explain the 5-minute evaluation window. Inject more load: call the fault endpoint repeatedly to increase the 5xx count faster.
- SRE Agent portal does not show activity: verify the GitHub and ADO connectors are configured (known issue — see `docs/07-troubleshooting.md` §9).
- Fall back to showing the SRE Agent portal with a pre-run remediation summary.

---

### 18:00–20:00 — Closing: what this means

**Say:** "What you saw was a complete loop. A work item in Azure Boards. A human made a deliberate decision to hand it to Copilot — no automation, no bridge, one click. AI implementation. AI and human code review. A delivery workflow that refused to ship because of an open Sev1 bug. A live incident investigated and mitigated by an AI agent in Review mode. A fix branch governed by the same controls as a human's code."

"Azure DevOps is where your project managers, auditors and release managers work — and it stays authoritative over whether a release may proceed. GitHub is where the code, the AI execution and the delivery happen. Azure is the runtime. The AI agents accelerate the work — they do not replace the governance."

"The question your auditor, your regulator, or your CISO will ask is: can you explain this change? Where did it come from? Who approved it? The answer is yes — because every change traces to a work item, every AI-authored contribution is labelled, and every merge went through the gates."

---

## Common questions

**"What if the AI writes bad code?"**
The security-reviewer agent, Copilot code review, GHAS scanning, and human approval are all in the path before anything reaches production. The PR template requires the approver to state they can explain the change without asking the author.

**"Is this using GPT-4 / which model?"**
The authored agents run on whatever model powers GitHub Copilot in the customer's licence (typically GPT-4o or Claude 3.5 Sonnet, depending on the plan). The Azure SRE Agent is a managed service — Microsoft manages the model and updates it. Token billing is separate from the Copilot licence.

**"What happens when Copilot is wrong in Automatic mode?"**
The default is Review mode — nothing happens without human approval. Automatic mode is available but requires an explicit configuration change and a reviewed Parameter Policy. Parameter Policy can restrict the agent to a named set of resources and deny all destructive operations.

**"Can we use this with our existing ADO project?"**
Yes. The bootstrap script detects the process template (Basic, Agile, Scrum, CMMI) and adapts. Replacing the Contoso Claims app with a customer's app is what the starter kit is for — see `starter-kit/README.md`.

**"What does this cost?"**
Copilot Business/Enterprise pricing covers the agent fleet and Copilot coding agent. The SRE Agent bills on consumed tokens — roughly £5–20 per incident investigation depending on complexity. The Azure infrastructure for this demo runs around £50–80/month. See `docs/06-sre-runbook.md` §5 for billing details.
