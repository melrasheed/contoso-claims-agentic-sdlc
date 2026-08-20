# Agentic SDLC Accelerator — Starter Kit

This is the app-agnostic reusable subset of the Agentic SDLC Accelerator. Use it to adapt the accelerator for a customer's own application and Azure DevOps organisation.

> **This is a starting point, not a drop-in solution.** Every `<PLACEHOLDER>` in these files must be replaced before use. See `ADOPTION-CHECKLIST.md` for the ordered list of required changes.

---

## What is in this kit

```
starter-kit/
├── README.md                        This file
├── init.ps1                         Interactive configurator (replace placeholders)
├── ADOPTION-CHECKLIST.md            Ordered adoption checklist with time estimates
├── .github/
│   ├── agents/                      Agent fleet definitions (app-agnostic templates)
│   │   ├── sdlc-orchestrator.agent.md
│   │   ├── business-analyst.agent.md
│   │   ├── architect.agent.md
│   │   ├── threat-modeler.agent.md
│   │   ├── test-engineer.agent.md
│   │   ├── security-reviewer.agent.md
│   │   ├── devops-engineer.agent.md
│   │   ├── release-manager.agent.md
│   │   └── sre-liaison.agent.md
│   ├── copilot-instructions.md      Repository grounding context (template)
│   ├── WORKFLOWS.md                 GitHub Actions delivery setup — read this
│   ├── PULL_REQUEST_TEMPLATE.md     PR template (ready to use)
│   └── CODEOWNERS                   CODEOWNERS template
├── infra/
│   ├── main.bicep                   Infrastructure (template)
│   ├── modules/                     Bicep modules
│   ├── main.parameters.json         Dev parameters (template)
│   ├── main.parameters.prod.json    Prod parameters (template)
│   ├── deploy.ps1                   Deploy script
│   └── teardown.ps1                 Teardown script
└── tools/
    └── ado-bootstrap/               ADO bootstrap script and process map
```

> **Delivery runs on GitHub Actions.** Azure DevOps is used for planning only. There is no `azure-pipelines.yml`, no service connection and no variable group in this kit. See [`.github/WORKFLOWS.md`](.github/WORKFLOWS.md).

---

## What a customer must change

The files in this kit contain `<PLACEHOLDER>` markers where customer-specific values are required. The `init.ps1` script prompts for these values and writes them through.

| Placeholder | Meaning | Files affected |
|---|---|---|
| `<ADO_ORG>` | Azure DevOps organisation name | `copilot-instructions.md`, pipeline YAML |
| `<ADO_PROJECT>` | Azure DevOps project name | `copilot-instructions.md`, `cd.yml` |
| `<GH_OWNER>` | GitHub organisation or user | `copilot-instructions.md`, `cd.yml`, CODEOWNERS |
| `<GH_REPO>` | GitHub repository name | `copilot-instructions.md`, `cd.yml`, CODEOWNERS |
| `<APP_NAME>` | Customer application name | `copilot-instructions.md`, agent files |
| `<APP_DESCRIPTION>` | One-sentence description of the application | `copilot-instructions.md` |
| `<DOMAIN_CONTEXT>` | Domain-specific guidance for agents (e.g., claim data, PII rules) | `copilot-instructions.md`, `threat-modeler.agent.md` |
| `<NAME_PREFIX>` | Short Azure resource prefix | `main.parameters.json`, `cd.yml` |
| `<AZURE_LOCATION>` | Azure region | `main.parameters.json` |
| `<SUBSCRIPTION_ID>` | Azure subscription ID | GitHub repository variable `AZURE_SUBSCRIPTION_ID` |
| `<TENANT_ID>` | Azure tenant ID | GitHub repository variable `AZURE_TENANT_ID` |
| `<CODEOWNERS_TEAM>` | GitHub team or user for CODEOWNERS | `CODEOWNERS` |
| `<ALERT_EMAIL>` | Ops team email for Azure Monitor alerts | `main.parameters.json` |

---

## How to use init.ps1

The interactive configurator:

```powershell
.\starter-kit\init.ps1
```

Non-interactive (for scripted adoption):

```powershell
.\starter-kit\init.ps1 `
    -NonInteractive `
    -AdoOrg "contoso" `
    -AdoProject "My Project" `
    -GhOwner "contoso" `
    -GhRepo "my-app" `
    -AppName "Contoso Inventory" `
    -NamePrefix "inv" `
    -AzureLocation "westeurope" `
    -CodeownersTeam "@contoso/platform-team" `
    -AlertEmail "ops@contoso.com"
```

Preview without writing files:

```powershell
.\starter-kit\init.ps1 -WhatIf
```

---

## What the agent fleet files do NOT contain

The agent files are intentionally app-agnostic. Before going live, add to `copilot-instructions.md`:

- The application's domain model (entities, relationships, key invariants)
- Data sensitivity rules (what fields are PII, what must not be logged)
- Architecture summary (what components exist, which are authoritative for what)
- Engineering conventions specific to the customer's stack
- Any regulatory or compliance context agents should be aware of

Domain-specific knowledge dramatically improves agent output quality. Generic agent files produce generic output.

---

## What is not in this kit

- The Contoso Claims application source code (`apps/`, `packages/`) — replace with the customer's application.
- Pre-existing Azure DevOps work items — the bootstrap script creates the structure; the customer populates the backlog.
- Secrets, tokens, or credentials of any kind.
- A business case or ROI model.
