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
| `build-and-test` | `.github/workflows/ci.yml` |
| `Analyze javascript-typescript` (CodeQL) | `.github/workflows/codeql.yml` |
| `Review dependency changes` | `.github/workflows/dependency-review.yml` |
| At least one human approval | GitHub branch ruleset |
| Code owner review on protected paths | GitHub branch ruleset + CODEOWNERS |
| No unresolved conversations | GitHub branch ruleset |

### Status checks and the workflows

CI runs on every pull request targeting `main`; those checks must pass before merge. Delivery (`cd.yml`) runs **after** merge — it deploys to dev, evaluates the Azure Boards release gate, and only reaches production on a deliberate `workflow_dispatch`.

> **A silent failure to be aware of.** The required status check *context* in the branch ruleset must exactly match the job id reported by the workflow — not the display name, and not a previous name. If they differ, GitHub lists the check as required but never resolves it. The ruleset therefore appears configured while enforcing nothing, and branches look protected while the check is never actually evaluated.
>
> `tools/configure-branch-protection.ps1` guards against this: it reads the job names from `.github/workflows/` and refuses to apply a ruleset containing a context that matches no job, printing the available names instead. Use `-SkipCheckNameVerification` only for genuinely external checks (such as CodeQL or third-party scanners that report under fixed names).
>
> The CI job id is `build-and-test`. If you see the check stuck as "Waiting" on a pull request, run:
> ```powershell
> gh api repos/<owner>/<repo>/rules/branches/main --jq '.[] | select(.type=="required_status_checks")'
> ```
> and compare the context names against the actual job ids in:
> ```powershell
> gh run view <id> --json jobs --jq '.jobs[].name'
> ```

There are no Azure Pipelines in this repository. Delivery is GitHub Actions — see [`09-why-this-split.md`](09-why-this-split.md).

---

## CODEOWNERS

`.github/CODEOWNERS` assigns required reviewers by path. Paths listed later in the file win. Current assignments:

| Path | Owner | Why elevated |
|---|---|---|
| `*` | `@melrasheed` | Default for everything |
| `/infra/` | `@melrasheed` | Infrastructure change affects every service |
| `/.github/workflows/` | `@melrasheed` | **Delivery controls live here** — the release gate, environment bindings and rollback are workflow code |
| `/tools/delivery/boards-gate.mjs` | `@melrasheed` | The release gate itself. Weakening it removes the Sev1 block |
| `/.github/agents/` | `@melrasheed` | Agent definition change affects AI behaviour across the whole lifecycle |
| `/.github/copilot-instructions.md` | `@melrasheed` | Grounding context for all agents — a governance change |
| `/.github/CODEOWNERS` | `@melrasheed` | Changing CODEOWNERS changes who reviews what |
| `/.github/PULL_REQUEST_TEMPLATE.md` | `@melrasheed` | PR template is a governance artefact |
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
