<#
.SYNOPSIS
    Creates GitHub Environments and their deployment protection rules.

.DESCRIPTION
    Replaces the Azure DevOps pipeline environments and their Approval /
    Exclusive Lock checks.

    Mapping from the Azure Pipelines model:

      ADO "Approvals" check              -> environment required reviewers
      ADO "Business Hours" check         -> environment wait timer (approximate)
      ADO "Exclusive Lock" check         -> workflow `concurrency` group in cd.yml
      ADO "Query Work Items" check       -> tools/delivery/boards-gate.mjs (no native
                                            GitHub equivalent exists)

    The Query Work Items gap is the important one: GitHub cannot consult an
    external backlog, so that control is implemented as a job in the workflow
    rather than as an environment rule. See docs/04-release-gates.md.

.PARAMETER Repository
    Target repository as "owner/repo".

.PARAMETER Reviewers
    GitHub usernames required to approve a production deployment. A deployment
    cannot be approved by the user who triggered it, so naming at least two
    people is strongly recommended.

.PARAMETER WaitTimerMinutes
    Enforced delay before a production deployment proceeds. Gives a human the
    chance to intervene on an unattended release.

.PARAMETER ProtectedBranchOnly
    Restrict production deployments to the default branch.

.EXAMPLE
    ./configure-github-environments.ps1 -Repository melrasheed/contoso-claims-agentic-sdlc -Reviewers melrasheed

.EXAMPLE
    ./configure-github-environments.ps1 -Repository contoso/claims -Reviewers alice,bob -WaitTimerMinutes 10 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][string]$Repository,
    [string[]]$Reviewers = @(),
    [ValidateRange(0, 43200)][int]$WaitTimerMinutes = 0,
    [switch]$ProtectedBranchOnly = $true
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Step { param([string]$m) Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Write-Ok   { param([string]$m) Write-Host "  + $m" -ForegroundColor Green }
function Write-Same { param([string]$m) Write-Host "  = $m" -ForegroundColor DarkGray }
function Write-Warn { param([string]$m) Write-Host "  ! $m" -ForegroundColor Yellow }

if ($Repository -notmatch '^[^/]+/[^/]+$') {
    throw "Repository must be in 'owner/repo' form. Received '$Repository'."
}
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw 'GitHub CLI (gh) is required. Install from https://cli.github.com then run: gh auth login'
}

Write-Host 'GitHub Environments and deployment protection' -ForegroundColor White
Write-Host "  Repository : $Repository"
Write-Host "  Reviewers  : $(if ($Reviewers) { $Reviewers -join ', ' } else { '(none — production will deploy unattended)' })"
Write-Host "  Wait timer : $WaitTimerMinutes minute(s)"

$previousToken = $env:GH_TOKEN
$env:GH_TOKEN = $null

try {
    Write-Step 'Verifying access'
    $repoJson = gh api "repos/$Repository" 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Cannot access $Repository. Run 'gh auth status'. $repoJson" }
    $repo = $repoJson | ConvertFrom-Json
    Write-Host "  Visibility     : $($repo.visibility)"
    Write-Host "  Default branch : $($repo.default_branch)"

    if ($repo.visibility -ne 'public' -and $repo.owner.type -eq 'User') {
        Write-Warn 'Deployment protection rules on private personal repositories require'
        Write-Warn 'GitHub Pro, Team or Enterprise. On a free private repo the environment'
        Write-Warn 'is created but reviewers and wait timers are silently ignored.'
    }

    # --- Resolve reviewer user ids ----------------------------------------
    $reviewerPayload = @()
    foreach ($login in $Reviewers) {
        $userJson = gh api "users/$login" 2>&1
        if ($LASTEXITCODE -ne 0) { Write-Warn "unknown GitHub user '$login' — skipping"; continue }
        $user = $userJson | ConvertFrom-Json
        $reviewerPayload += @{ type = 'User'; id = $user.id }
        Write-Host "  Reviewer       : $login (id $($user.id))"
    }

    # --- dev ---------------------------------------------------------------
    Write-Step 'Environment: dev'
    # Deliberately unprotected. Dev exists to find problems, and a gate that
    # delays feedback on a dev deployment has negative value.
    if ($PSCmdlet.ShouldProcess("$Repository/dev", 'Create or update environment')) {
        $devBody = @{ wait_timer = 0; prevent_self_review = $false } | ConvertTo-Json -Depth 5 -Compress
        $tmp = New-TemporaryFile
        try {
            $devBody | Set-Content -Path $tmp -Encoding utf8
            gh api --method PUT "repos/$Repository/environments/dev" --input $tmp 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) { Write-Ok 'dev (no protection rules — intentional)' }
            else { Write-Warn 'could not create the dev environment' }
        }
        finally { Remove-Item $tmp -ErrorAction SilentlyContinue }
    }

    # --- prod --------------------------------------------------------------
    Write-Step 'Environment: prod'
    $prodSettings = @{
        wait_timer          = $WaitTimerMinutes
        prevent_self_review = $true   # the deployer cannot approve their own release
    }
    if ($reviewerPayload.Count -gt 0) { $prodSettings.reviewers = $reviewerPayload }
    if ($ProtectedBranchOnly) {
        $prodSettings.deployment_branch_policy = @{
            protected_branches     = $true
            custom_branch_policies = $false
        }
    }

    if ($PSCmdlet.ShouldProcess("$Repository/prod", 'Create or update environment')) {
        $tmp = New-TemporaryFile
        try {
            ($prodSettings | ConvertTo-Json -Depth 6 -Compress) | Set-Content -Path $tmp -Encoding utf8
            $result = gh api --method PUT "repos/$Repository/environments/prod" --input $tmp 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Ok 'prod'
                if ($reviewerPayload.Count) { Write-Ok "  required reviewers: $($Reviewers -join ', ')" }
                else { Write-Warn '  no required reviewers — production will deploy without human approval' }
                if ($WaitTimerMinutes -gt 0) { Write-Ok "  wait timer: $WaitTimerMinutes minute(s)" }
                if ($ProtectedBranchOnly)   { Write-Ok '  protected branches only' }
                Write-Ok '  self-review prevented'
            }
            else {
                Write-Warn 'could not configure the prod environment:'
                Write-Host $result -ForegroundColor Red
            }
        }
        finally { Remove-Item $tmp -ErrorAction SilentlyContinue }
    }

    # --- What this does not cover ------------------------------------------
    Write-Step 'Controls not provided by GitHub Environments'
    Write-Host '  Azure Boards work item gate' -ForegroundColor Yellow
    Write-Host '    GitHub cannot consult an external backlog, so this is implemented as'
    Write-Host '    the `boards-gate` job in .github/workflows/cd.yml, running'
    Write-Host '    tools/delivery/boards-gate.mjs against the shared query'
    Write-Host '    "Release Gate - active Sev1 Sev2 bugs".'
    Write-Host ''
    Write-Host '  One-deployment-at-a-time' -ForegroundColor Yellow
    Write-Host '    Provided by the `concurrency` group in cd.yml, not by an environment rule.'
    Write-Host ''
}
finally {
    $env:GH_TOKEN = $previousToken
}
