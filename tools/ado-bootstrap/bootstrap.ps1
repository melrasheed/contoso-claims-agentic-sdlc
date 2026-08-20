<#
.SYNOPSIS
    Scaffolds an Azure DevOps project for the Agentic SDLC Accelerator.

.DESCRIPTION
    Creates the area paths, iterations, tags, saved queries and a sample backlog
    that the agentic lifecycle depends on. Safe to re-run: every operation is
    idempotent and reports whether it created or found each object.

    Authentication uses the Azure CLI (`az login`) by default, which means no
    PAT has to be stored anywhere. Supply -Pat only if you cannot use Entra ID.

.PARAMETER Organization
    Azure DevOps organisation name, e.g. "contoso" (not the full URL).

.PARAMETER Project
    Azure DevOps project name, e.g. "Agentic SDLC".

.PARAMETER Pat
    Optional personal access token. Prefer Entra ID via `az login`.

.PARAMETER SkipSampleBacklog
    Create the structure but not the demo Epic/Feature/PBI/Bug items.

.PARAMETER WhatIf
    Show what would be created without changing anything.

.EXAMPLE
    ./bootstrap.ps1 -Organization contoso -Project "Agentic SDLC"

.EXAMPLE
    ./bootstrap.ps1 -Organization contoso -Project "Agentic SDLC" -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)][string]$Organization,
    [Parameter(Mandatory = $true)][string]$Project,
    [string]$Pat,
    [switch]$SkipSampleBacklog
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'ProcessMap.psm1') -Force

# Well-known Azure DevOps application ID used to request an Entra token.
# This is a public constant, not a secret.
$script:AdoResourceId = '499b84ac-1321-427f-aa17-267ca6975798'
$script:ApiVersion    = '7.1'
$script:OrgUrl        = "https://dev.azure.com/$Organization"
$script:ProjectUrl    = "$script:OrgUrl/$([uri]::EscapeDataString($Project))"
$script:Created       = 0
$script:Existing      = 0
$script:Map           = $null

function Write-Step   { param([string]$Message) Write-Host "`n=== $Message ===" -ForegroundColor Cyan }
function Write-Created{ param([string]$Message) $script:Created++;  Write-Host "  + $Message" -ForegroundColor Green }
function Write-Exists { param([string]$Message) $script:Existing++; Write-Host "  = $Message" -ForegroundColor DarkGray }
function Write-Warn   { param([string]$Message) Write-Host "  ! $Message" -ForegroundColor Yellow }

function Get-AuthHeader {
    if ($Pat) {
        $bytes = [Text.Encoding]::ASCII.GetBytes(":$Pat")
        return @{ Authorization = "Basic $([Convert]::ToBase64String($bytes))" }
    }

    $token = az account get-access-token --resource $script:AdoResourceId --query accessToken -o tsv 2>$null
    if (-not $token) {
        throw "Could not acquire an Azure DevOps token. Run 'az login', or pass -Pat."
    }
    return @{ Authorization = "Bearer $token" }
}

function Invoke-Ado {
    param(
        [Parameter(Mandatory)][string]$Uri,
        [string]$Method = 'GET',
        $Body,
        [string]$ContentType = 'application/json',
        [switch]$AllowNotFound
    )

    $headers = Get-AuthHeader
    $params = @{ Uri = $Uri; Method = $Method; Headers = $headers; ErrorAction = 'Stop' }
    if ($null -ne $Body) {
        $params.Body        = if ($Body -is [string]) { $Body } else { $Body | ConvertTo-Json -Depth 12 -Compress }
        $params.ContentType = $ContentType
    }

    try {
        return Invoke-RestMethod @params
    }
    catch {
        $status = $null
        if ($_.Exception.PSObject.Properties.Name -contains 'Response' -and $_.Exception.Response) {
            $status = [int]$_.Exception.Response.StatusCode
        }
        if ($AllowNotFound -and $status -eq 404) { return $null }
        throw
    }
}

