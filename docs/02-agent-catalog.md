# 02 — Agent catalog

This catalogue covers all 11 agents in the Agentic SDLC Accelerator: the nine authored agents (`.github/agents/`), the GitHub Copilot coding agent, Copilot code review, and the Azure SRE Agent.

---

## Authored agents

Authored agents are prompt files in `.github/agents/`. They run inside GitHub Copilot Chat (VS Code, GitHub.com, or CLI) and have access to the tools listed in each file's front matter.

---

### `sdlc-orchestrator`

**Purpose:** Drives a work item through the full agentic lifecycle. Decides which specialist agent to engage at each stage and refuses to let stages be skipped.

**When to use:** When you want to run the end-to-end journey for a work item, or when you need to know what stage an item is stuck at.

**Tools:** `read`, `search`, `edit`, `bash`, `azure-devops`

**Inputs:** An Azure Boards work item ID.

**Outputs:** A stage table showing current stage, gate status, what is blocking, and the single next action with its owner.

**Guardrails:**
- Will not advance a stage until its gate is verifiably met.
- Will not merge PRs, approve changes, or alter branch protection.
- If asked to skip a gate, it states the risk and stops.

**Example prompt:**
```
@sdlc-orchestrator
Drive AB#3 through the lifecycle. Start from where it currently is and tell me 
what the next action is.
```

---

### `business-analyst`

**Purpose:** Turns rough intent into implementation-ready backlog items with testable Given/When/Then acceptance criteria.

**When to use:** When a work item is vague, when an Epic needs decomposing, or when acceptance criteria are missing.

**Tools:** `read`, `search`, `azure-devops`

**Inputs:** An Azure Boards work item ID, or a description of an intent.

**Outputs:** Updated work items in Azure Boards with value statement, acceptance criteria, out-of-scope notes, and (if applicable) `NEEDS DECISION:` lines for unknowns.

**Guardrails:**
- Works in Azure Boards only — does not modify source files.
- Applies the INVEST test to every item.
- Never invents business rules — uses `NEEDS DECISION:` for unknowns.
- Tags items `ai-ready` only when all gates are met (acceptance criteria, no open decisions, parent link exists). The tag is a human triage signal — it indicates the item is ready to hand to Copilot. A human then makes the deliberate decision to invoke Copilot from Azure Boards.

**Example prompt:**
```
@business-analyst
Work item AB#3 is "Show risk score banding in claims list". 
Refine it into a ready-to-implement backlog item with acceptance criteria, 
including edge cases, and write it back to Azure Boards.
```

---

### `architect`

**Purpose:** Produces Architecture Decision Records (ADRs) and technical designs before implementation begins.

**When to use:** When a change spans more than one component, adds a dependency, changes a data model or API contract, or has performance or cost implications.

**Tools:** `read`, `search`, `edit`, `azure-devops`

**Inputs:** An Azure Boards work item ID and its acceptance criteria.

**Outputs:** An ADR at `docs/adr/NNNN-short-title.md` with at least two options considered, a decision, and a reversibility assessment. A Mermaid C4 diagram when the change affects multiple components. An ADR link added to the work item.

**Guardrails:**
- Will not produce a single-option ADR ("a rationalisation, not a decision").
- Will not skip the architect stage for trivial changes — instead it states the skip explicitly.
- Flags one-way doors loudly.
- Reads the actual code before designing.

**Example prompt:**
```
@architect
AB#3 requires displaying risk score banding (Green/Amber/Red) in the claims list view. 
Produce an ADR for how the banding thresholds should be determined and where 
the calculation logic should live.
```

---

### `threat-modeler`

**Purpose:** Performs STRIDE threat modelling on a design or change and converts findings into concrete security acceptance criteria.

**When to use:** When a change touches authentication, authorisation, personal data, money movement, or an external trust boundary.

**Tools:** `read`, `search`, `edit`, `azure-devops`

**Inputs:** An ADR (or the code as-is if no ADR exists) and a work item ID.

**Outputs:** A threat model at `docs/threat-models/AB-<id>-<slug>.md` with a data-flow diagram, STRIDE findings rated by likelihood × impact, and security acceptance criteria added to the work item.

**Guardrails:**
- Rates findings by likelihood × impact — not everything is Critical.
- Will not approve its own findings as resolved.
- If nothing meaningful is found, says so plainly.

