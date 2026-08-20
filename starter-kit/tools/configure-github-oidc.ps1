<#
.SYNOPSIS
    Configures OpenID Connect federation between GitHub Actions and Azure.

.DESCRIPTION
    Replaces the Azure DevOps service connection. Creates an Entra ID
    application, federates it to specific GitHub environments, grants it the
    narrowest Azure role that works, and publishes the non-secret identifiers
    as GitHub repository variables.

    Nothing produced by this script is a secret. There is no client secret, no
    certificate and no publish profile - GitHub presents a short-lived OIDC
    token and Azure exchanges it. Nothing to rotate, nothing to leak.

    Federated credentials are scoped per environment
    (repo:OWNER/REPO:environment:dev, :environment:prod). That means a workflow
    job can only obtain Azure credentials if GitHub has already satisfied that
    environment's protection rules - so the required reviewers on `prod` are
    enforced by the identity system, not merely by workflow YAML that anyone
    with write access could edit.

.PARAMETER Repository
    Target repository as "owner/repo".

.PARAMETER SubscriptionId
    Azure subscription the workflow will deploy into.

.PARAMETER ResourceGroup
    Resource group to scope the role assignment to. Strongly preferred over
    subscription scope.

.PARAMETER AppName
    Display name for the Entra ID application.

.PARAMETER Environments
    GitHub environment names to federate. Defaults to dev and prod.

.PARAMETER Role
    Azure role to grant. Defaults to Contributor at resource group scope.

.PARAMETER IncludeBranchCredential
    Also federate the default branch (repo:OWNER/REPO:ref:refs/heads/main).
    Only needed for workflows that authenticate to Azure outside an
    environment - for example a release gate job. Off by default.

.EXAMPLE
    ./configure-github-oidc.ps1 -Repository melrasheed/contoso-claims-agentic-sdlc `
        -SubscriptionId 00000000-0000-0000-0000-000000000000 `
        -ResourceGroup rg-agentic-sdlc-dev