# ---------------------------------------------------------------------------
# Classification nodes (area paths and iterations)
# ---------------------------------------------------------------------------

function New-ClassificationNode {
    param(
        [Parameter(Mandatory)][ValidateSet('areas', 'iterations')][string]$Structure,
        [Parameter(Mandatory)][string]$Name,
        [hashtable]$Attributes
    )

    $encoded = [uri]::EscapeDataString($Name)
    $existing = Invoke-Ado -Uri "$script:ProjectUrl/_apis/wit/classificationnodes/$Structure/$encoded`?api-version=$script:ApiVersion" -AllowNotFound
    if ($existing) { Write-Exists "$Structure/$Name"; return $existing }

    if (-not $PSCmdlet.ShouldProcess("$Structure/$Name", 'Create classification node')) { return $null }

    $body = @{ name = $Name }
    if ($Attributes) { $body.attributes = $Attributes }

    $node = Invoke-Ado -Uri "$script:ProjectUrl/_apis/wit/classificationnodes/$Structure`?api-version=$script:ApiVersion" -Method POST -Body $body
    Write-Created "$Structure/$Name"
    return $node
}

# ---------------------------------------------------------------------------
# Work items
# ---------------------------------------------------------------------------

function Find-WorkItemByTitle {
    param([Parameter(Mandatory)][string]$Title)

    $escaped = $Title.Replace("'", "''")
    $wiql = @{ query = "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '$($Project.Replace("'","''"))' AND [System.Title] = '$escaped'" }
    $result = Invoke-Ado -Uri "$script:ProjectUrl/_apis/wit/wiql?api-version=$script:ApiVersion" -Method POST -Body $wiql
    if ($result.workItems -and $result.workItems.Count -gt 0) { return $result.workItems[0].id }
    return $null
}

function New-AdoWorkItem {
    param(
        [Parameter(Mandatory)][string]$Type,
        [Parameter(Mandatory)][string]$Title,
        [string]$Description,
        [string]$AcceptanceCriteria,
        [string]$ReproSteps,
        [string]$Tags,
        [int]$ParentId,
        [string]$AreaPath,
        [string]$IterationPath
    )

    $existingId = Find-WorkItemByTitle -Title $Title
    if ($existingId) { Write-Exists "$Type '$Title' (#$existingId)"; return $existingId }

    if (-not $PSCmdlet.ShouldProcess("$Type '$Title'", 'Create work item')) { return $null }

    $ops = @(
        @{ op = 'add'; path = '/fields/System.Title'; value = $Title }
    )
    if ($Description)        { $ops += @{ op = 'add'; path = '/fields/System.Description'; value = $Description } }
    # Field reference names differ per process, and some processes lack these
    # fields entirely. The caller passes the mapped name, or $null to skip.
    if ($AcceptanceCriteria -and $script:Map.AcceptanceCriteria) {
        $ops += @{ op = 'add'; path = "/fields/$($script:Map.AcceptanceCriteria)"; value = $AcceptanceCriteria }
    }
    elseif ($AcceptanceCriteria) {
        # No acceptance criteria field in this process - fold it into the
        # description so the information is not lost and the bridge still
        # forwards it to the coding agent.
        $existingDescription = ($ops | Where-Object { $_.path -eq '/fields/System.Description' })
        $merged = "$Description<div><br></div><div><b>Acceptance criteria</b></div>$AcceptanceCriteria"
        if ($existingDescription) { $existingDescription.value = $merged }
        else { $ops += @{ op = 'add'; path = '/fields/System.Description'; value = $merged } }
    }
    if ($ReproSteps -and $script:Map.ReproSteps) {
        $ops += @{ op = 'add'; path = "/fields/$($script:Map.ReproSteps)"; value = $ReproSteps }
    }
    elseif ($ReproSteps) {
        $ops += @{ op = 'add'; path = '/fields/System.Description'; value = "<div><b>Repro steps</b></div>$ReproSteps" }
    }
    if ($Tags)               { $ops += @{ op = 'add'; path = '/fields/System.Tags'; value = $Tags } }
    if ($AreaPath)           { $ops += @{ op = 'add'; path = '/fields/System.AreaPath'; value = $AreaPath } }
    if ($IterationPath)      { $ops += @{ op = 'add'; path = '/fields/System.IterationPath'; value = $IterationPath } }
    if ($ParentId) {
        $ops += @{
            op    = 'add'
            path  = '/relations/-'
            value = @{ rel = 'System.LinkTypes.Hierarchy-Reverse'; url = "$script:OrgUrl/_apis/wit/workItems/$ParentId" }
        }
    }

    $encodedType = [uri]::EscapeDataString($Type)
    $item = Invoke-Ado -Uri "$script:ProjectUrl/_apis/wit/workitems/`$$encodedType`?api-version=$script:ApiVersion" `
                       -Method POST -Body $ops -ContentType 'application/json-patch+json'
    Write-Created "$Type '$Title' (#$($item.id))"
    return $item.id
}

# ---------------------------------------------------------------------------
# Saved queries
# ---------------------------------------------------------------------------

function New-SharedQuery {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Wiql,
        [string]$FolderPath = 'Shared Queries'
    )

    $encodedPath = ($FolderPath -split '/' | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/'
    $queryUri = "$script:ProjectUrl/_apis/wit/queries/$encodedPath/$([uri]::EscapeDataString($Name))"
    $existing = Invoke-Ado -Uri "$queryUri`?`$expand=wiql&api-version=$script:ApiVersion" -AllowNotFound

    if ($existing) {
        # Idempotency must not mean "leave a broken query in place". A gate query
        # written for the wrong process silently matches nothing - and a query
        # that matches nothing is a gate that always passes, which is
        # indistinguishable from a healthy system. So compare and repair.
        $normalise = { param($s) ($s -replace '\s+', ' ').Trim().ToLowerInvariant() }
        $currentWiql = if ($existing.PSObject.Properties.Name -contains 'wiql') { $existing.wiql } else { '' }

        if ((& $normalise $currentWiql) -eq (& $normalise $Wiql)) {
            Write-Exists "query '$Name'"
            return $existing
        }

        if (-not $PSCmdlet.ShouldProcess("query '$Name'", 'Update stale query definition')) { return $existing }

        try {
            $updated = Invoke-Ado -Uri "$queryUri`?api-version=$script:ApiVersion" -Method PATCH -Body @{ wiql = $Wiql }
            Write-Created "query '$Name' (updated - the stored definition did not match this project's process)"
            return $updated
        }
        catch {
            Write-Warn "Could not update query '$Name': $($_.Exception.Message)"
            Write-Warn "The stored query may not match this project's process. Verify it returns the rows you expect."
            return $existing
        }
    }

    if (-not $PSCmdlet.ShouldProcess("query '$Name'", 'Create shared query')) { return $null }

    $body = @{ name = $Name; wiql = $Wiql; isFolder = $false }
    try {
        $query = Invoke-Ado -Uri "$script:ProjectUrl/_apis/wit/queries/$encodedPath`?api-version=$script:ApiVersion" -Method POST -Body $body
        Write-Created "query '$Name'"
        return $query
    }
    catch {
        Write-Warn "Could not create query '$Name': $($_.Exception.Message)"
        return $null
    }
}

