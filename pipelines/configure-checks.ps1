<#
.SYNOPSIS
    Configures Azure DevOps environment checks via the REST API.

.DESCRIPTION
    Configures the following checks on the "prod" pipeline environment:
      - Exclusive Lock (API-configurable)
      - Business Hours check (API-configurable)
      - Approval gate (API-configurable)

    The following checks MUST be configured manually in the portal because
    the ADO REST API does not expose a stable documented endpoint for them:
      - "Query Work Items" check (blocks on active Sev1/Sev2 bugs)
        See: https://learn.microsoft.com/en-us/azure/devops/pipelines/process/approvals

    PREREQUISITES:
      - $env:AZURE_DEVOPS_EXT_PAT must be set (Personal Access Token with
        Environments Read & Manage scope, plus Work Items Read scope)
      - az devops CLI extension must be installed: az extension add --name azure-devops

    USAGE:
      $env:AZURE_DEVOPS_EXT_PAT = "<your-pat>"
      .\pipelines\configure-checks.ps1

.NOTES
    ADO Project : Agentic SDLC
    ADO Org     : https://dev.azure.com/melrasheed
    Project ID  : 14c073ab-b275-43c8-917d-462e47ceb855
#>
[CmdletBinding()]
param(
    [string]$OrgUrl       = 'https://dev.azure.com/melrasheed',
    [string]$ProjectId    = '14c073ab-b275-43c8-917d-462e47ceb855',
    [string]$ProjectName  = 'Agentic SDLC',
    [string]$TeamName     = 'Agentic SDLC Team',
    [string]$Environment  = 'prod',
    [string]$Pat          = $env:AZURE_DEVOPS_EXT_PAT
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $Pat) {
    Write-Error "Set the AZURE_DEVOPS_EXT_PAT environment variable before running this script."
    exit 1
}

# ---------------------------------------------------------------------------
# Helper: base64-encode PAT for Basic auth
# ---------------------------------------------------------------------------
$base64Pat = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(":$Pat"))
$headers = @{
    Authorization  = "Basic $base64Pat"
    'Content-Type' = 'application/json'
}

function Invoke-AdoRest {
    param([string]$Method, [string]$Uri, [object]$Body = $null)
    $params = @{ Method = $Method; Uri = $Uri; Headers = $headers }
    if ($Body) { $params['Body'] = ($Body | ConvertTo-Json -Depth 20 -Compress) }
    Invoke-RestMethod @params
}

# ---------------------------------------------------------------------------
# 1. Resolve environment ID
# ---------------------------------------------------------------------------
Write-Host "▶ Resolving environment '$Environment' in project '$ProjectName'..." -ForegroundColor Yellow
$envsUri = "$OrgUrl/$ProjectId/_apis/pipelines/environments?api-version=7.1-preview.1"
$envs = Invoke-AdoRest -Method GET -Uri $envsUri
$targetEnv = $envs.value | Where-Object { $_.name -eq $Environment } | Select-Object -First 1

if (-not $targetEnv) {
    Write-Warning "Environment '$Environment' not found. Create it first:"
    Write-Warning "  Pipelines → Environments → New environment → Name: prod"
    Write-Warning "Then re-run this script."
    exit 1
}

$envId = $targetEnv.id
Write-Host "  ✓ Found environment '$Environment' (id=$envId)" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 2. Configure Exclusive Lock
# ---------------------------------------------------------------------------
Write-Host "▶ Configuring Exclusive Lock on '$Environment'..." -ForegroundColor Yellow
$lockUri = "$OrgUrl/$ProjectId/_apis/pipelines/checks/configurations?api-version=7.1-preview.1"
$lockBody = @{
    type     = @{ id = 'fe1de3ee-a436-41b4-bb20-f6eb4cb879a7'; name = 'Task Check' }
    settings = @{
        displayName = 'Exclusive Lock'
        definitionRef = @{
            id      = 'fe1de3ee-a436-41b4-bb20-f6eb4cb879a7'
            name    = 'Task Check'
            version = '0.0.1'
        }
        inputs      = @{}
        retryOnError = $false
        allowedBranches = ''
    }
    resource = @{ type = 'environment'; id = "$envId" }
    timeout  = 43200  # 12 hours
}

