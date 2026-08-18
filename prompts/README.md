# Prompt Library

Copy-pasteable prompts for each stage of the agentic lifecycle. Every prompt is written to be used against this repository as it actually is, and each names the agent it is intended for.

Replace `<...>` placeholders before use.

---

## Stage 0 — Orchestration

**Find out where a work item actually is.**

```
Use the sdlc-orchestrator agent.

Work item AB#<id> in the "Agentic SDLC" Azure DevOps project.

Tell me which lifecycle stage this item is at, which stage gates it has
genuinely passed (verify the artefacts exist, do not take a previous agent's
word for it), what is blocking it, and the single next action with its owner.
Be blunt about what is not done.
```

**Drive an item end to end.**

```
Use the sdlc-orchestrator agent.

Take AB#<id> from refinement through to a pull request ready for human review.

Route it to the right specialist agent at each stage and enforce the gates.
Skip a stage only if you can justify why it does not apply, and say so
explicitly. Do not merge anything, and do not approve anything.
```

---

## Stage 1 — Requirements refinement

```
Use the business-analyst agent.

Refine Epic AB#1 ("Contoso Claims - straight-through claims processing")
in the "Agentic SDLC" project.

Decompose it into deliverable backlog items, each small enough to complete in
under three days. Write Given/When/Then acceptance criteria that a tester could
verify without asking you what you meant. Include negative and edge cases, not
just the happy path.

Note the project uses the Basic process, so the available types are Epic, Issue
and Task, and there is no acceptance criteria field - fold acceptance criteria
into the description under a clear heading.

Tag an item `ai-ready` only if it has acceptance criteria and no open
NEEDS DECISION lines.
```

**Refine a single vague item.**

```
Use the business-analyst agent.

AB#<id> is too vague to implement. Read it, read the relevant code in apps/api,
and rewrite it with testable acceptance criteria. List anything that needs a
human business decision rather than guessing at it.
```

---

## Stage 2 — Architecture

```
Use the architect agent.

AB#<id> requires a design decision before implementation.

Read the work item and the affected code in apps/api and packages/shared.
Produce an ADR in docs/adr/ considering at least two genuine options, with the
trade-offs stated plainly. Include a Mermaid diagram if more than one component
is affected. Say how reversible the decision is.

If this change does not actually warrant an ADR, say so and explain why rather
than manufacturing one.
```

---

## Stage 3 — Threat modelling

```
Use the threat-modeler agent.

Threat model AB#2 ("Require dual approval for claims above 50,000").

This is an adjudication path, so it moves money. Walk STRIDE at every trust
boundary. For each finding give a concrete attacker scenario - not a generic
category - and a specific implementable mitigation. Rate likelihood and impact
honestly; do not mark everything critical.

Write the model to docs/threat-models/ and add security acceptance criteria to
the work item. Credit controls that already exist rather than reporting them as
gaps.
```

---

## Stage 4 — Implementation

Implementation runs on the **GitHub Copilot coding agent**, not a local agent. Two ways to trigger it:

**Path A — via the bridge (recommended, gives full traceability).**

```powershell
# Tag the work item `ai-ready` in Azure Boards, then:
$env:ADO_ORG='melrasheed'; $env:ADO_PROJECT='Agentic SDLC'
$env:GH_OWNER='melrasheed'; $env:GH_REPO='contoso-claims-agentic-sdlc'
$env:GITHUB_TOKEN=(gh auth token)

node tools/ado-github-bridge/dist/cli.js sync --dry-run   # preview
node tools/ado-github-bridge/dist/cli.js sync             # for real
```

**Path B — assign an existing GitHub issue to Copilot** in the GitHub UI, or from Azure Boards using the native "send to Copilot" integration where it is enabled.

---

## Stage 5 — Testing

```
Use the test-engineer agent.

Review pull request #<n> and close the coverage gaps.

Map every acceptance criterion on the linked work item to at least one test.
Prioritise the adjudication state machine and its illegal transitions - a claim
that can be adjudicated twice is a double-payment path, not a status code
defect.

For each test you write, confirm it would actually fail if the implementation
were wrong. Report any criterion you cannot test and why, and lead your report
with any defect you found in the implementation while writing the tests.
```

---

## Stage 6 — Review

Copilot code review runs automatically on pull requests. For the deeper security pass:

```
Use the security-reviewer agent.

Review pull request #<n> for exploitable vulnerabilities.

Focus on authorisation on the adjudication path, object-level authorisation
(can one user act on another's claim by changing an ID), server-derived values
being accepted from the client such as riskScore or approvedAmount, and whether
claimantName or policyNumber leak into logs, telemetry or error responses.

Only report findings where you can describe the exploit concretely. Anything
else is an observation - label it as such. Say plainly if the change is clean.
```

---

## Stage 7 — Release engineering

```
Use the devops-engineer agent.

Add a stage to pipelines/azure-pipelines.yml that <requirement>.

Keep the existing gate structure intact. State what it costs, what the blast
radius is, and how to roll back. Validate the YAML before you claim success,
and tell me anything I must still configure in the portal.
```

**Release notes.**

```
Use the release-manager agent.

Produce release notes and a readiness summary for everything merged since
<tag-or-date>.

Resolve each pull request to its Azure Boards work item via the AB# token and
list any change that has no linked work item separately - that is a traceability
gap. Distinguish AI-authored changes from human-authored ones. Flag anything
requiring manual action at the top.
```

---

## Stage 8 — Operations

The **Azure SRE Agent** handles detection, triage and first-line mitigation. Trigger a demonstrable incident:

```powershell
# Break production deliberately
curl -X POST https://<api-host>/api/admin/fault `
     -H "Content-Type: application/json" `
     -d '{"mode":"error","durationSeconds":300}'

# Confirm it is failing
curl https://<api-host>/api/claims

# Restore
curl -X POST https://<api-host>/api/admin/fault `
     -H "Content-Type: application/json" `
     -d '{"mode":"none"}'
```

Then review what the SRE Agent did:

```
Use the sre-liaison agent.

The Azure SRE Agent responded to an incident on the Contoso Claims API and
opened a fix branch.

Verify from telemetry - not from the agent's own claim - that the mitigation
actually worked. Review the fix branch as code: does it address the root cause
or the symptom, is it tested, would it pass our normal review bar?

Then close the loop: confirm the Azure DevOps work item exists with the right
severity and evidence, and tell me how long it took between the fault starting
and the alert firing. If a customer would have noticed first, the alerting is
the real defect - propose the specific rule change.

Do not merge the fix branch.
```

---

## Cross-cutting

**Readiness check before a demo.**

```powershell
npm run preflight
node tools/ado-github-bridge/dist/cli.js doctor
```

**Ask an agent to challenge a plan.**

```
Before implementing, tell me the three most likely ways this change breaks in
production, and what we would see first in telemetry. If you think the request
itself is wrong, say so instead of building it.
```
