# Agentic SDLC Accelerator — Business Case

**Audience:** engineering leadership and the customer-facing teams who will take this to accounts.
**Status:** working reference implementation, proven end-to-end.
**Date:** 2026

---

## 1. The problem worth solving

Most enterprises have now bought AI coding tools. Very few have changed how they deliver software. The tool sits inside the IDE, individual developers get faster at typing, and the organisation's actual delivery metrics — lead time, change failure rate, time to restore — barely move.

The reason is structural. Software delivery is not bottlenecked on typing speed. It is bottlenecked on the handoffs between stages: an underspecified requirement that reaches a developer three weeks later, a design decision nobody wrote down, a security review that happens after the code is written, a production incident whose lessons never return to the backlog.

**AI applied to a single stage optimises the wrong constraint.** AI applied to the handoffs is where the value is.

The second problem is trust. In regulated industries — insurance, banking, healthcare, public sector — the blocker is not "does the AI write good code". It is "can I prove who changed what, why, and who approved it". Most AI coding demos have no answer to that question, so they never leave the innovation lab.

## 2. What this accelerator demonstrates

A complete, governed lifecycle where AI participates at every stage and **every action lands in an auditable system of record**.

| | System | Role |
|---|---|---|
| **Plan** | Azure DevOps Boards | **Planning only** — backlog, acceptance criteria, test plans, and the authority consulted before a production release |
| **Build** | GitHub | Code, Copilot coding agent, Copilot code review, GitHub Advanced Security, **and all CI/CD via GitHub Actions** |
| **Run** | Azure | Runtime, plus the Azure SRE Agent closing the loop back to Boards |

Eleven agents span the lifecycle: requirements refinement, architecture decisions, threat modelling, implementation, testing, code review, security review, workflow authoring, release notes, incident response, and an orchestrator that enforces the handoff gates between them.

**The defining property is that there is no fast lane.** Code written by the Copilot coding agent, and fixes written autonomously by the Azure SRE Agent during an incident, pass through exactly the same pull request checks, the same review, and the same release gates as code written by a human. AI increases throughput into the funnel; it does not widen the funnel's controls.

**The second defining property is separation of duties.** Delivery runs in GitHub, but Azure Boards decides whether a release may proceed. An engineer can change a workflow file; they cannot silently close the Sev1 defect in Azure Boards that is blocking the release. That turns "do not ship on top of a known critical defect" from a convention into a control with a separate authority — which is the answer when an auditor asks how AI-assisted delivery is governed.

## 3. Evidence this is real

This is not a slideware concept. The following was executed against live systems:

- A work item created in Azure Boards (`Agentic SDLC` project) was sent to the GitHub Copilot coding agent natively from Boards using the Azure Boards → GitHub connection, which opened a draft pull request on branch `copilot/issue-2-require-dual-approval`.
- The Azure Boards work item carries a development link to the pull request, and the PR body contains `AB#2` for automatic traceability.
- Delivery runs entirely on GitHub Actions using OIDC federation — **no service connection, no stored client secret, no publish profile**.
- Infrastructure (App Service, Application Insights, Azure Monitor alerts, Azure SRE Agent) validated and deployed to a real Azure subscription.
- The reference application ships with 182 passing tests.

Along the way the build surfaced **seventeen genuine integration defects** — including a broken Azure DevOps MCP endpoint, an Azure DevOps API that reports the wrong process template, a high-severity shell-escaping vulnerability that CodeQL caught in the project's own tooling and blocked at the pull request, and a required status check context mismatch that silently enforced nothing while the branch appeared protected. Each is documented with symptom, cause, fix and verification. That troubleshooting guide is, for many customers, more immediately valuable than the demo itself, because it is the friction they will hit in week one.

### The governance proved itself

Three times, on real changes:

1. **Branch protection blocked a direct push to `main`**, forcing the change through a pull request.
2. **CodeQL blocked that pull request** on a genuine high-severity finding in AI-assisted code — incomplete shell escaping that allowed argument injection on Windows. It was fixed with regression tests before merge.
3. **Dependabot** opened security update pull requests for vulnerable transitive dependencies as soon as scanning was enabled.

That is the argument in miniature: AI-generated code met the same controls as human code, and the controls caught something real.

## 4. Where the value comes from

Framed against the four DORA metrics, because those are the numbers a CIO already tracks.

| Metric | Mechanism | Direction |
|---|---|---|
| **Lead time for change** | Refinement, design and implementation start in parallel rather than in sequence; work items become working branches without a human relay | Down |
| **Deployment frequency** | Smaller, better-specified changes; automated gates replace scheduled manual review meetings | Up |
| **Change failure rate** | Threat modelling at design time, generated tests tied to acceptance criteria, AI review as a consistent first pass before human review | Down |
| **Time to restore** | Azure SRE Agent detects, triages, mitigates and opens a fix branch without waiting for a human to wake up | Down |

