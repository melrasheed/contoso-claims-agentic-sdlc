<#
.SYNOPSIS
    Configures the Agentic SDLC Accelerator starter kit for a specific customer environment.

.DESCRIPTION
    Prompts for the required configuration values, then replaces all <PLACEHOLDER> markers
    in the starter-kit files with the supplied values.

    Run interactively to be prompted for each value.
    Run with -NonInteractive and parameters to script the configuration.
    Run with -WhatIf to preview what would be changed without writing any files.

    The script writes files into the starter-kit/ directory and does not modify
    the reference implementation files in apps/, packages/, infra/, pipelines/, or tools/.

.PARAMETER NonInteractive
    Skip interactive prompts. All required parameters must be supplied on the command line.

.PARAMETER AdoOrg
    Azure DevOps organisation name (e.g. "contoso" — not the full URL).

.PARAMETER AdoProject
    Azure DevOps project name (e.g. "My Engineering").

.PARAMETER GhOwner
    GitHub organisation or user name (e.g. "contoso-corp").

.PARAMETER GhRepo
    GitHub repository name (e.g. "my-application").

.PARAMETER AppName
    Customer application name used in agent grounding context (e.g. "Contoso Inventory").

.PARAMETER AppDescription
    One-sentence description of the application.

.PARAMETER DomainContext
    Domain-specific guidance for agents (e.g. "Claims data is regulated PII. Never log policy numbers.").
    Can be updated manually in copilot-instructions.md after generation.

.PARAMETER NamePrefix
    Short prefix for Azure resource names — max 10 characters, letters and numbers only.

.PARAMETER AzureLocation
    Azure region for infrastructure (e.g. "eastus", "westeurope").

.PARAMETER SubscriptionId
    Azure subscription ID. Optional — can be filled in the variable group manually.

.PARAMETER TenantId
    Azure tenant ID. Optional — can be filled in the variable group manually.

.PARAMETER CodeownersTeam
    GitHub team or user for CODEOWNERS elevated paths (e.g. "@contoso/platform-team").

.PARAMETER AlertEmail
    Operations team email address for Azure Monitor alert notifications.

.EXAMPLE
    # Interactive
    .\starter-kit\init.ps1

.EXAMPLE
    # Non-interactive with all required parameters
    .\starter-kit\init.ps1 `
        -NonInteractive `
        -AdoOrg "contoso" `
        -AdoProject "My Engineering" `
        -GhOwner "contoso" `
        -GhRepo "my-app" `
        -AppName "Contoso Inventory" `
        -NamePrefix "inv" `
        -AzureLocation "westeurope" `
        -CodeownersTeam "@contoso/platform-team" `
        -AlertEmail "ops@contoso.com"

.EXAMPLE
    # Preview without changes
    .\starter-kit\init.ps1 -WhatIf
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$NonInteractive,
    [string]$AdoOrg,
    [string]$AdoProject,
    [string]$GhOwner,
    [string]$GhRepo,
    [string]$AppName,
    [string]$AppDescription,
    [string]$DomainContext,
    [string]$NamePrefix,
    [string]$AzureLocation,
    [string]$SubscriptionId,
    [string]$TenantId,
    [string]$CodeownersTeam,
    [string]$AlertEmail
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:Changed = 0
$script:Skipped = 0

function Write-Step   { param([string]$Msg) Write-Host "`n=== $Msg ===" -ForegroundColor Cyan }
function Write-Done   { param([string]$Msg) Write-Host "  + $Msg" -ForegroundColor Green; $script:Changed++ }
function Write-Skip   { param([string]$Msg) Write-Host "  = $Msg" -ForegroundColor DarkGray; $script:Skipped++ }
function Write-Warn   { param([string]$Msg) Write-Host "  ! $Msg" -ForegroundColor Yellow }

function Read-RequiredValue {
    param(
        [string]$PromptText,
        [string]$CurrentValue,
        [string]$ParamName
    )
    if ($NonInteractive) {
        if (-not $CurrentValue) {
            Write-Error "-$ParamName is required when -NonInteractive is specified."
            exit 1
        }
        return $CurrentValue
    }
    if ($CurrentValue) { return $CurrentValue }
    do {
        $val = Read-Host $PromptText
    } while (-not $val.Trim())
    return $val.Trim()
}

function Read-OptionalValue {
    param(
        [string]$PromptText,
        [string]$CurrentValue,
        [string]$Default = ''
    )
    if ($NonInteractive) {
        return $CurrentValue ? $CurrentValue : $Default
    }
    if ($CurrentValue) { return $CurrentValue }
    $val = Read-Host "$PromptText [leave blank to skip]"
    return $val.Trim() ? $val.Trim() : $Default
}

function Replace-InFile {
    param(
        [string]$FilePath,
        [hashtable]$Replacements
    )

    if (-not (Test-Path $FilePath)) {
        Write-Warn "File not found, skipping: $FilePath"
        return
    }

    $content = Get-Content $FilePath -Raw -Encoding UTF8
    $original = $content
    $touched = $false

    foreach ($key in $Replacements.Keys) {
        $placeholder = "<$key>"
        $value = $Replacements[$key]
        if ($content.Contains($placeholder)) {
            $content = $content.Replace($placeholder, $value)
            $touched = $true
        }
    }

    if (-not $touched) {
        Write-Skip $FilePath
        return
    }

    if ($PSCmdlet.ShouldProcess($FilePath, "Replace placeholders")) {
        Set-Content -Path $FilePath -Value $content -Encoding UTF8 -NoNewline
        Write-Done $FilePath
    } else {
        Write-Host "  [what-if] Would update: $FilePath" -ForegroundColor DarkGray
    }
}