# ===========================================================================
# Main
# ===========================================================================

Write-Host "Agentic SDLC - Azure DevOps bootstrap" -ForegroundColor White
Write-Host "  Organisation : $Organization"
Write-Host "  Project      : $Project"
Write-Host "  Auth         : $(if ($Pat) { 'PAT' } else { 'Entra ID (az login)' })"
if ($WhatIfPreference) { Write-Host "  Mode         : WHAT-IF (no changes)" -ForegroundColor Yellow }

Write-Step 'Verifying project access'
$projectInfo = Invoke-Ado -Uri "$script:OrgUrl/_apis/projects/$([uri]::EscapeDataString($Project))?api-version=$script:ApiVersion"
Write-Host "  Project id : $($projectInfo.id)"

# The authoritative process name comes from capabilities, NOT from the
# System.Process Template property - that property is unreliable and can report
# a completely different process. See ProcessMap.psm1 and docs/07-troubleshooting.md.
$processName = Get-ActualProcessName -OrgUrl $script:OrgUrl -ProjectNameOrId $Project -AuthHeader (Get-AuthHeader)
$script:Map  = Get-ProcessMap -ProcessName $processName

$legacyProperty = $null
try {
    $props = Invoke-Ado -Uri "$script:OrgUrl/_apis/projects/$($projectInfo.id)/properties?api-version=7.1-preview.1"
    $legacyProperty = ($props.value | Where-Object { $_.name -eq 'System.Process Template' }).value
} catch { }

