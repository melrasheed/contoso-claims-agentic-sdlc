<#
.SYNOPSIS
    Applies the Agentic SDLC branch protection ruleset to a GitHub repository.

.DESCRIPTION
    Governance is only real if it is enforced. This script applies the branch
    ruleset that backs the policy documented in docs/03-branch-and-pr-policy.md:

      - Pull request required, with at least one approving review
      - Stale approvals dismissed when new commits are pushed
      - Code owner review required on high-blast-radius paths
      - Required status checks must pass
      - Force pushes and branch deletion blocked
      - Linear history

    Idempotent: re-running updates the existing ruleset rather than creating a
    duplicate.

    IMPORTANT - the two AI guardrails that matter cannot be expressed as
    settings and are enforced by platform behaviour plus review culture:
      1. GitHub Copilot cannot approve its own pull request. This is platform
         behaviour, not a toggle.
      2. The person who triggered an agent should not be its sole approver.
         Increase -RequiredApprovals to 2 to force this structurally.

.PARAMETER Repository
    Target repository as "owner/repo".

.PARAMETER Branch
    Protected branch name. Defaults to main.

.PARAMETER RequiredApprovals
    Approving reviews required. Use 2 to structurally prevent an agent's
    triggering user from being the only approver.

.PARAMETER RequiredChecks
    Status check contexts that must pass. Must match the job names in
    .github/workflows exactly, or the rule silently never matches.

.PARAMETER RequireCodeOwnerReview
    Require review from CODEOWNERS. Recommended.

.EXAMPLE
    ./configure-branch-protection.ps1 -Repository melrasheed/contoso-claims-agentic-sdlc

.EXAMPLE
    ./configure-branch-protection.ps1 -Repository contoso/claims -RequiredApprovals 2 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][string]$Repository,
    [string]$Branch = 'main',
    [ValidateRange(0, 6)][int]$RequiredApprovals = 1,
    [string[]]$RequiredChecks = @('build-and-test'),
    [switch]$RequireCodeOwnerReview,
    [string]$RulesetName = 'Agentic SDLC - protected branch'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info { param([string]$m) Write-Host "  $m" }
function Write-Ok   { param([string]$m) Write-Host "  + $m" -ForegroundColor Green }
function Write-Warn { param([string]$m) Write-Host "  ! $m" -ForegroundColor Yellow }

Write-Host "Agentic SDLC - branch protection" -ForegroundColor White
Write-Host "  Repository : $Repository"
Write-Host "  Branch     : $Branch"
Write-Host "  Approvals  : $RequiredApprovals"
Write-Host "  Checks     : $($RequiredChecks -join ', ')"
Write-Host "  CODEOWNERS : $($RequireCodeOwnerReview.IsPresent)"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI (gh) is required. Install it from https://cli.github.com and run 'gh auth login'."
}

# gh reads GH_TOKEN from the environment in preference to the keyring, and that
# token often has narrower scopes. Clearing it here avoids a confusing 403.
$previousToken = $env:GH_TOKEN
$env:GH_TOKEN = $null

