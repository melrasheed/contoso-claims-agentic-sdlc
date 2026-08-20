# Contoso Claims — Copilot Instructions

> Grounding context for every AI agent working in this repository. Read this before generating code, tests, reviews, pipelines or work items.

## What this repository is

This is the **Agentic SDLC Accelerator** — a working reference implementation of an AI-augmented software development lifecycle. It is two things at once:

1. A real application (**Contoso Claims** — an insurance claims API and web console).
2. A demonstration of how **Azure Boards**, **GitHub Copilot agents**, **Azure Pipelines** and the **Azure SRE Agent** combine into one governed, traceable lifecycle.

Treat the second purpose as a first-class requirement. Changes must not only work — they must remain **explainable and demonstrable** to a customer audience.

## Division of responsibility

| System | Role | Never do this |
|---|---|---|
| **Azure DevOps** (`Agentic SDLC` project) | **Project management only** — Boards: epics, work items, acceptance criteria, tags, queries, audit trail | Don't put source code here. **Don't build pipelines here** — delivery is GitHub Actions |
| **GitHub** (`melrasheed/contoso-claims-agentic-sdlc`) | Everything else — code, AI execution, PR review, **CI/CD**, environments, approvals, security scanning, releases | Don't invent independent backlog items here |
| **Azure** | Runtime and operations, including the Azure SRE Agent | Don't create resources outside the demo resource groups |

**Every unit of work originates as an Azure Boards work item.** If you are asked to implement something with no work item, say so and offer to create one — do not silently start coding.

## Delivery runs on GitHub Actions

This repository deliberately separates **planning** (Azure DevOps) from **delivery** (GitHub). There is no `azure-pipelines.yml` and there must never be one.

- CI and CD live in `.github/workflows/`. `ci.yml` validates pull requests; `cd.yml` deploys.
- Azure authentication uses **OIDC federation** (`azure/login` with `vars.AZURE_CLIENT_ID`). There is no service connection, no client secret and no publish profile anywhere in this repository.
- Deployment approvals are **GitHub Environment** protection rules, not Azure DevOps checks.

Azure DevOps retains exactly one delivery responsibility: it is the authority consulted before a production release. Azure Pipelines has a built-in "Query Work Items" check for this; GitHub has no equivalent, so it is implemented as `tools/delivery/boards-gate.mjs`, which runs as a job in `cd.yml` and **fails closed**. Do not weaken it. See `docs/09-why-this-split.md` and `docs/04-release-gates.md`.

## Tooling rules

- This project uses Azure DevOps. **Always check whether the Azure DevOps MCP server has a tool relevant to the request** before falling back to REST or CLI.
- Prefer MCP tools → `az` CLI → raw REST, in that order.
- **Never assume the process template.** Azure DevOps has four system processes (Basic, Agile, Scrum, CMMI) and they do not share work item type names, field reference names, or states. This project currently runs the **Basic** process: the available types are `Epic`, `Issue`, `Task` and the test types — there is **no `Feature`, no `User Story`, no `Product Backlog Item`, and no `Bug` type**, and no acceptance criteria, repro steps or severity fields.
- Determine the process from `capabilities.processTemplate.templateName` (fetch the project with `includeCapabilities=true`). **Do not trust the `System.Process Template` project property** — in this very project it reports "Scrum" while the real process is "Basic". `tools/ado-bootstrap/ProcessMap.psm1` encodes the correct mapping for all four processes; reuse it rather than hardcoding type names.
- Basic states are `To Do` → `Doing` → `Done`. Do not invent states such as `Active`, `Committed` or `Resolved`.
- When parsing Azure DevOps JSON in PowerShell, use `ConvertFrom-Json -AsHashtable`. Some responses contain an empty-string property name, which plain `ConvertFrom-Json` rejects.

## Repository layout

```
apps/api          Express + TypeScript claims API
apps/web          React + Vite claims console
packages/shared   Shared domain types, zod schemas, risk scoring
infra/            Bicep — App Service, App Insights, alerts, SRE Agent
.github/workflows CI and CD — GitHub Actions owns all delivery
tools/delivery/boards-gate.mjs      Azure Boards release gate (replaces the ADO check)
tools/delivery/boards-comment.mjs   Writes deployment results back to Azure Boards
tools/preflight   Integration readiness "doctor"
tools/ado-bootstrap        Scaffolds the Azure DevOps project
tools/ado-github-bridge    Syncs Boards work items to GitHub issues
.github/agents/   The agent fleet definitions
docs/             Tutorial, agent catalog, security model, SRE runbook, business case
starter-kit/      App-agnostic reusable subset for customers
```

## Engineering conventions

- **TypeScript strict everywhere.** No `any` without a written justification comment. No `@ts-ignore` without an issue link.
- **Node 20 LTS.** ES2022, NodeNext module resolution.
- Validation at every boundary using **zod** schemas from `@contoso/shared`. Never trust request bodies.
- Domain logic lives in `packages/shared` or the API service layer — **not** in route handlers.
- Errors returned from the API follow RFC 7807 problem details.
- Structured logging only (`pino`). Never `console.log` in `apps/api`.
- Tests use **Vitest**. Every behaviour change ships with a test in the same pull request — never "tests to follow".
- Formatting is Prettier; linting is ESLint. Do not hand-format.

## Security rules — non-negotiable

- **No secrets in source, ever.** No connection strings, PATs, keys or passwords, including in tests, comments, sample `.env` files or documentation examples. Use placeholders like `<your-connection-string>`.
- Authenticate to Azure with **managed identity** at runtime; authenticate GitHub Actions to Azure with **OIDC workload identity federation**. Never a PAT, client secret or publish profile.
- Claim data is treated as **sensitive personal data**. Never log `claimantName`, `policyNumber`, or full claim bodies. Log claim IDs only.
- Any new dependency must be justified in the pull request description. Prefer the standard library.
- Never weaken or bypass a branch protection rule, a required check, an environment protection rule, or the Azure Boards release gate to make something pass.

## The fault injection endpoints are deliberate

`apps/api` exposes `/api/admin/fault`, which can intentionally make the service fail. **This is intentional demo scaffolding** used to trigger a real incident so the Azure SRE Agent can detect, triage and remediate it live.

- Do not "fix" or remove it.
- Do not extend it to do anything beyond latency, error and memory simulation.
- It must stay guarded by the `ADMIN_ENABLED` environment variable and must log loudly while active.

## Traceability requirements

- Branches: `feature/<workitem-id>-slug`, `fix/<workitem-id>-slug`, `hotfix/<workitem-id>-slug`. Copilot's own branches use the `copilot/` prefix.
- Every commit and pull request body must contain the Boards link token `AB#<id>` so Azure Boards links it automatically.
- Pull request descriptions must fill in **Risk**, **Rollback** and **Test evidence**. "N/A" is acceptable only with a reason.
- AI-authored changes must state which agent produced them. This is an audit requirement, not a courtesy.

## Guardrails on AI-generated work

- Copilot **cannot approve its own pull request**, and the person who triggered an agent cannot be its sole approver.
- A human must be able to explain any merged change. "The agent wrote it" is not a review defence.
- Agents must not merge, force-push, rewrite history, or alter branch protection.
- If an agent has significant doubt about the request itself, it should stop and say so rather than produce plausible-looking output.

## Definition of done

A change is done when: it has a linked Boards work item; tests cover the new behaviour and pass; lint and typecheck are clean; security scanning is clean; the pull request documents risk and rollback; and a human has approved it.
