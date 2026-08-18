# 03 — Branch and PR policy

---

## Branch strategy

This repository uses a **trunk-based development** model. `main` is always releasable. Feature work happens in short-lived branches.

### Branch naming

| Branch type | Pattern | Example |
|---|---|---|
| Feature work (human) | `feature/<workitem-id>-<slug>` | `feature/3-risk-score-banding` |
| Bug fix | `fix/<workitem-id>-<slug>` | `fix/7-null-policy-number` |
| Hotfix | `hotfix/<workitem-id>-<slug>` | `hotfix/12-auth-bypass` |
| Copilot coding agent | `copilot/issue-<N>-<slug>` | `copilot/issue-2-require-dual-approval` |
| Release | `release/<semver>` | `release/1.2.0` |

The `<workitem-id>` in the branch name is the Azure Boards work item ID. The `AB#<id>` token in commit and PR bodies is what Azure Boards uses to link automatically — the branch name is for human readability.

**Branches Copilot creates** use the `copilot/` prefix. This prefix is controlled by the GitHub platform and cannot be customised.

### What is forbidden

- Pushing directly to `main` or `release/*`.
- Long-lived feature branches (more than a sprint).
- Branches without a linked work item (traceability gap — the release manager flags these).

---

## Commit messages

Include `AB#<id>` in every commit that relates to a work item:

```
feat: add risk score banding to claims list (AB#3)

Implements three banding tiers (Green < 30, Amber 30–69, Red >= 70) using
the calculateRiskScore function from packages/shared. Threshold values
are constants in the shared package — not hardcoded in the UI.
```

Azure Boards links the commit to the work item automatically when `AB#<id>` appears anywhere in the commit message body.

---

## Pull request requirements

Every PR must:

1. **Include `AB#<id>`** in the PR body — not just the title. Azure Boards links PRs via the body.
2. **Fill in all sections** of `.github/PULL_REQUEST_TEMPLATE.md`: Work item, What changed and why, Authorship, Risk, Rollback, Test evidence, Security, Operational impact.
3. **State authorship explicitly.** Tick Human-authored, Copilot coding agent, Azure SRE Agent, or Copilot-assisted as appropriate. This is an audit requirement.
4. **State a credible rollback plan.** "Revert this commit" is acceptable only when there is no data migration or config change.

### Authorship rule

The PR template states:

> If any AI option is ticked, the submitter confirms they have read and can explain every line of the change.

"The agent wrote it" is not a review defence. A human must be able to explain any merged change.

---

## Required checks

The following checks are required on `main` before merge. They are enforced by branch protection rules, not by convention.

| Check | Enforced by |
|---|---|
| Build (lint + typecheck + unit tests) | Pipeline — Build stage |
| Security scan (npm audit + CredScan) | Pipeline — SecurityScan stage |
| At least one human approval | GitHub branch protection |
| Copilot code review (when available) | GitHub branch protection |
| No unresolved conversations | GitHub branch protection |

### Status checks and the pipeline

The pipeline runs on every PR targeting `main`. The Build and SecurityScan stages must pass before merge. The DeployDev and VerifyDev stages run post-merge on `main`.

---

## CODEOWNERS

`.github/CODEOWNERS` assigns required reviewers by path. Paths listed later in the file win. Current assignments:

| Path | Owner | Why elevated |
|---|---|---|
| `*` | `@melrasheed` | Default for everything |
| `/infra/` | `@melrasheed` | Infrastructure change affects every service |
| `/pipelines/` | `@melrasheed` | Pipeline change affects every deployment |
| `/.github/workflows/` | `@melrasheed` | Workflow change affects CI/CD security boundary |
| `/.github/agents/` | `@melrasheed` | Agent definition change affects AI behaviour across the whole lifecycle |
| `/.github/copilot-instructions.md` | `@melrasheed` | Grounding context for all agents — a governance change |
| `/.github/CODEOWNERS` | `@melrasheed` | Changing CODEOWNERS changes who reviews what |
| `/.github/PULL_REQUEST_TEMPLATE.md` | `@melrasheed` | PR template is a governance artefact |
| `/tools/ado-github-bridge/` | `@melrasheed` | Bridge bugs break traceability and audit |
| `/docs/threat-models/` | `@melrasheed` | Security artefacts require security sign-off |
| `/docs/05-security-model.md` | `@melrasheed` | Security model requires security sign-off |
| `/packages/shared/src/risk*` | `@melrasheed` | Risk scoring is input to financial decisions |

When adopting this kit for a customer: replace `@melrasheed` with real team handles (e.g., `@contoso/platform-team`, `@contoso/security-team`). Requiring teams rather than individuals is more robust.

---

## Approval rules

| Rule | Detail |
|---|---|
| Copilot cannot approve its own PR | Platform-enforced — Copilot is not an eligible approver of its own submissions |
| The person who triggered an agent cannot be its sole approver | Process rule — a second human must review |
| Elevated paths require at least one CODEOWNERS reviewer | Branch protection — cannot merge without the named reviewer approving |

### Why these rules matter for regulated industries

When AI generates a change, the risk is that the same person who described the task is the only reviewer. The separation-of-duties argument: the agent acts, the human who prompted it cannot be the only check. A second human reviewer who was not involved in the prompting provides independent verification.

This is the same argument as "the developer cannot be the only approver of their own PR" — extended to AI-authored contributions.

---

## Merge strategy

- Merge commits (`--no-ff`) for feature branches. Preserves branch history and `AB#` tokens.
- Squash and merge for small fixups that would otherwise litter the log.
- **Never rebase onto main** after a branch has been pushed — it rewrites history and breaks `AB#` link resolution in Azure Boards.
- Agents (Copilot, SRE) must not rebase, force-push, or rewrite history. This is a guardrail in `.github/copilot-instructions.md`.
