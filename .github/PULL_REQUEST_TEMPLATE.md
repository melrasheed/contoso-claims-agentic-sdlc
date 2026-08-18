<!--
Linked work item is REQUIRED. Put the Boards token in the body so Azure Boards links this PR automatically.
Format: AB#1234
-->

## Work item

AB#

## What changed and why

<!-- Describe the change for a reviewer who has not read the work item. Lead with the "why". -->

## Authorship

<!-- Required for audit. Tick all that apply. -->

- [ ] Human-authored
- [ ] GitHub Copilot coding agent
- [ ] Azure SRE Agent (incident remediation)
- [ ] Copilot-assisted (human-directed, AI-generated portions)

> If any AI option is ticked, the submitter confirms they have read and can explain every line of the change.

## Risk

<!-- What could this break? Who is affected if it does? Say "Low - isolated change, no data or contract impact" if that is genuinely true. -->

**Level:** Low / Medium / High

**Blast radius:**

## Rollback

<!-- One sentence: how do we undo this if it goes wrong in production? "Revert this commit" is acceptable ONLY if there is no data migration and no config change. -->

## Test evidence

<!-- Not "tests added". What behaviour is now proven, and how do we know the tests would fail if the code were wrong? -->

- [ ] Unit tests cover the new behaviour
- [ ] Every acceptance criterion on the work item maps to a test
- [ ] Manual verification performed (describe below)
- [ ] Not applicable, because:

## Security

- [ ] No secrets, keys, connection strings or personal data added to source, tests, comments or docs
- [ ] Sensitive claim fields (`claimantName`, `policyNumber`, full claim bodies) are not logged
- [ ] Input validated at every boundary with zod
- [ ] Authorisation enforced server-side, not only in the UI
- [ ] Security acceptance criteria from the threat model are implemented (or no threat model was required)
- [ ] New dependencies justified below (or none added)

**New dependencies and justification:**

## Operational impact

- [ ] No new configuration required
- [ ] New configuration required — listed below, and added to the deployment docs
- [ ] Requires a manual step during release — described below **and** flagged to the approver

<!-- Anything an operator must do. This is the most common cause of failed releases, so be explicit. -->

## Reviewer checklist

- [ ] I can explain what this change does without asking the author
- [ ] The rollback plan is credible
- [ ] Tests would actually fail if the implementation were wrong
- [ ] No gate, check or branch protection was weakened to make this pass

---

<sub>Reminder: Copilot cannot approve its own pull request, and whoever triggered an AI agent cannot be its sole approver.</sub>
