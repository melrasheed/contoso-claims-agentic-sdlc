<#
.SYNOPSIS
    Creates Azure Pipelines environments and applies release gates using Entra ID.

.DESCRIPTION
    Companion to pipelines/configure-checks.ps1, which requires a PAT. This
    version authenticates with Entra ID via the Azure CLI, so no secret needs
    to be created or stored.

    Creates the `dev` and `prod` environments and applies to `prod`:
      - Approval gate, with requesterCannotBeApprover enabled
      - Exclusive Lock, so only one release runs at a time

    NOT configurable through a documented API, and therefore left to the portal:
      - The "Query Work Items" check that blocks release on active Sev1/Sev2
        bugs. The backing query is created by tools/ado-bootstrap/bootstrap.ps1
        as "Release Gate - active Sev1 Sev2 bugs"; you attach it manually.
      - The "Business Hours" check.
    Both are documented in docs/04-release-gates.md.

.PARAMETER Organization
    Azure DevOps organisation name, e.g. "contoso".

.PARAMETER Project
    Azure DevOps project name.

.PARAMETER Approvers
    Optional Entra object IDs or ADO identity IDs to use as approvers.
    Defaults to the signed-in user, which is fine for a demo but must be
    changed for real use - a single approver who is also the deployer defeats
    the control.

.EXAMPLE
    ./configure-ado-environments.ps1 -Organization melrasheed -Project "Agentic SDLC"

.EXAMPLE
    ./configure-ado-environments.ps1 -Organization contoso -Project Claims -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][string]$Organization,
    [Parameter(Mandatory = $true)][string]$Project,
    [string[]]$Approvers,
    [int]$TimeoutMinutes = 43200
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Well-known Azure DevOps application ID - a public constant, not a secret.
$AdoResourceId = '499b84ac-1321-427f-aa17-267ca6975798'

# Well-known check type identifiers used by Azure Pipelines.
$CheckTypes = @{
    Approval      = @{ id = '8C6F20A7-A545-4486-9777-F762FAFE0D4D'; name = 'Approval' }
    ExclusiveLock = @{ id = '2EF31AD6-BAA0-403A-8B45-2CBC9B4E5563'; name = 'ExclusiveLock' }
}

$projectUrl = "https://dev.azure.com/$Organization/$([uri]::EscapeDataString($Project))"

function Get-Token {
    $token = az account get-access-token --resource $AdoResourceId --query accessToken -o tsv 2>$null
    if (-not $token) { throw "Could not acquire an Azure DevOps token. Run 'az login'." }
    return $token
}

function Invoke-Ado {
    param([string]$Uri, [string]$Method = 'GET', $Body)
    $token = Get-Token
    $headers = @{ Authorization = "Bearer $token" }
    if ($Method -eq 'GET') {
        # -AsHashtable because Azure DevOps responses can contain an
        # empty-string property name, which ConvertFrom-Json otherwise rejects.
        return (Invoke-WebRequest -Uri $Uri -Headers $headers -ErrorAction Stop).Content | ConvertFrom-Json -AsHashtable
    }
    $headers['Content-Type'] = 'application/json'
    return Invoke-RestMethod -Uri $Uri -Headers $headers -Method $Method -Body ($Body | ConvertTo-Json -Depth 12) -ErrorAction Stop
}

Write-Host "Azure DevOps environments and gates" -ForegroundColor White
Write-Host "  Organisation : $Organization"
Write-Host "  Project      : $Project"