# ---------------------------------------------------------------------------
# Collect configuration values
# ---------------------------------------------------------------------------
Write-Step "Collecting configuration"

$cfg = @{
    ADO_ORG           = Read-RequiredValue "Azure DevOps organisation name (e.g. contoso)" $AdoOrg "AdoOrg"
    ADO_PROJECT       = Read-RequiredValue "Azure DevOps project name (e.g. My Engineering)" $AdoProject "AdoProject"
    GH_OWNER          = Read-RequiredValue "GitHub owner (org or user, e.g. contoso)" $GhOwner "GhOwner"
    GH_REPO           = Read-RequiredValue "GitHub repository name (e.g. my-app)" $GhRepo "GhRepo"
    APP_NAME          = Read-RequiredValue "Application name (e.g. Contoso Inventory)" $AppName "AppName"
    APP_DESCRIPTION   = Read-OptionalValue "One-sentence application description" $AppDescription "<describe your application>"
    DOMAIN_CONTEXT    = Read-OptionalValue "Domain-specific agent guidance (e.g. PII rules, business invariants)" $DomainContext "<add domain-specific guidance for agents here>"
    NAME_PREFIX       = Read-RequiredValue "Azure resource name prefix (max 10 chars, e.g. inv)" $NamePrefix "NamePrefix"
    AZURE_LOCATION    = Read-OptionalValue "Azure region (e.g. eastus, westeurope)" $AzureLocation "eastus"
    SUBSCRIPTION_ID   = Read-OptionalValue "Azure subscription ID (optional, fill later)" $SubscriptionId "<your-subscription-id>"
    TENANT_ID         = Read-OptionalValue "Azure tenant ID (optional, fill later)" $TenantId "<your-tenant-id>"
    CODEOWNERS_TEAM   = Read-OptionalValue "CODEOWNERS team or user (e.g. @contoso/platform-team)" $CodeownersTeam "@<your-team>"
    ALERT_EMAIL       = Read-OptionalValue "Operations alert email" $AlertEmail "ops-team@example.com"
}

# Validate NAME_PREFIX
if ($cfg.NAME_PREFIX -match '[^a-zA-Z0-9]') {
    Write-Error "NAME_PREFIX must contain only letters and numbers. Got: '$($cfg.NAME_PREFIX)'"
    exit 1
}
if ($cfg.NAME_PREFIX.Length -gt 10) {
    Write-Error "NAME_PREFIX must be 10 characters or fewer. Got: '$($cfg.NAME_PREFIX)' ($($cfg.NAME_PREFIX.Length) chars)"
    exit 1
}

# ---------------------------------------------------------------------------
# Echo plan
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Agentic SDLC Accelerator — Starter Kit Configuration" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
foreach ($key in $cfg.Keys | Sort-Object) {
    Write-Host ("  {0,-25}: {1}" -f $key, $cfg[$key])
}
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------------
# Locate starter-kit root
# ---------------------------------------------------------------------------
$kitRoot = $PSScriptRoot   # starter-kit/

# ---------------------------------------------------------------------------
# Replace placeholders in all files
# ---------------------------------------------------------------------------
Write-Step "Updating .github/copilot-instructions.md"
Replace-InFile `
    -FilePath (Join-Path $kitRoot ".github\copilot-instructions.md") `
    -Replacements $cfg

Write-Step "Updating .github/agents/"
$agentFiles = Get-ChildItem (Join-Path $kitRoot ".github\agents\") -Filter "*.md" -ErrorAction SilentlyContinue
foreach ($f in $agentFiles) {
    Replace-InFile -FilePath $f.FullName -Replacements $cfg
}

Write-Step "Updating .github/CODEOWNERS"
Replace-InFile `
    -FilePath (Join-Path $kitRoot ".github\CODEOWNERS") `
    -Replacements $cfg

Write-Step "Updating infra/main.parameters.json"
Replace-InFile `
    -FilePath (Join-Path $kitRoot "infra\main.parameters.json") `
    -Replacements $cfg

Write-Step "Updating infra/main.parameters.prod.json"
Replace-InFile `
    -FilePath (Join-Path $kitRoot "infra\main.parameters.prod.json") `
    -Replacements $cfg

Write-Step "Updating pipelines/azure-pipelines.yml"
Replace-InFile `
    -FilePath (Join-Path $kitRoot "pipelines\azure-pipelines.yml") `
    -Replacements $cfg

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor $(if ($script:Changed -gt 0) { 'Green' } else { 'Yellow' })
Write-Host "  Files updated: $($script:Changed)    Already configured: $($script:Skipped)" -ForegroundColor $(if ($script:Changed -gt 0) { 'Green' } else { 'Yellow' })
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor $(if ($script:Changed -gt 0) { 'Green' } else { 'Yellow' })
Write-Host ""

if ($script:Changed -gt 0 -and -not $WhatIfPreference) {
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Review the updated files in starter-kit/.github/ and starter-kit/infra/"
    Write-Host "  2. Copy the starter-kit/ contents into your target repository"
    Write-Host "  3. Follow ADOPTION-CHECKLIST.md for the remaining manual steps"
    Write-Host ""
    Write-Host "  Start here: .\tools\ado-bootstrap\bootstrap.ps1 -Organization $($cfg.ADO_ORG) -Project `"$($cfg.ADO_PROJECT)`""
}
