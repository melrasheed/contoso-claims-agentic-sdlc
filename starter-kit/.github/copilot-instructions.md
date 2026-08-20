# <APP_NAME> — Copilot Instructions

> Grounding context for every AI agent working in this repository.

## What this repository is

This is the **Agentic SDLC Accelerator** adapted for **<APP_NAME>** — <APP_DESCRIPTION>.

It is two things at once:
1. A real application (**<APP_NAME>**).
2. A demonstration of how **Azure Boards**, **GitHub Copilot agents**, **GitHub Actions**, and the **Azure SRE Agent** combine into one governed, traceable lifecycle.

## Division of responsibility

| System | Role | Never do this |
|---|---|---|
| **Azure DevOps** (`<ADO_PROJECT>` project) | System of record: planning, backlog, test plans, release governance, audit. **Azure Boards is the only backlog.** Work reaches Copilot natively from Boards via the built-in Copilot action. | Do not put source code here. **Do not create GitHub issues** — there is no bridge and GitHub issues are not used. |
| **GitHub** (`<GH_OWNER>/<GH_REPO>`) | System of work: code, AI execution (Copilot acts directly on Boards work items), PR review, security scanning | Do not invent independent backlog items here. **Do not reintroduce a bridge** between Boards and GitHub issues. |
| **Azure** | Runtime and operations, including the Azure SRE Agent | Do not create resources outside the demo resource groups |

**Every unit of work originates as an Azure Boards work item.** If you are asked to implement something with no work item, say so and offer to create one.

## Tooling rules

- Always check whether the Azure DevOps MCP server has a tool relevant to the request before falling back to REST or CLI.
- Prefer MCP tools → `az` CLI → raw REST, in that order.
- **Never assume the process template.** Determine the process from `capabilities.processTemplate.templateName` (fetch with `includeCapabilities=true`). Do not trust the `System.Process Template` project property.
- Use `ConvertFrom-Json -AsHashtable` when parsing ADO API responses in PowerShell.

## Repository layout

```
apps/              Application source (replace with your app)
packages/          Shared packages (replace with your packages)
infra/             Bicep — App Service, App Insights, alerts, SRE Agent
.github/workflows/  GitHub Actions — CI and CD. Delivery lives here, not in Azure DevOps
tools/delivery/boards-gate.mjs      Azure Boards release gate
tools/delivery/boards-comment.mjs   Deployment write-back to Azure Boards
tools/ado-bootstrap        Scaffolds the Azure DevOps project
.github/agents/    The agent fleet definitions
docs/              Documentation, ADRs, threat models
starter-kit/       Reusable subset for customers
```

## Engineering conventions

- TypeScript strict everywhere.
- Validation at every boundary using zod schemas.
- Domain logic lives in shared packages — not in route handlers.
- Errors follow RFC 7807 problem details.
- Structured logging only (pino). Never `console.log` in the API.
- Tests use Vitest. Every behaviour change ships with a test.

## Domain context

<DOMAIN_CONTEXT>

## Security rules — non-negotiable

- **No secrets in source, ever.** Use placeholders.
- Authenticate to Azure with managed identity.
- Authenticate GitHub Actions to Azure with OIDC workload identity federation. Never a client secret, PAT or publish profile.

## Delivery runs on GitHub Actions

Azure DevOps is used for **planning only**. CI/CD lives in `.github/workflows/`. There must be no `azure-pipelines.yml` in this repository.

Azure DevOps retains one delivery responsibility: it is the authority consulted before a production release, via `tools/delivery/boards-gate.mjs`, which queries Azure Boards and **fails closed**. Do not weaken it.
- Any new dependency must be justified in the pull request description.

## Traceability requirements

- Branches: `feature/<workitem-id>-slug`, `fix/<workitem-id>-slug`.
- Every commit and PR body must contain `AB#<id>`.
- AI-authored changes must state which agent produced them.

## Guardrails on AI-generated work

- Copilot cannot approve its own pull request.
- The person who triggered an agent cannot be its sole approver.
- Agents must not merge, force-push, rewrite history, or alter branch protection.

## Definition of done

A change is done when: it has a linked Boards work item; tests cover the new behaviour and pass; lint and typecheck are clean; security scanning is clean; the pull request documents risk and rollback; and a human has approved it.