Three effects matter more than raw coding speed:

**Requirements quality compounds.** A vague work item costs one hour of an analyst's time to fix at refinement, or three weeks of rework after it ships. AI refinement makes good specification cheap enough to always do.

**Security shifts genuinely left.** Threat modelling is skipped in practice because it is slow and requires scarce expertise. When a threat model costs minutes and produces concrete acceptance criteria, it happens on every relevant change rather than quarterly.

**Incidents stop being pure loss.** Today an incident consumes senior engineering time and produces a patched symptom. Here it produces a mitigation, a root cause, a tracked work item, a fix branch and a detection improvement — automatically, and back in the system of record.

## 5. ROI model

### 5.1 Method and honesty statement

The credible way to present this is **not** a single headline number. Published productivity claims for AI coding assistants vary enormously by task type, codebase maturity and measurement method, and any figure quoted as fact will be challenged — correctly.

So this model does two things instead:

1. Expresses benefit as a **percentage uplift applied to a cost base the customer already knows**, so they substitute their own numbers.
2. Presents **three scenarios** and shows the break-even point, so the argument survives a hostile assumption.

Costs below are real and checkable. Benefits are modelled and must be validated by measurement.

### 5.2 Illustrative baseline

A 50-engineer organisation. Substitute the customer's actual figures.

| Input | Value |
|---|---|
| Engineers | 50 |
| Fully-loaded cost per engineer | £110,000 |
| Annual engineering cost | £5.5m |
| Proportion of time on delivery (vs meetings, support, admin) | 60% → £3.3m |
| Production incidents per year (Sev1/Sev2) | 24 |
| Average engineering cost per incident | £12,000 → £288k |
| Escaped defects reaching production per year | 120 |
| Average cost to remediate an escaped defect | £3,500 → £420k |

### 5.3 Annual cost

| Item | Basis | Annual |
|---|---|---|
| GitHub Copilot Enterprise | 50 seats | ~£23,000 |
| GitHub Advanced Security | 50 committers | ~£30,000 |
| GitHub Actions minutes | Free on public repos; ~3,000 private minutes/month beyond the included allowance | ~£2,000 |
| Azure DevOps | Boards only — the Basic plan is free for the first 5 users and most enterprises already hold licences | ~£1,500 |
| Azure SRE Agent | token-based consumption, scoped to production | ~£15,000 |
| Azure runtime for the accelerator itself | B1/S1 App Service, App Insights | ~£1,500 |
| Enablement — build-out, training, adoption support | one-off, amortised over year one | ~£60,000 |
| **Total year one** | | **~£133,000** |
| **Total steady state (year two onward)** | | **~£73,000** |

> Using Azure DevOps for **planning only** reduces its licence footprint: no parallel-job purchases and no Azure Pipelines consumption. That saving is modest in absolute terms, but it removes a second CI/CD product from the estate — one fewer thing to secure, patch, and train people on.

### 5.4 Three scenarios

| | Conservative | Expected | Optimistic |
|---|---|---|---|
| Delivery throughput uplift | 8% | 15% | 25% |
| Escaped defect reduction | 10% | 20% | 30% |
| Incident time-to-restore reduction | 15% | 30% | 45% |
| **Throughput value** (× £3.3m) | £264,000 | £495,000 | £825,000 |
| **Defect value** (× £420k) | £42,000 | £84,000 | £126,000 |
| **Incident value** (× £288k) | £43,200 | £86,400 | £129,600 |
| **Gross annual benefit** | **£349,200** | **£665,400** | **£1,080,600** |
| Less year-one cost | (£132,500) | (£132,500) | (£132,500) |
| **Year-one net** | **£216,700** | **£532,900** | **£948,100** |
| **Year-one ROI** | **164%** | **402%** | **715%** |
| Payback period | ~4.6 months | ~2.4 months | ~1.5 months |

### 5.5 Break-even — the number to lead with

Break-even in year one requires a **throughput uplift of roughly 4%**, holding all other benefits at zero.

Four percent is approximately **90 minutes per engineer per week**. If an organisation does not believe an AI-augmented lifecycle can return 90 minutes a week per engineer, it should not proceed — and that is a much more productive conversation to have than arguing about whether the number is 15% or 25%.

Note that throughput dominates the model. This is honest but worth stating plainly: the defect and incident benefits are real but second-order. **Do not let a customer approve this on the basis of incident reduction alone** — the numbers do not support it at typical incident volumes.

### 5.6 Benefits deliberately excluded