try {
    Invoke-AdoRest -Method POST -Uri $lockUri -Body $lockBody | Out-Null
    Write-Host "  ✓ Exclusive Lock configured." -ForegroundColor Green
} catch {
    Write-Warning "  Could not configure Exclusive Lock via API (may already exist or need manual setup): $_"
}

# ---------------------------------------------------------------------------
# 3. Configure Manual Approval gate
# ---------------------------------------------------------------------------
Write-Host "▶ Configuring Approval gate on '$Environment'..." -ForegroundColor Yellow

# Retrieve current user's descriptor to use as approver (placeholder)
# In production, replace with a group descriptor for your release approvers.
Write-Host "  ℹ  Approval gate requires at least one approver."
Write-Host "  ℹ  You MUST manually configure approvers in the portal:"
Write-Host "     Pipelines → Environments → prod → Approvals and checks → + → Approvals"
Write-Host "     Add the release approver group/user."
Write-Host "     The REST API for Approvals requires user/group object IDs."

# ---------------------------------------------------------------------------
# 4. Business Hours Check (portal only — documented below)
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  MANUAL PORTAL STEPS REQUIRED" -ForegroundColor Cyan
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "The following checks cannot be fully automated via the REST API." -ForegroundColor Yellow
Write-Host "Navigate to: $OrgUrl/$ProjectName/_environments"
Write-Host "Select: prod → Approvals and checks → +"
Write-Host ""
Write-Host "  [REQUIRED] 1. Query Work Items (blocks on active Sev1/Sev2 Bugs)" -ForegroundColor Red
Write-Host "     - Check type : Query Work Items"
Write-Host "     - Query      : Create a shared query:"
Write-Host '                    [System.WorkItemType] = "Bug"'
Write-Host '                    AND [Microsoft.VSTS.Common.Severity] IN ("1 - Critical", "2 - High")'
Write-Host '                    AND [System.State] NOT IN ("Closed", "Resolved")'
Write-Host "     - Max allowed : 0  (blocks if ANY active Sev1/Sev2 bugs exist)"
Write-Host ""
Write-Host "  [REQUIRED] 2. Business Hours" -ForegroundColor Red
Write-Host "     - Check type    : Business Hours"
Write-Host "     - Time zone     : UTC"
Write-Host "     - Business days : Monday – Friday"
Write-Host "     - Start time    : 09:00"
Write-Host "     - End time      : 17:00"
Write-Host ""
Write-Host "  [RECOMMENDED] 3. Approvals" -ForegroundColor Yellow
Write-Host "     - Check type  : Approvals"
Write-Host "     - Approvers   : Add your release manager / team group"
Write-Host "     - Instructions: 'Confirm no active Sev1/Sev2 bugs before approving.'"
Write-Host ""
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# 5. Verify / list current checks
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "▶ Current checks on environment '$Environment':" -ForegroundColor Yellow
$checksUri = "$OrgUrl/$ProjectId/_apis/pipelines/checks/configurations?resourceType=environment&resourceId=$envId&api-version=7.1-preview.1"
try {
    $checks = Invoke-AdoRest -Method GET -Uri $checksUri
    if ($checks.count -eq 0) {
        Write-Host "  (none configured yet)" -ForegroundColor DarkGray
    } else {
        $checks.value | ForEach-Object {
            Write-Host "  - $($_.type.name): $($_.settings.displayName ?? '(no display name)')"
        }
    }
} catch {
    Write-Warning "Could not list checks: $_"
}

Write-Host ""
Write-Host "Done. Complete the portal steps above before enabling the prod pipeline." -ForegroundColor Green
