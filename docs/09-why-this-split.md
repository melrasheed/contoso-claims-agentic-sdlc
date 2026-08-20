# 09 — Why planning and delivery are separated

> The question a sceptical architect asks in the first ten minutes: *"If you already have Azure DevOps, why not use Azure Pipelines? And if you're going to use GitHub Actions, why keep Azure DevOps at all?"*
>
> This document answers both, including what the split costs.

---

## The split

| System | Role |
|---|---|
| **Azure DevOps** | Planning only — epics, work items, acceptance criteria, queries, backlog audit trail |
| **GitHub** | Everything executable — code, Copilot agents, review, CI/CD, environments, approvals, security scanning, releases |
| **Azure** | Runtime and operations |

Azure DevOps keeps exactly one foothold in delivery: it is the **authority consulted before a production release**, via the Azure Boards gate in `cd.yml`.

---

## Why not run delivery in Azure Pipelines?

### 1. The AI work already happens in GitHub

The GitHub Copilot coding agent works on GitHub repositories, opens GitHub pull requests, and responds to GitHub Copilot code review. GitHub Advanced Security, CodeQL, Dependabot and secret scanning attach to the same pull request.

Running delivery in Azure Pipelines puts a system boundary in the middle of the loop the accelerator exists to demonstrate. The evidence a reviewer needs — checks, review comments, scanning results, deployment status — is then split across two products with two identity models and two audit logs.

**Keeping delivery in GitHub means the pull request is a single, complete record of what happened to a change.**

### 2. One artefact, one identity model

With Actions, a change moves from commit to production without leaving the platform that already holds the code and the review. Authentication is OIDC federation with no stored secret. There is no service connection to create, no PAT to rotate, no second permissions model to reason about.

### 3. Fewer moving parts to hand a customer

The accelerator has to be adoptable. Every additional product in the critical path is another licence conversation, another admin to involve, another failure mode in a live demo.

### 4. It is where the ecosystem is

Actions has the larger action ecosystem, and the tooling a team is most likely to already know.

---

## Then why keep Azure DevOps at all?

This is the more interesting half of the question, because "just use GitHub Issues and Projects" is a legitimate alternative.

### 1. Planning tools and code tools are used by different people

Portfolio managers, business analysts, delivery managers and QA leads live in Boards, Queries, Delivery Plans and Test Plans. Most of them do not want a GitHub account, and should not need one to prioritise work.

GitHub Projects is good, and improving. Azure Boards is still stronger for **portfolio-scale hierarchy, cross-team delivery planning, capacity, and structured test management**. Enterprises that already run Boards have years of history, saved queries, dashboards and reporting built on it. Migrating that is a programme of work with no user-visible benefit.

### 2. Separation of duties is a compliance property, not an inconvenience

In a regulated environment there is real value in the record of *what was authorised* living somewhere the engineering team cannot silently edit.

A developer with write access to the repository can change a workflow file. They cannot quietly close the Sev1 bug in Azure Boards that is blocking the release — that is a different system, a different permission, and a visible act by a named person.

**The split turns "do not ship on top of a known critical defect" from a convention into a control with a separate authority.** That is the answer when someone asks how AI-assisted delivery survives an audit.

### 3. It reflects how enterprises actually are

Most large organisations already have both. A design that assumes greenfield consolidation is not a design they can adopt; it is a migration proposal wearing a demo's clothes.

---

## What the split costs

An honest architecture document states the bill.

### 1. You maintain the release gate yourself

Azure Pipelines has a supported, first-party **Query Work Items** check. GitHub has no equivalent, so `tools/delivery/boards-gate.mjs` exists. It is about 300 lines of dependency-free JavaScript, covered by unit tests — but it is yours to maintain, and if the Azure DevOps REST API changes, you fix it.

This is the single largest cost of the split and should be presented as such.

### 2. Two identity systems

The workflow authenticates to Azure with OIDC and to Azure DevOps with either an Entra token or a PAT. Two trust relationships to set up and understand, versus one service connection.

### 3. Traceability has to be built, not inherited

Azure Pipelines updates work items with build and release information automatically. `tools/delivery/boards-comment.mjs` reproduces that for Actions. Without it, Azure Boards would know what was planned and committed but not what actually shipped — the system of record would quietly become incomplete.

### 4. An extra failure mode

The gate fails closed, so an Azure DevOps outage blocks releases. With a single-vendor pipeline, one outage stops everything anyway — but the failure is easier to explain.

### 5. Two places to look during an incident

"Where is the work item?" and "where is the deployment?" have different answers. Mitigated by `AB#` linking in both directions, but it is a real cognitive cost for someone new.

The bridge between Azure Boards and GitHub was a sixth cost item in an earlier version of this design. It has since been replaced by the native Azure Boards to GitHub connection, which removed a maintained TypeScript component, a separate credential, and two additional failure modes. The seam is now a thin, deliberate human click rather than a synchronised copy.

---

## When you should *not* use this split

Be willing to talk a customer out of it:

- **You have no existing Azure DevOps investment.** Start with GitHub Issues and Projects. Adding Azure DevOps purely to follow this pattern is not worth it.
- **Your planning is lightweight.** Fewer than about thirty engineers, no portfolio hierarchy, no formal test management — GitHub Projects will serve you and cost less to operate.
- **You have no compliance driver.** If nobody will ever ask you to prove who authorised a release, the separation-of-duties argument does not apply and the maintenance cost is not repaid.
- **You are already fully on Azure DevOps and happy.** Copilot coding agent needs a GitHub repository, so this pattern implies moving code to GitHub. That is a real migration. Do it because you want the AI loop, not because a reference architecture said so.

---

## The alternatives, fairly stated

| Option | Good when | Cost |
|---|---|---|
| **Boards + Actions** (this accelerator) | Existing Boards investment, compliance driver, want Copilot agents | You maintain the gate and the write-back |
| **All GitHub** (Issues, Projects, Actions) | Greenfield, lighter planning, small to mid-size teams | Weaker portfolio planning and test management |
| **All Azure DevOps** (Boards, Repos, Pipelines) | Deep ADO investment, no appetite to move code | No Copilot coding agent — it requires a GitHub repository |
| **Boards + Pipelines, code in GitHub** | Want Copilot agents but must keep Pipelines | Delivery evidence split across two systems; two identity models |

---

## The one-line version

> **Plan where the business plans. Build where the AI builds. Make the planner authoritative over releases so the separation of duties is real rather than rhetorical.**

---

## Related

- [`04-release-gates.md`](04-release-gates.md) — how the Boards gate is implemented
- [`05-security-model.md`](05-security-model.md) — the separation-of-duties argument in security terms
- [`business-case.md`](business-case.md) — the commercial case