Write-Host "  Process    : $processName  (authoritative)"
if ($legacyProperty -and $legacyProperty -ne $processName) {
    Write-Warn "The legacy 'System.Process Template' property reports '$legacyProperty', which disagrees with the real process '$processName'."
    Write-Warn "This is a known Azure DevOps quirk. Trusting capabilities.processTemplate."
}

$availableTypes = Get-AvailableWorkItemTypes -ProjectUrl $script:ProjectUrl -AuthHeader (Get-AuthHeader)
Write-Host "  Types      : $($availableTypes -join ', ')"

if ($processName -eq 'Basic') {
    Write-Warn "This project uses the Basic process, which has no Feature type, no Bug type,"
    Write-Warn "and no acceptance criteria / repro steps / severity fields."
    Write-Warn "The bootstrap will adapt, but for the full demo consider changing the process to"
    Write-Warn "Agile or Scrum: Organization settings > Boards > Process > (target) > Change team projects."
}

# --- Area paths ------------------------------------------------------------
Write-Step 'Creating area paths'
foreach ($area in @('Claims API', 'Claims Web', 'Platform', 'Security')) {
    New-ClassificationNode -Structure 'areas' -Name $area | Out-Null
}

# --- Iterations ------------------------------------------------------------
Write-Step 'Creating iterations'
$sprintStart = (Get-Date).Date
foreach ($i in 1..3) {
    $start  = $sprintStart.AddDays(14 * ($i - 1))
    $finish = $start.AddDays(13)
    New-ClassificationNode -Structure 'iterations' -Name "Sprint $i" -Attributes @{
        startDate  = $start.ToString('yyyy-MM-ddTHH:mm:ssZ')
        finishDate = $finish.ToString('yyyy-MM-ddTHH:mm:ssZ')
    } | Out-Null
}

# --- Shared queries --------------------------------------------------------
Write-Step 'Creating shared queries'
$p = $Project.Replace("'", "''")

New-SharedQuery -Name 'AI Ready - awaiting bridge' -Wiql @"
SELECT [System.Id], [System.WorkItemType], [System.Title], [System.State], [System.Tags]
FROM WorkItems
WHERE [System.TeamProject] = '$p'
  AND [System.Tags] CONTAINS 'ai-ready'
  AND NOT [System.Tags] CONTAINS 'synced-to-github'
  AND [System.State] <> 'Removed'
ORDER BY [System.ChangedDate] DESC
"@ | Out-Null

New-SharedQuery -Name 'AI In Progress - implementing' -Wiql @"
SELECT [System.Id], [System.WorkItemType], [System.Title], [System.State], [System.Tags]
FROM WorkItems
WHERE [System.TeamProject] = '$p'
  AND [System.Tags] CONTAINS 'ai-implementing'
  AND [System.State] <> 'Done'
  AND [System.State] <> 'Removed'