.EXAMPLE
    ./configure-github-oidc.ps1 -Repository contoso/claims -SubscriptionId <id> `
        -ResourceGroup rg-claims -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][string]$Repository,
    [Parameter(Mandatory = $true)][string]$SubscriptionId,
    [Parameter(Mandatory = $true)][string]$ResourceGroup,
    [string]$AppName = 'github-actions-agentic-sdlc',
    [string[]]$Environments = @('dev', 'prod'),
    [string]$Role = 'Contributor',
    [switch]$IncludeBranchCredential
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

Write-Host 'GitHub Actions to Azure — OIDC federation' -ForegroundColor White
Write-Host "  Repository     : $Repository"
Write-Host "  Subscription   : $SubscriptionId"
Write-Host "  Resource group : $ResourceGroup"
Write-Host "  Application    : $AppName"
Write-Host "  Environments   : $($Environments -join ', ')"
Write-Host "  Role           : $Role (scoped to the resource group)"

foreach ($tool in @('az', 'gh')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "$tool is required but was not found on PATH."
    }
}

# gh prefers GH_TOKEN from the environment, and that token often has narrower
# scopes than the keyring credential. Clearing it avoids a confusing 403.
$previousToken = $env:GH_TOKEN
$env:GH_TOKEN = $null

try {
    # --- Tenant -----------------------------------------------------------
    Write-Step 'Resolving tenant'
    az account set --subscription $SubscriptionId 2>&1 | Out-Null
    $tenantId = az account show --query tenantId -o tsv
    if (-not $tenantId) { throw "Could not resolve the tenant. Run 'az login'." }
    Write-Host "  Tenant: $tenantId"

    # --- Application ------------------------------------------------------
    Write-Step 'Entra ID application'
    $appId = az ad app list --display-name $AppName --query "[0].appId" -o tsv 2>$null

    if ($appId) {
        Write-Same "application '$AppName' exists (appId $appId)"
    }
    elseif ($PSCmdlet.ShouldProcess($AppName, 'Create Entra ID application')) {
        $appId = az ad app create --display-name $AppName --query appId -o tsv
        Write-Ok "created application '$AppName' (appId $appId)"
    }
    else {
        Write-Warn 'WhatIf: application would be created; cannot continue meaningfully.'
        return
    }

    # --- Service principal -------------------------------------------------
    $spId = az ad sp list --filter "appId eq '$appId'" --query "[0].id" -o tsv 2>$null
    if ($spId) {
        Write-Same "service principal exists ($spId)"
    }
    elseif ($PSCmdlet.ShouldProcess($appId, 'Create service principal')) {
        $spId = az ad sp create --id $appId --query id -o tsv
        Write-Ok "created service principal ($spId)"
        # Entra ID replication is eventually consistent; a role assignment
        # immediately after creation frequently fails with PrincipalNotFound.
        Start-Sleep -Seconds 20
    }

    # --- Federated credentials --------------------------------------------
    Write-Step 'Federated credentials'
    $existing = @()
    $raw = az ad app federated-credential list --id $appId -o json 2>$null
    if ($raw) { $existing = ($raw | ConvertFrom-Json) | ForEach-Object { $_.name } }

    $credentials = @()
    foreach ($envName in $Environments) {
        $credentials += [pscustomobject]@{
            Name    = "github-$envName"
            Subject = "repo:${Repository}:environment:$envName"
            Note    = "GitHub environment '$envName'"
        }
    }
    if ($IncludeBranchCredential) {
        $credentials += [pscustomobject]@{
            Name    = 'github-branch-main'
            Subject = "repo:${Repository}:ref:refs/heads/main"
            Note    = 'default branch (jobs that run outside an environment)'
        }
    }

    foreach ($cred in $credentials) {
        if ($existing -contains $cred.Name) { Write-Same "$($cred.Name)  ->  $($cred.Subject)"; continue }
        if (-not $PSCmdlet.ShouldProcess($cred.Subject, "Create federated credential '$($cred.Name)'")) { continue }

        $body = @{
            name      = $cred.Name
            issuer    = 'https://token.actions.githubusercontent.com'
            subject   = $cred.Subject
            audiences = @('api://AzureADTokenExchange')
            description = $cred.Note
        } | ConvertTo-Json -Depth 5 -Compress

        $tmp = New-TemporaryFile
        try {
            $body | Set-Content -Path $tmp -Encoding utf8
            az ad app federated-credential create --id $appId --parameters "@$tmp" 2>&1 | Out-Null
            Write-Ok "$($cred.Name)  ->  $($cred.Subject)"
        }
        finally { Remove-Item $tmp -ErrorAction SilentlyContinue }
    }

    # --- Role assignment ---------------------------------------------------
    Write-Step 'Azure role assignment'
    $scope = "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup"
    $existingAssignments = az role assignment list --assignee $appId --scope $scope --query "[?roleDefinitionName=='$Role'] | length(@)" -o tsv 2>$null

    if ($existingAssignments -and [int]$existingAssignments -gt 0) {
        Write-Same "$Role already granted at $scope"
    }
    elseif ($PSCmdlet.ShouldProcess($scope, "Grant $Role")) {
        az role assignment create --assignee $appId --role $Role --scope $scope 2>&1 | Out-Null
        Write-Ok "granted $Role at $scope"
    }

    # --- GitHub repository variables ---------------------------------------
    # These are identifiers, not secrets. Storing them as variables rather than
    # secrets keeps workflow logs readable and makes misconfiguration obvious.
    Write-Step 'GitHub repository variables'
    $variables = @{
        AZURE_CLIENT_ID       = $appId
        AZURE_TENANT_ID       = $tenantId
        AZURE_SUBSCRIPTION_ID = $SubscriptionId
    }

    foreach ($name in $variables.Keys) {
        if (-not $PSCmdlet.ShouldProcess("$Repository/$name", 'Set repository variable')) { continue }
        gh variable set $name --repo $Repository --body $variables[$name] 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { Write-Ok "$name" } else { Write-Warn "could not set $name" }
    }

    # --- Summary -----------------------------------------------------------
    Write-Step 'Done'
    Write-Host '  Workflows can now authenticate with:' -ForegroundColor White
    Write-Host @'
      - uses: azure/login@v2
        with:
          client-id: ${{ vars.AZURE_CLIENT_ID }}
          tenant-id: ${{ vars.AZURE_TENANT_ID }}
          subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}
'@
    Write-Host '  The job must also declare:' -ForegroundColor White
    Write-Host '      permissions:'
    Write-Host '        id-token: write'
    Write-Host ''
    Write-Warn 'A job federated to an environment must declare that environment, or the'
    Write-Warn 'subject will not match and azure/login will fail with AADSTS70021.'
}
finally {
    $env:GH_TOKEN = $previousToken
}
