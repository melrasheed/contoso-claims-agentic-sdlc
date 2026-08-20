# Agentic SDLC Accelerator

> **Demonstration accelerator.** This is a working reference implementation, not a production-ready product. It is designed to be shown to enterprise customers and adapted for their context. See `docs/00-quickstart.md` to get running.

This repository shows how **Azure DevOps**, **GitHub**, and **Azure** combine into one governed, traceable software development lifecycle where AI agents participate at every stage — from backlog refinement to incident remediation — while humans hold the decisions that matter.

**Azure DevOps is used for planning only. All CI/CD runs on GitHub Actions.** Azure Boards keeps exactly one delivery responsibility: it is the authority consulted before a production release. See [`docs/09-why-this-split.md`](docs/09-why-this-split.md) for the reasoning and the costs.

---

## Architecture

```mermaid
flowchart TB
    subgraph ADO ["Azure DevOps - planning only"]
        Boards["Boards: Epics, User Stories, Bugs, Tasks"]
        TestPlans["Test Plans"]
        Queries["Shared Queries: release gate"]
    end

    subgraph GH ["GitHub - code, AI and delivery"]
        PRs["Pull Requests: Copilot code review"]
        GHAS["GHAS: CodeQL, Dependabot, secret scan"]
        CI["Actions ci.yml"]
        CD["Actions cd.yml: build, deploy, gate, approve, swap"]
    end

    subgraph AZ ["Azure - runtime and operations"]
        AppSvc["App Service: API + Web SPA"]
        AppInsights["Application Insights"]
        Alerts["Azure Monitor Alerts"]
        SRE["Azure SRE Agent"]
    end

    subgraph Agents ["Agent fleet (.github/agents/)"]
        Orch["sdlc-orchestrator"]
        BA["business-analyst"]
        Arch["architect"]
        TM["threat-modeler"]
        TE["test-engineer"]
        SR["security-reviewer"]
        DE["devops-engineer"]
        RM["release-manager"]
        SL["sre-liaison"]
    end

    Boards -- "human sends to Copilot" --> PRs
    PRs -- "AB# token links back" --> Boards
    PRs --> CI
    CI -- "merge to main" --> CD
    Queries -- "release gate: blocks on open Sev1" --> CD
    CD -- "OIDC, no stored secret" --> AppSvc
    CD -- "deployment write-back" --> Boards
    AppInsights --> Alerts
    Alerts --> SRE
    SRE -- "fix branch + GitHub issue" --> GH
    SRE -- "work item filed" --> Boards

    Orch -.->|orchestrates| BA
    BA -.->|refines| Boards
    Arch -.->|ADR| Boards
    TM -.->|threat model| Boards
    TE -.->|tests| PRs
    SR -.->|security review| PRs
    DE -.->|workflows + infra| CD
    RM -.->|release notes| Boards
    SL -.->|incident review| SRE
```

### The one control that had to be built

Azure Pipelines has a built-in **Query Work Items** check that holds a release while a Sev1 defect is open. GitHub Environments offer required reviewers, wait timers and branch policies — but cannot consult an external backlog.

`tools/delivery/boards-gate.mjs` restores it: a dependency-free script that queries an Azure Boards shared query and fails the deployment job when blocking work items exist. It **fails closed**, and it runs *before* the production approval so a human is only ever asked to approve a release already known to be clear.

That is what keeps Azure Boards authoritative over releases without Azure DevOps running the release.

---

## Agent fleet