ORDER BY [System.ChangedDate] DESC
"@ | Out-Null

# This query backs the prod release gate. If it returns anything, prod is blocked.
# On Basic there is no Bug type and no Severity field, so the gate falls back to
# tagged issues instead - the gate still works, it just uses a different signal.
$gateWiql = if ($script:Map.Bug -eq 'Issue' -or -not $script:Map.Severity) {
@"
SELECT [System.Id], [System.Title], [System.State]
FROM WorkItems
WHERE [System.TeamProject] = '$p'
  AND [System.Tags] CONTAINS 'sev1'
  AND [System.State] <> '$($script:Map.StateDone)'
  AND [System.State] <> 'Removed'
"@
} else {
@"
SELECT [System.Id], [System.Title], [System.State], [$($script:Map.Severity)]
FROM WorkItems
WHERE [System.TeamProject] = '$p'
  AND [System.WorkItemType] = '$($script:Map.Bug)'
  AND [System.State] <> '$($script:Map.StateDone)'
  AND [System.State] <> 'Removed'
  AND (
        [$($script:Map.Severity)] = '$($script:Map.SeverityCritical)'
     OR [$($script:Map.Severity)] = '$($script:Map.SeverityHigh)'
  )
ORDER BY [$($script:Map.Severity)] ASC
"@
}
New-SharedQuery -Name 'Release Gate - active Sev1 Sev2 bugs' -Wiql $gateWiql | Out-Null

New-SharedQuery -Name 'SRE - incidents raised by agent' -Wiql @"
SELECT [System.Id], [System.Title], [System.State], [Microsoft.VSTS.Common.Severity], [System.CreatedDate]
FROM WorkItems
WHERE [System.TeamProject] = '$p'
  AND [System.Tags] CONTAINS 'sre-agent'
ORDER BY [System.CreatedDate] DESC
"@ | Out-Null