**Example prompt:**
```
@threat-modeler
AB#3 will expose risk scores in the claims list UI. The risk score feeds into 
adjudication decisions. Produce a STRIDE threat model for this change 
and add security acceptance criteria to the work item.
```

---

### `test-engineer`

**Purpose:** Designs and writes tests from acceptance criteria; mirrors key scenarios into Azure Test Plans.

**When to use:** After implementation to close coverage gaps, or before implementation to define tests from acceptance criteria.

**Tools:** `read`, `search`, `edit`, `bash`, `azure-devops`

**Inputs:** A pull request diff, the work item's acceptance criteria, and the threat model if one exists.

**Outputs:** Tests in the repository using Vitest. Test Cases linked to the work item in Azure Test Plans. A coverage report mapping each acceptance criterion to at least one test, with a clear note on anything that could not be covered.

**Guardrails:**
- Writes tests in priority order: acceptance criteria → state machine transitions → validation boundaries → security criteria → error paths → happy path.
- Will not produce snapshot tests as a substitute for real assertions.
- Will not produce coverage-chasing tests that do not assert behaviour.
- Proves tests fail before claiming they pass.

**Example prompt:**
```
@test-engineer
PR #3 implements risk score banding. Map the acceptance criteria on AB#3 
to tests, identify coverage gaps, and write the missing tests. 
Run them and confirm they pass.
```

---

### `security-reviewer`

**Purpose:** Reviews a pull request for exploitable vulnerabilities. Triages SAST and dependency scanning findings.

**When to use:** On every PR that touches an API surface, authentication, data handling, infrastructure, or dependencies.

**Tools:** `read`, `search`, `bash`

**Inputs:** A PR diff.

**Outputs:** Findings in the format `[SEVERITY] [CONFIDENCE] File:line Issue: Exploit: Fix:`. Explicit triage of automated scanning results. An explicit clean-bill-of-health statement when the change is safe.

**Guardrails:**
- Reports only what it can justify with a concrete exploit path.
- Never reports style or naming issues.
- Will not approve PRs, merge, or modify branch protection.
- A security acceptance criterion that was not implemented is a blocking finding.

**Example prompt:**
```
@security-reviewer
Review the diff in PR #3. The change exposes risk score banding in the UI. 
Focus on whether risk score values could be manipulated by attacker-controlled 
input, and whether any sensitive claim data is leaking into the response.
```

---

### `devops-engineer`

**Purpose:** Authors and maintains Azure Pipelines YAML, Bicep infrastructure, release gates, and deployment configuration.

**When to use:** When adding a pipeline stage, changing infrastructure, configuring gates, or debugging a failed deployment.

**Tools:** `read`, `search`, `edit`, `bash`

**Inputs:** A task description, often including a work item reference and the current pipeline or Bicep state.

**Outputs:** YAML or Bicep changes with a stated blast radius, cost, rollback plan, and list of any required portal steps.

**Guardrails:**
- **Never proposes Azure Pipelines.** Delivery is GitHub Actions; Azure DevOps is planning only.
- Never disables a check, weakens a protection rule, or adds `continue-on-error` to make a workflow green.
- Will not deploy directly to a live production slot — staging slot → health check → swap.
- Validates Bicep before claiming success (`az bicep build`).
- Notes when App Service slots require Standard tier.
- Keeps the Azure Boards release gate **failing closed** and positioned **before** the production approval.

**Example prompt:**
```
@devops-engineer
Add a job to cd.yml that runs the integration test suite against the dev
environment after verify-dev. It should fail the workflow if any test fails,
and must not run on pull requests.
```

---

### `release-manager`

**Purpose:** Produces release notes, changelogs, and release readiness summaries for approvers.

**When to use:** Before cutting a release or preparing a deployment summary for approvers.

**Tools:** `read`, `search`, `edit`, `bash`, `azure-devops`

**Inputs:** The change set between the last release tag and `HEAD`.

**Outputs:** Release notes grouped by audience impact (Added / Changed / Fixed / Security / Internal). A release readiness summary with risk level, unlinked changes count, rollback plan, and open Sev1/Sev2 count.

**Guardrails:**
- Flags unlinked changes prominently — never papers over traceability gaps.
- Distinguishes AI-authored changes (Copilot, SRE Agent) from human-authored changes.
- Calls out required manual actions at the top in bold.
- Will not overstate readiness.

