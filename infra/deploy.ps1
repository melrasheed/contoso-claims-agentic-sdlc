<#
.SYNOPSIS
    Deploys the Agentic SDLC Accelerator Bicep infrastructure to Azure.

.DESCRIPTION
    Idempotent deployment script. Creates the resource group if it doesn't exist,
    then runs an incremental Bicep deployment. Prints all outputs at the end.

.PARAMETER SubscriptionId
    Azure subscription ID. Defaults to the currently active az CLI subscription.

.PARAMETER NamePrefix
    Short prefix used in resource naming (max 10 chars, no special chars).

.PARAMETER EnvironmentName
    Target environment: dev or prod.

.PARAMETER Location
    Azure region (e.g. eastus, westeurope). Defaults to eastus.

.PARAMETER EnableSlots
    Set to $true to enable the API staging slot (upgrades plan to S1).

.PARAMETER ParametersFile
    Path to a parameters JSON file. Defaults to infra/main.parameters.json
    for dev, or infra/main.parameters.prod.json for prod.

.PARAMETER WhatIf
    Runs az deployment group what-if instead of creating resources.

.EXAMPLE
    # Deploy dev environment
    .\infra\deploy.ps1 -EnvironmentName dev -NamePrefix contoso

.EXAMPLE
    # Prod deployment with slots
    .\infra\deploy.ps1 -EnvironmentName prod -NamePrefix contoso -EnableSlots

.EXAMPLE
    # What-if preview
    .\infra\deploy.ps1 -EnvironmentName dev -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$SubscriptionId,
    [string]$NamePrefix = 'contoso',
    [ValidateSet('dev', 'prod')]
    [string]$EnvironmentName = 'dev',
    [string]$Location = 'eastus',
    [switch]$EnableSlots,
    [string]$ParametersFile,
    [switch]$WhatIf
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Resolve script root so the script works regardless of CWD
# ---------------------------------------------------------------------------
$scriptRoot = $PSScriptRoot   # infra/
$repoRoot   = Split-Path $scriptRoot -Parent

# ---------------------------------------------------------------------------
# Resolve parameters file
# ---------------------------------------------------------------------------
if (-not $ParametersFile) {
    $ParametersFile = if ($EnvironmentName -eq 'prod') {
        Join-Path $scriptRoot 'main.parameters.prod.json'
    } else {
        Join-Path $scriptRoot 'main.parameters.json'
    }
}

if (-not (Test-Path $ParametersFile)) {
    Write-Error "Parameters file not found: $ParametersFile"
    exit 1
}

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

$resourceGroupName = "${NamePrefix}-rg-${EnvironmentName}"
$deploymentName    = "deploy-${EnvironmentName}-$(Get-Date -Format 'yyyyMMddHHmmss')"
$bicepFile         = Join-Path $scriptRoot 'main.bicep'

# ---------------------------------------------------------------------------
# Echo plan
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Agentic SDLC Accelerator — Bicep Deployment" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Subscription   : $SubscriptionId"
Write-Host "  Resource Group : $resourceGroupName"
Write-Host "  Location       : $Location"
Write-Host "  Environment    : $EnvironmentName"
Write-Host "  Name Prefix    : $NamePrefix"
Write-Host "  Enable Slots   : $($EnableSlots.IsPresent)"
Write-Host "  Parameters     : $ParametersFile"
Write-Host "  Bicep File     : $bicepFile"
Write-Host "  What-If Mode   : $($WhatIf.IsPresent)"
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------------
# Set active subscription
# ---------------------------------------------------------------------------
Write-Host "▶ Setting active subscription..." -ForegroundColor Yellow
az account set --subscription $SubscriptionId
if ($LASTEXITCODE -ne 0) { Write-Error "Failed to set subscription"; exit 1 }

# ---------------------------------------------------------------------------
# Ensure resource group exists (idempotent)
# ---------------------------------------------------------------------------
$rgExists = az group exists --name $resourceGroupName --subscription $SubscriptionId
if ($rgExists -eq 'false') {
    if ($WhatIf) {
        Write-Host "  [what-if] Would create resource group: $resourceGroupName in $Location" -ForegroundColor DarkGray
    } else {
        Write-Host "▶ Creating resource group: $resourceGroupName" -ForegroundColor Yellow
        az group create `
            --name $resourceGroupName `
            --location $Location `
            --subscription $SubscriptionId `
            --tags "project=agentic-sdlc" "env=$EnvironmentName" "managedBy=bicep"
        if ($LASTEXITCODE -ne 0) { Write-Error "Failed to create resource group"; exit 1 }
        Write-Host "  ✓ Resource group created." -ForegroundColor Green
    }
} else {
    Write-Host "  ✓ Resource group '$resourceGroupName' already exists." -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# Build the override parameters string
# ---------------------------------------------------------------------------
$overrideParams = "namePrefix=$NamePrefix environmentName=$EnvironmentName enableSlots=$($EnableSlots.IsPresent.ToString().ToLower())"

# ---------------------------------------------------------------------------
# Deploy or What-If
# ---------------------------------------------------------------------------
if ($WhatIf) {
    Write-Host ""
    Write-Host "▶ Running what-if analysis..." -ForegroundColor Yellow
    az deployment group what-if `
        --resource-group $resourceGroupName `
        --subscription $SubscriptionId `
        --template-file $bicepFile `
        --parameters "@$ParametersFile" `
        --parameters $overrideParams `
        --no-pretty-print
    if ($LASTEXITCODE -ne 0) { Write-Error "What-if failed"; exit 1 }
} else {
    Write-Host ""
    Write-Host "▶ Starting deployment: $deploymentName" -ForegroundColor Yellow
    $output = az deployment group create `
        --name $deploymentName `
        --resource-group $resourceGroupName `
        --subscription $SubscriptionId `
        --template-file $bicepFile `
        --parameters "@$ParametersFile" `
        --parameters $overrideParams `
        --query "properties.outputs" `
        --output json

    if ($LASTEXITCODE -ne 0) { Write-Error "Deployment failed"; exit 1 }

    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host "  ✓ Deployment succeeded!" -ForegroundColor Green
    Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host ""
    Write-Host "Deployment Outputs:" -ForegroundColor Cyan
    Write-Host $output
}