# --- Sample backlog --------------------------------------------------------
if (-not $SkipSampleBacklog) {
    Write-Step 'Creating the sample backlog'

    $epicId = New-AdoWorkItem -Type $script:Map.Portfolio `
        -Title 'Contoso Claims - straight-through claims processing' `
        -Description '<div>Enable Contoso to receive, risk-score and adjudicate insurance claims with minimal manual handling, while keeping a complete audit trail of every decision.</div>' `
        -Tags 'demo' -AreaPath $Project

    # Basic has no mid-level type, so requirements hang directly off the Epic.
    $parentForStories = $epicId
    if ($script:Map.Feature) {
        $parentForStories = New-AdoWorkItem -Type $script:Map.Feature `
            -Title 'High-value claim controls' `
            -Description '<div>Additional controls for claims above the automatic approval threshold, so that large payouts always receive human scrutiny.</div>' `
            -Tags 'demo' -ParentId $epicId -AreaPath "$Project\Claims API"
    }
    else {
        Write-Warn "Process '$processName' has no mid-level type; requirements will hang directly off the Epic."
    }

    # This is the item the live demo sends to the Copilot coding agent.
    New-AdoWorkItem -Type $script:Map.Requirement `
        -Title 'Require dual approval for claims above 50,000' `
        -Description '<div>Claims requesting more than 50,000 currently follow the same single-approver path as small claims. This is the largest financial exposure in the product and the main audit finding from the last review.</div><div><br></div><div>As a claims supervisor, I want high-value claims to require a second, different approver, so that no single person can authorise a large payout.</div>' `
        -AcceptanceCriteria @'
<div><b>AC1 - Second approver required above threshold</b><br>
Given a claim with amountRequested greater than 50000<br>
When a first approver adjudicates it as approved<br>
Then the claim moves to a pending_second_approval state rather than approved</div>
<div><br></div>
<div><b>AC2 - Second approver must be a different person</b><br>
Given a claim awaiting second approval<br>
When the same user who gave the first approval attempts the second<br>
Then the request is rejected with HTTP 403 and the claim state is unchanged</div>
<div><br></div>
<div><b>AC3 - Threshold is configurable</b><br>
Given the dual approval threshold is configuration-driven<br>
When the threshold is changed<br>
Then the new value applies without a code change</div>
<div><br></div>
<div><b>AC4 - Below threshold is unaffected</b><br>
Given a claim with amountRequested of 50000 or less<br>
When it is approved by one approver<br>
Then it moves directly to approved, exactly as today</div>
<div><br></div>
<div><b>AC5 - Decisions are auditable</b><br>
Given any adjudication decision<br>
When it is recorded<br>
Then it captures who decided, when, and the rationale, and this record cannot be silently overwritten</div>
<div><br></div>
<div><b>AC6 - Sensitive data is not leaked</b><br>
Given any log or telemetry emitted on this path<br>
Then it contains no claimantName and no policyNumber</div>
'@ `
        -Tags 'demo; ai-ready' -ParentId $parentForStories -AreaPath "$Project\Claims API" | Out-Null

    New-AdoWorkItem -Type $script:Map.Requirement `
        -Title 'Show risk score banding on the claims list' `
        -Description '<div>Adjusters cannot currently triage the queue at a glance because the risk score is only visible on the detail view.</div><div><br></div><div>As a claims adjuster, I want to see risk banding directly in the list, so that I can prioritise the riskiest claims first.</div>' `
        -AcceptanceCriteria @'
<div><b>AC1 - Banding is visible in the list</b><br>
Given the claims list is displayed<br>
Then each row shows a risk band of Low, Medium or High</div>
<div><br></div>
<div><b>AC2 - Bands match the scoring thresholds</b><br>
Given a claim risk score<br>
Then scores below 34 show Low, 34 to 66 show Medium, and above 66 show High</div>
<div><br></div>
<div><b>AC3 - Accessible, not colour-only</b><br>
Given a user who cannot distinguish colours<br>
Then the band is also conveyed by text, so colour is not the only signal</div>
'@ `
        -Tags 'demo; ai-ready' -ParentId $parentForStories -AreaPath "$Project\Claims Web" | Out-Null

    # On Basic this becomes an Issue tagged 'bug' plus 'sev1', because Basic has
    # neither a Bug type nor a Severity field. The release gate query adapts too.
    $bugTags = if ($script:Map.Bug -eq 'Issue') { 'demo; bug; sev1' } else { 'demo' }
    New-AdoWorkItem -Type $script:Map.Bug `
        -Title 'Adjudicating an already-paid claim returns 200 instead of 409' `
        -ReproSteps @'
<div><b>Steps</b></div>
<div>1. Create a claim and adjudicate it as approved<br>
2. Move the claim to the paid state<br>
3. POST to /api/claims/{id}/adjudicate a second time</div>
<div><br></div>
<div><b>Expected:</b> HTTP 409 Conflict, claim unchanged</div>
<div><b>Actual:</b> HTTP 200, the adjudication record is overwritten</div>
<div><br></div>
<div><b>Why this matters:</b> this is a double-payment path and a fraud risk, not merely a status code defect.</div>
'@ `
        -Tags $bugTags -ParentId $parentForStories -AreaPath "$Project\Claims API" | Out-Null
}

# --- Summary ---------------------------------------------------------------
Write-Step 'Summary'
Write-Host "  Created : $script:Created" -ForegroundColor Green
Write-Host "  Existing: $script:Existing" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Connect Azure Boards to the GitHub repository (Project settings > GitHub connections)"
Write-Host "  2. Run the bridge:  npm run start --workspace @contoso/ado-github-bridge -- sync --dry-run"
Write-Host "  3. Add the 'Release Gate - active Sev1 Sev2 bugs' query as a check on the prod environment"
Write-Host ""