**Example prompt:**
```
@release-manager
Produce release notes and a readiness summary for everything between 
the last release tag and HEAD on main. Flag any changes without a linked 
Azure Boards work item.
```

---

### `sre-liaison`

**Purpose:** Works alongside the Azure SRE Agent. Verifies its automated remediations, hardens incident fixes, and converts incidents into permanent backlog items.

**When to use:** After an incident, or when reviewing a fix branch that the Azure SRE Agent opened.

**Tools:** `read`, `search`, `edit`, `bash`, `azure-devops`

**Inputs:** The SRE Agent's remediation summary and the fix branch PR.

**Outputs:** A verification report: whether the mitigation worked (based on telemetry, not the agent's own claim), a review of the fix branch, a decision to accept as permanent / accept as temporary / reject, and follow-up backlog items.

**Guardrails:**
- Will not merge the SRE Agent's fix branch — it requires human approval.
- Will not disable an alert to stop the noise.
- If the SRE Agent's root-cause analysis is wrong, says so explicitly with contradicting evidence.
- Will not claim to have detected or mitigated an incident itself — attribution is an audit requirement.

**Example prompt:**
```
@sre-liaison
The Azure SRE Agent has mitigated an incident where ADMIN_ENABLED was set 
to true in the dev environment, causing 500 errors. Review its remediation 
summary, verify recovery from telemetry, review the fix branch, and 
assess whether this needs a permanent follow-up item.
```

---

## Platform capabilities

These are not authored agent files but configured platform features.

---

### GitHub Copilot coding agent

**Purpose:** Implements work items as draft pull requests.

**Where it runs:** GitHub cloud (github.com). Triggered from Azure Boards using the native GitHub connection.

**How it is engaged:** A human opens a work item in Azure Boards and uses the **Send to Copilot** action (available once the GitHub connection is configured in Project settings). Copilot creates a `copilot/` branch and a draft pull request linked back to the work item via `AB#<id>`. You can also assign Copilot directly on any pull request in the GitHub UI.

**Inputs:** The work item title, description, and acceptance criteria from Azure Boards. No GitHub issue is created; the PR body carries the context.

**Outputs:** A draft PR on a branch named `copilot/<workitem-slug>`.

**Guardrails (platform-level, non-configurable):**
- Cannot approve its own pull request.
- The person who triggered the agent cannot be its sole approver.
- Operates within the repository's branch protection rules.

**Engaging it manually:**
```
# On any GitHub issue:
# Assignees → assign to @Copilot
# Or add a comment: @github-copilot implement this
```

---

### Copilot code review

**Purpose:** Provides automated code review on every pull request.

**Where it runs:** GitHub (PR review interface).

**How it is engaged:** Triggered automatically by requesting a Copilot review, or by re-requesting review on an open PR.

**Inputs:** The PR diff and the repository's `copilot-instructions.md`.

**Outputs:** Inline PR review comments and a summary.

**Limitations:**
- Cannot approve pull requests in this configuration.
- Does not replace the `security-reviewer` agent for exploitability analysis.

---

### Azure SRE Agent

**Purpose:** Detects incidents from Azure Monitor, investigates using logs, metrics, deployments, and source code, mitigates, commits a fix branch, and files a GitHub issue and an Azure DevOps work item.

**Where it runs:** Azure managed service (`Microsoft.App/agents`).

**Modes:**
- **Review:** Every proposed action appears in the portal for human approval. Use this for demos.
- **Automatic:** Agent executes tools autonomously. Tools marked `Ask` execute without approval. Use only in controlled environments.

**Inputs:** Azure Monitor alert → incident. Reads Application Insights, Log Analytics, deployment history, and source code via connectors.

**Outputs:** A structured remediation summary, a fix branch, a GitHub issue, and an Azure DevOps work item.

**Guardrails:**
- Governed by per-tool Parameter Policy (Allow / Ask / Deny).
- `accessLevel=Low` limits it to Reader + Log Analytics Reader by default.
- `monthlyAgentUnitLimit` caps token spend.
- Fix branches go through the same PR checks and release gates as any other change.

**Key caveat:** In Automatic mode, tools marked `Ask` execute without human approval. This is a governance decision, not a default.

See `docs/06-sre-runbook.md` for full setup and operation.