Not modelled, because they are real but hard to defend numerically: reduced onboarding time for new joiners; retention effects from removing drudgery; audit and compliance evidence produced as a by-product rather than as a project; and the option value of a delivery system that can absorb better models as they arrive without re-architecting.

## 6. Risks and how they are addressed

| Risk | Reality | Mitigation built into the accelerator |
|---|---|---|
| **Throughput rises, quality falls** | The most likely failure mode. More PRs, same review capacity, defects leak | Gates are unchanged by AI; change failure rate is a tracked metric from day one; AI review is advisory and never a required approver |
| **Review becomes rubber-stamping** | Reviewers cannot keep up and start approving on trust | PR template forces Risk, Rollback and Test evidence; author must confirm they can explain every line; CODEOWNERS forces domain experts onto high-blast-radius paths |
| **Loss of auditability** | "Who authorised this change?" has no answer | Every change carries `AB#<id>` to a work item; AI authorship is recorded explicitly; the Boards native connection writes provenance back to the work item |
| **Skills atrophy** | Juniors never learn to design or debug | Agents produce artefacts humans review — ADRs, threat models, test plans — rather than opaque output; the orchestrator refuses to skip stages |
| **Autonomous agent does something destructive** | Genuine risk with the SRE Agent | Default is Review mode; per-tool `Allow`/`Ask`; Parameter Policy locks resource targets; agent scoped to one resource group. **Documented caveat: in Autonomous mode, tools marked `Ask` execute without approval** |
| **Preview-feature dependency** | Some capabilities are preview and will change | Every integration point is labelled with its status and has a documented fallback |
| **Vendor lock-in** | Fair challenge | The lifecycle pattern and agent definitions are portable |

## 7. Adoption roadmap

**Phase 1 — Prove it (weeks 1–4).** One team, one repository. Measure the baseline *before* enabling anything: lead time, PR cycle time, change failure rate, escaped defects. Deploy the accelerator, establish `copilot-instructions.md`, PR template and the AI usage norms. Configure the Azure Boards → GitHub connection. Success criterion: one work item travels Boards → Copilot PR → gated release, and the team can explain every step.

**Phase 2 — Expand (weeks 5–12).** Three to four teams. Add Copilot code review and the Azure SRE Agent in Review mode. Weekly prompt-sharing session; publish a shared agent library in a central repository. Success criterion: throughput up with change failure rate flat or down. If change failure rate rises, stop and fix the gates before adding teams.

**Phase 3 — Standardise (quarter 2).** Pipeline templates and agent definitions centralised; teams extend rather than fork. Selectively enable Autonomous mode for narrow, well-understood SRE actions. Success criterion: a new team onboards in under a day using the starter kit.

## 8. What to measure

Track from the baseline, and review monthly:

- Lead time for change, and PR cycle time
- Deployment frequency and change failure rate — **always together**, never separately
- Escaped defects per release
- Mean time to restore, and the proportion of incidents where the SRE Agent produced a usable root cause
- Percentage of merged PRs with a linked work item — a direct measure of whether traceability is holding
- Percentage of AI review findings actioned rather than dismissed

**The single most important signal is the ratio of deployment frequency to change failure rate.** If both rise together, the organisation is shipping faster and breaking more, and the controls need attention before scaling further.

## 9. Recommendation

Run Phase 1 with one team on a real, non-critical service. Insist on measuring the baseline first — without it, no ROI claim from this or any other AI initiative is defensible.

The accelerator makes that pilot cheap: the starter kit, tutorial and troubleshooting guide remove most of the setup cost, and the integration defects a team would otherwise spend a fortnight discovering are already documented with fixes.

---

### Appendix — what a customer receives

| Artefact | Purpose |
|---|---|
| Working reference application | Contoso Claims API + UI, 182 tests |
| 11-agent fleet definitions | Portable across repositories and customers |
| Process-aware Azure DevOps bootstrap | Works on Basic, Agile, Scrum and CMMI |
| **Azure Boards release gate** | Restores the Azure Pipelines "Query Work Items" control in GitHub Actions, where no equivalent exists |
| **Boards deployment write-back** | Keeps Azure Boards a complete record of what actually shipped |
| GitHub Actions CI/CD | Build, scan, deploy, gate, approve, canary swap, auto-rollback, release |
| OIDC federation scripts | No stored secrets; production credentials bound to an approved environment |
| Bicep infrastructure | Including the Azure SRE Agent, validated and deployed |
| Preflight readiness doctor | Detects broken integrations before they derail a demo |
| Tutorial, security model, SRE runbook | Step-by-step adoption |
| Architecture rationale | Why planning and delivery are separated, and what it costs |
| Troubleshooting guide | Seventeen real defects with symptom, cause, fix, verification |
| Starter kit with `init` configurator | Adopt in minutes, then modify |
