# Documentation index

| Document | Purpose | Audience |
|---|---|---|
| [00-quickstart.md](00-quickstart.md) | Prerequisites and fast-path setup — under 30 minutes | Everyone |
| [01-tutorial.md](01-tutorial.md) | Complete numbered walkthrough from empty org to live incident | Solution architect running the demo |
| [02-agent-catalog.md](02-agent-catalog.md) | All 11 agents: purpose, inputs, guardrails, example prompts | Anyone engaging an agent |
| [03-branch-and-pr-policy.md](03-branch-and-pr-policy.md) | Branch naming, PR requirements, CODEOWNERS, approval rules | Developer or reviewer |
| [04-release-gates.md](04-release-gates.md) | GitHub Actions delivery, the Azure Boards release gate, environments, canary swap and rollback | DevOps engineer or release manager |
| [05-security-model.md](05-security-model.md) | Threat model of the system itself; OIDC, separation of duties, AI governance | Security architect or compliance reviewer |
| [06-sre-runbook.md](06-sre-runbook.md) | Azure SRE Agent setup, permission model, fault-injection demo | Operations engineer |
| [07-troubleshooting.md](07-troubleshooting.md) | Verified defects with symptoms, causes, and fixes | Anyone setting this up |
| [08-demo-script.md](08-demo-script.md) | Timed 20-minute live demo runbook with fallback guidance | Solution architect presenting to a customer |
| [09-why-this-split.md](09-why-this-split.md) | Why Azure DevOps plans and GitHub delivers — including what the split costs | Architect challenging the design |
| [business-case.md](business-case.md) | Value hypothesis, ROI model, adoption roadmap, risk register | Engineering leadership |

> **Architecture in one line.** Azure DevOps is used for **planning only**. All CI/CD runs on **GitHub Actions**. Azure Boards keeps one delivery responsibility: it is the authority consulted before a production release, enforced by the gate in `cd.yml`.

## Subdirectories

- `adr/` — Architecture Decision Records produced by the `architect` agent.
- `threat-models/` — STRIDE threat models produced by the `threat-modeler` agent.

## Writing conventions

- British English. Short sentences.
- Commands are real and tested on Windows PowerShell unless labelled otherwise.
- Portal-only steps are marked **[PORTAL]**.
- Preview features are marked **[PREVIEW]**.