# --- Resolve approvers -----------------------------------------------------
if (-not $Approvers -or $Approvers.Count -eq 0) {
    $token = Get-Token
    $me = (Invoke-WebRequest "https://vssps.dev.azure.com/$Organization/_apis/profile/profiles/me?api-version=7.1" `
            -Headers @{ Authorization = "Bearer $token" }).Content | ConvertFrom-Json -AsHashtable
    $Approvers = @($me.id)
    Write-Host "  Approver     : $($me.displayName) (signed-in user)" -ForegroundColor Yellow
    Write-Warning "Using the signed-in user as the sole approver. Acceptable for a demo only."
    Write-Warning "In real use, name approvers who are not the person deploying."
}

# --- Environments ----------------------------------------------------------
Write-Host "`n=== Environments ===" -ForegroundColor Cyan
$envUrl = "$projectUrl/_apis/distributedtask/environments"
$existing = Invoke-Ado -Uri "$envUrl`?api-version=7.1"
$existingNames = @($existing.value | ForEach-Object { $_.name })
$environmentIds = @{}
foreach ($e in $existing.value) { $environmentIds[$e.name] = $e.id }

$wanted = @(
    @{ name = 'dev';  description = 'Development - automatic deployment, no approval' }
    @{ name = 'prod'; description = 'Production - approvals, work item query gate, business hours, exclusive lock' }
)

foreach ($w in $wanted) {
    if ($existingNames -contains $w.name) {
        Write-Host "  = $($w.name) (id=$($environmentIds[$w.name]))" -ForegroundColor DarkGray
        continue
    }
    if (-not $PSCmdlet.ShouldProcess($w.name, 'Create environment')) { continue }
    $created = Invoke-Ado -Uri "$envUrl`?api-version=7.1" -Method POST -Body @{ name = $w.name; description = $w.description }
    $environmentIds[$w.name] = $created.id
    Write-Host "  + $($created.name) (id=$($created.id))" -ForegroundColor Green
}

# --- Gates on prod ---------------------------------------------------------
if (-not $environmentIds.ContainsKey('prod')) {
    Write-Warning 'prod environment not available; skipping gate configuration.'
    return
}

Write-Host "`n=== Gates on prod ===" -ForegroundColor Cyan
$prodId = $environmentIds['prod']
$checksUrl = "$projectUrl/_apis/pipelines/checks/configurations?api-version=7.1-preview.1"
$resource = @{ type = 'environment'; id = "$prodId"; name = 'prod' }

$existingChecks = @()
try {
    $ec = Invoke-Ado -Uri "$projectUrl/_apis/pipelines/checks/configurations?resourceType=environment&resourceId=$prodId&api-version=7.1-preview.1"
    $existingChecks = @($ec.value | ForEach-Object { $_.type.name })
} catch { }

$gates = @(
    @{
        name = 'Approval'
        body = @{
            type     = $CheckTypes.Approval
            settings = @{
                approvers                 = @($Approvers | ForEach-Object { @{ id = $_ } })
                executionOrder            = 1
                instructions              = 'Confirm risk, rollback and test evidence on the linked pull request. AI-authored changes require a human who can explain them.'
                minRequiredApprovers      = 1
                requesterCannotBeApprover = $true
            }
            resource = $resource
            timeout  = $TimeoutMinutes
        }
    }
    @{
        name = 'ExclusiveLock'
        body = @{
            type     = $CheckTypes.ExclusiveLock
            settings = @{}
            resource = $resource
            timeout  = $TimeoutMinutes
        }
    }
)

foreach ($g in $gates) {
    if ($existingChecks -contains $g.name) { Write-Host "  = $($g.name) already configured" -ForegroundColor DarkGray; continue }
    if (-not $PSCmdlet.ShouldProcess("prod/$($g.name)", 'Configure check')) { continue }
    try {
        $r = Invoke-Ado -Uri $checksUrl -Method POST -Body $g.body
        Write-Host "  + $($g.name) configured (id=$($r.id))" -ForegroundColor Green
    }
    catch {
        Write-Host "  ! $($g.name) failed: $($_.ErrorDetails.Message ?? $_.Exception.Message)" -ForegroundColor Red
    }
}

# --- Manual remainder ------------------------------------------------------
Write-Host "`n=== Still to do in the portal ===" -ForegroundColor Yellow
Write-Host "  1. Query Work Items check on the prod environment"
Write-Host "     Pipelines > Environments > prod > Approvals and checks > + > Query Work Items"
Write-Host "     Query    : Shared Queries/Release Gate - active Sev1 Sev2 bugs"
Write-Host "     Upper    : 0   (any matching work item blocks the release)"
Write-Host "  2. Business Hours check, if unattended out-of-hours deployment is not wanted"
Write-Host "  3. Add a second approver from outside the authoring team"
Write-Host ""