try {
    Write-Host "`n=== Verifying access ===" -ForegroundColor Cyan
    $repoJson = gh api "repos/$Repository" 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Cannot access $Repository. Check the name and run 'gh auth status'. $repoJson" }
    $repo = $repoJson | ConvertFrom-Json
    Write-Info "Visibility: $($repo.visibility)"
    Write-Info "Default branch: $($repo.default_branch)"

    if ($repo.visibility -eq 'private' -and $repo.owner.type -eq 'User') {
        Write-Warn "Branch rulesets on private personal repositories require GitHub Pro or an organisation."
        Write-Warn "If this call fails with 403, that limitation is the reason."
    }

    # --- Build the ruleset -------------------------------------------------
    $rules = @(
        @{ type = 'deletion' }
        @{ type = 'non_fast_forward' }   # blocks force pushes
        @{
            type       = 'pull_request'
            parameters = @{
                required_approving_review_count     = $RequiredApprovals
                dismiss_stale_reviews_on_push       = $true
                require_code_owner_review           = [bool]$RequireCodeOwnerReview
                require_last_push_approval          = $true
                required_review_thread_resolution   = $true
            }
        }
    )

    if ($RequiredChecks.Count -gt 0) {
        $rules += @{
            type       = 'required_status_checks'
            parameters = @{
                strict_required_status_checks_policy = $true
                required_status_checks = @($RequiredChecks | ForEach-Object { @{ context = $_ } })
            }
        }
    }

    $ruleset = @{
        name         = $RulesetName
        target       = 'branch'
        enforcement  = 'active'
        conditions   = @{ ref_name = @{ include = @("refs/heads/$Branch"); exclude = @() } }
        rules        = $rules
        bypass_actors = @()
    }

    $body = $ruleset | ConvertTo-Json -Depth 12 -Compress

    # --- Apply, idempotently ----------------------------------------------
    Write-Host "`n=== Applying ruleset ===" -ForegroundColor Cyan

    $existingJson = gh api "repos/$Repository/rulesets" 2>$null
    $existingId = $null
    if ($LASTEXITCODE -eq 0 -and $existingJson) {
        $existing = $existingJson | ConvertFrom-Json
        $match = $existing | Where-Object { $_.name -eq $RulesetName } | Select-Object -First 1
        if ($match) { $existingId = $match.id }
    }

    $target = if ($existingId) { "ruleset $existingId (update)" } else { 'new ruleset' }
    if (-not $PSCmdlet.ShouldProcess("$Repository/$Branch", "Apply $target")) {
        Write-Info 'WhatIf: no changes made.'
        Write-Host "`nPayload that would be sent:"
        $ruleset | ConvertTo-Json -Depth 12
        return
    }

    $tempFile = New-TemporaryFile
    try {
        $body | Set-Content -Path $tempFile -Encoding utf8

        if ($existingId) {
            $result = gh api --method PUT "repos/$Repository/rulesets/$existingId" --input $tempFile 2>&1
        }
        else {
            $result = gh api --method POST "repos/$Repository/rulesets" --input $tempFile 2>&1
        }

        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Ruleset API call failed:"
            Write-Host $result -ForegroundColor Red
            Write-Warn "Common causes: insufficient token scope (needs 'repo' plus admin on the repository),"
            Write-Warn "or branch rulesets not available on this plan for private personal repositories."
            throw 'Failed to apply the ruleset.'
        }

        $applied = $result | ConvertFrom-Json
        Write-Ok "Ruleset '$($applied.name)' id=$($applied.id) enforcement=$($applied.enforcement)"
    }
    finally {
        Remove-Item $tempFile -ErrorAction SilentlyContinue
    }

    # --- Summary -----------------------------------------------------------
    Write-Host "`n=== Applied policy ===" -ForegroundColor Cyan
    Write-Info "Pull request required before merging to $Branch"
    Write-Info "$RequiredApprovals approving review(s) required"
    Write-Info 'Stale approvals dismissed on new commits'
    Write-Info 'Last push must be approved by someone other than the pusher'
    Write-Info 'Review threads must be resolved'
    if ($RequireCodeOwnerReview) { Write-Info 'CODEOWNERS review required' }
    if ($RequiredChecks.Count) { Write-Info "Required checks: $($RequiredChecks -join ', ')" }
    Write-Info 'Force pushes blocked; branch deletion blocked'

    Write-Host "`nNot enforceable as settings - these rely on platform behaviour and review culture:" -ForegroundColor Yellow
    Write-Info 'Copilot cannot approve its own pull request (platform behaviour)'
    Write-Info 'The user who triggered an agent should not be its sole approver'
    Write-Info "  -> set -RequiredApprovals 2 to enforce this structurally"
}
finally {
    $env:GH_TOKEN = $previousToken
}