| Agent | Where it runs | Role |
|---|---|---|
| `sdlc-orchestrator` | Copilot Chat | Drives work items through the lifecycle; enforces stage gates |
| `business-analyst` | Copilot Chat | Refines Epics into acceptance-criteria-backed work items |
| `architect` | Copilot Chat | Produces Architecture Decision Records |
| `threat-modeler` | Copilot Chat | STRIDE threat modelling; adds security acceptance criteria |
| `test-engineer` | Copilot Chat | Writes tests; mirrors results into Azure Test Plans |
| `security-reviewer` | Copilot Chat | Reviews PRs for exploitable vulnerabilities |
| `devops-engineer` | Copilot Chat | Authors pipelines, Bicep, and release gate configuration |
| `release-manager` | Copilot Chat | Produces release notes and readiness summaries |
| `sre-liaison` | Copilot Chat | Reviews SRE Agent remediation; closes incidents as backlog |
| GitHub Copilot coding agent | GitHub (cloud) | Implements work items as draft PRs; triggered from Azure Boards |
| Copilot code review | GitHub (PR) | Automated PR review on every pull request |
| **Azure SRE Agent** | Azure (managed service) | Detects, investigates, mitigates, and files incidents |

The first nine are *authored agents* — prompt files in `.github/agents/`. The last three are *platform capabilities* configured rather than authored.

---

## What is real vs what needs configuring

| Component | Status |
|---|---|
| Reference app (Contoso Claims API + Web) | Working — 182 tests passing |
| Agent fleet definitions | Written — use in any GitHub Copilot-enabled org |
| ADO bootstrap script | Working — tested against `melrasheed/Agentic SDLC` |
| Azure Boards → GitHub connection | Configured — connection id `932425cc-...`, linked to `melrasheed/contoso-claims-agentic-sdlc` |
| Bicep infrastructure | Deployed — dev environment live on Azure App Service |
| GitHub Actions CI | Working — required check on `main` (`build-and-test`) |
| GitHub Actions CD (`cd.yml`) | Authored — needs OIDC federation and environments (two scripts) |
| Azure Boards release gate | Built and unit tested — blocks on open Sev1/Sev2 bugs |
| Azure SRE Agent | Deployed in Review mode — GitHub/ADO connectors require portal setup |
| MCP server config | Template only — paths and tokens are per-user |

---

## Quickstart

See **[docs/00-quickstart.md](docs/00-quickstart.md)** — get running in under 30 minutes.

Full tutorial: **[docs/01-tutorial.md](docs/01-tutorial.md)**

---

## Documentation index

| Document | Purpose |
|---|---|
| [docs/README.md](docs/README.md) | Docs index |
| [docs/00-quickstart.md](docs/00-quickstart.md) | Prerequisites and fast-path setup |
| [docs/01-tutorial.md](docs/01-tutorial.md) | Complete numbered walkthrough |
| [docs/02-agent-catalog.md](docs/02-agent-catalog.md) | All 11 agents: purpose, inputs, guardrails |
| [docs/03-branch-and-pr-policy.md](docs/03-branch-and-pr-policy.md) | Branch strategy and PR rules |
| [docs/04-release-gates.md](docs/04-release-gates.md) | GitHub Actions delivery, the Boards gate, rollback |
| [docs/05-security-model.md](docs/05-security-model.md) | Threat model, OIDC, separation of duties |
| [docs/06-sre-runbook.md](docs/06-sre-runbook.md) | Azure SRE Agent setup and fault-injection demo |
| [docs/07-troubleshooting.md](docs/07-troubleshooting.md) | Sixteen verified defects with symptoms and fixes |
| [docs/08-demo-script.md](docs/08-demo-script.md) | Timed 20-minute live demo runbook |
| [docs/09-why-this-split.md](docs/09-why-this-split.md) | Why Azure DevOps plans and GitHub delivers |
| [docs/business-case.md](docs/business-case.md) | ROI model and adoption roadmap |

## Starter kit

**[starter-kit/](starter-kit/)** — the app-agnostic subset you adapt for a customer's own application. See `starter-kit/README.md`.

---

> **This is a demonstration accelerator.** Commands are real and verified against the `melrasheed/Agentic SDLC` Azure DevOps project and the `melrasheed/contoso-claims-agentic-sdlc` GitHub repository. Some steps require Azure portal actions that cannot be automated. Preview features are clearly labelled.
