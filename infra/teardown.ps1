<#
.SYNOPSIS
    Deletes the Agentic SDLC Accelerator resource group(s) from Azure.

.DESCRIPTION
    Prompts for confirmation unless -Force is specified.
    Permanently deletes all resources in the target resource group.

.PARAMETER SubscriptionId
    Azure subscription ID. Defaults to the currently active az CLI subscription.

.PARAMETER NamePrefix
    Short prefix used in resource naming.

.PARAMETER EnvironmentName
    Target environment to tear down: dev, prod, or 'all' (tears down both).

.PARAMETER Force
    Skip confirmation prompt. Use with caution.

.EXAMPLE
    # Tear down dev with confirmation prompt
    .\infra\teardown.ps1 -EnvironmentName dev -NamePrefix contoso

.EXAMPLE
    # Force tear down prod (no prompt)
    .\infra\teardown.ps1 -EnvironmentName prod -NamePrefix contoso -Force
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$SubscriptionId,
    [string]$NamePrefix = 'contoso',
    [ValidateSet('dev', 'prod', 'all')]
    [string]$EnvironmentName = 'dev',
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Resolve subscription
# ---------------------------------------------------------------------------
if (-not $SubscriptionId) {
    $SubscriptionId = (az account show --query id -o tsv 2>$null).Trim()
    if (-not $SubscriptionId) {
        Write-Error "Not logged in to Azure. Run 'az login' first."
        exit 1
    }
}

# ---------------------------------------------------------------------------
# Build list of resource groups to delete
# ---------------------------------------------------------------------------
$envs = if ($EnvironmentName -eq 'all') { @('dev', 'prod') } else { @($EnvironmentName) }
$resourceGroups = $envs | ForEach-Object { "${NamePrefix}-rg-${_}" }

# ---------------------------------------------------------------------------
# Echo plan
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Red
Write-Host "  ⚠  TEARDOWN — DESTRUCTIVE OPERATION" -ForegroundColor Red
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Red
Write-Host "  Subscription    : $SubscriptionId"
Write-Host "  Resource Groups : $($resourceGroups -join ', ')"
Write-Host ""
Write-Host "  ALL resources in the above groups will be PERMANENTLY DELETED." -ForegroundColor Red
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Red
Write-Host ""

# ---------------------------------------------------------------------------
# Confirmation prompt
# ---------------------------------------------------------------------------
if (-not $Force) {
    $confirmation = Read-Host "Type 'yes' to confirm deletion, anything else to abort"
    if ($confirmation -ne 'yes') {
        Write-Host "Aborted — no resources were deleted." -ForegroundColor Yellow
        exit 0
    }
}

# ---------------------------------------------------------------------------
# Set active subscription
# ---------------------------------------------------------------------------
az account set --subscription $SubscriptionId
if ($LASTEXITCODE -ne 0) { Write-Error "Failed to set subscription"; exit 1 }

# ---------------------------------------------------------------------------
# Delete each resource group
# ---------------------------------------------------------------------------
foreach ($rg in $resourceGroups) {
    $exists = az group exists --name $rg --subscription $SubscriptionId
    if ($exists -eq 'true') {
        Write-Host "▶ Deleting resource group: $rg ..." -ForegroundColor Yellow
        az group delete `
            --name $rg `
            --subscription $SubscriptionId `
            --yes `
            --no-wait
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Failed to initiate deletion of '$rg'. Check the portal."
        } else {
            Write-Host "  ✓ Deletion initiated for '$rg' (--no-wait; may take a few minutes)." -ForegroundColor Green
        }
    } else {
        Write-Host "  – Resource group '$rg' not found, skipping." -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "Teardown initiated. Monitor progress in the Azure Portal." -ForegroundColor Cyan
