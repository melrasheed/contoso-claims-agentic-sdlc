Set-StrictMode -Version Latest

<#
.SYNOPSIS
    Process-aware mapping for Azure DevOps work item types, fields and states.

.DESCRIPTION
    Azure DevOps ships four system processes - Basic, Agile, Scrum and CMMI -
    and they do NOT share work item type names, field reference names, or
    states. A script that hardcodes "Product Backlog Item" works on Scrum and
    fails everywhere else.

    Two traps this module exists to avoid:

    1. The project property `System.Process Template` is NOT reliable. A Basic
       project can report "Scrum" there. The authoritative source is
       `capabilities.processTemplate.templateName`, which requires the project
       to be fetched with `includeCapabilities=true`.

    2. The **Basic** process has no `Feature`, no `Bug`, and no acceptance
       criteria, repro steps or severity fields. Anything written for Scrum or
       Agile will fail against it. Basic models everything as `Issue`.
#>

$script:ProcessMap = @{
    'Basic' = @{
        Portfolio          = 'Epic'
        Feature            = $null          # Basic has no mid-level type
        Requirement        = 'Issue'
        Bug                = 'Issue'        # Basic has no Bug type
        Task               = 'Task'
        AcceptanceCriteria = $null          # field does not exist
        ReproSteps         = $null
        Severity           = $null
        StateNew           = 'To Do'
        StateActive        = 'Doing'
        StateDone          = 'Done'
        SeverityHigh       = $null
        SeverityCritical   = $null
    }
    'Agile' = @{
        Portfolio          = 'Epic'
        Feature            = 'Feature'
        Requirement        = 'User Story'
        Bug                = 'Bug'
        Task               = 'Task'
        AcceptanceCriteria = 'Microsoft.VSTS.Common.AcceptanceCriteria'
        ReproSteps         = 'Microsoft.VSTS.TCM.ReproSteps'
        Severity           = 'Microsoft.VSTS.Common.Severity'
        StateNew           = 'New'
        StateActive        = 'Active'
        StateDone          = 'Closed'
        SeverityHigh       = '2 - High'
        SeverityCritical   = '1 - Critical'
    }
    'Scrum' = @{
        Portfolio          = 'Epic'
        Feature            = 'Feature'
        Requirement        = 'Product Backlog Item'
        Bug                = 'Bug'
        Task               = 'Task'
        AcceptanceCriteria = 'Microsoft.VSTS.Common.AcceptanceCriteria'
        ReproSteps         = 'Microsoft.VSTS.TCM.ReproSteps'
        Severity           = 'Microsoft.VSTS.Common.Severity'
        StateNew           = 'New'
        StateActive        = 'Committed'
        StateDone          = 'Done'
        SeverityHigh       = '2 - High'
        SeverityCritical   = '1 - Critical'
    }
    'CMMI' = @{
        Portfolio          = 'Epic'
        Feature            = 'Feature'
        Requirement        = 'Requirement'
        Bug                = 'Bug'
        Task               = 'Task'
        AcceptanceCriteria = 'Microsoft.VSTS.Common.AcceptanceCriteria'
        ReproSteps         = 'Microsoft.VSTS.TCM.ReproSteps'
        Severity           = 'Microsoft.VSTS.Common.Severity'
        StateNew           = 'Proposed'
        StateActive        = 'Active'
        StateDone          = 'Closed'
        SeverityHigh       = '2 - High'
        SeverityCritical   = '1 - Critical'
    }
}

function Get-ProcessMap {
    <#
    .SYNOPSIS
        Returns the type/field/state map for a named process.
    .PARAMETER ProcessName
        Basic, Agile, Scrum or CMMI. Inherited processes are matched by their
        parent name when possible, otherwise Agile is used as the closest fit.
    #>
    param([Parameter(Mandatory)][string]$ProcessName)

    if ($script:ProcessMap.ContainsKey($ProcessName)) {
        return $script:ProcessMap[$ProcessName]
    }

    # Inherited processes are usually named after their parent, e.g. "Contoso Agile".
    foreach ($known in @('Scrum', 'Agile', 'CMMI', 'Basic')) {
        if ($ProcessName -match $known) {
            Write-Warning "Process '$ProcessName' appears to inherit from $known; using the $known mapping."
            return $script:ProcessMap[$known]
        }
    }

    Write-Warning "Unrecognised process '$ProcessName'. Falling back to the Agile mapping - verify the results."
    return $script:ProcessMap['Agile']
}

function Get-ActualProcessName {
    <#
    .SYNOPSIS
        Returns the true process name for a project.
    .DESCRIPTION
        Reads `capabilities.processTemplate.templateName`, which is
        authoritative. Deliberately does NOT use the `System.Process Template`
        project property, which can report a different process entirely.
    #>
    param(
        [Parameter(Mandatory)][string]$OrgUrl,
        [Parameter(Mandatory)][string]$ProjectNameOrId,
        [Parameter(Mandatory)][hashtable]$AuthHeader
    )

    $uri = "$OrgUrl/_apis/projects/$([uri]::EscapeDataString($ProjectNameOrId))?includeCapabilities=true&api-version=7.1"
    $raw = Invoke-WebRequest -Uri $uri -Headers $AuthHeader -ErrorAction Stop
    # -AsHashtable because Azure DevOps responses can contain an empty-string
    # property name, which ConvertFrom-Json rejects without it.
    $project = $raw.Content | ConvertFrom-Json -AsHashtable

    if ($project.capabilities -and $project.capabilities.processTemplate) {
        return $project.capabilities.processTemplate.templateName
    }

    throw "Could not determine the process template for '$ProjectNameOrId'."
}

function Get-AvailableWorkItemTypes {
    <#
    .SYNOPSIS
        Lists the work item type names that actually exist in a project.
    #>
    param(
        [Parameter(Mandatory)][string]$ProjectUrl,
        [Parameter(Mandatory)][hashtable]$AuthHeader
    )

    $raw = Invoke-WebRequest -Uri "$ProjectUrl/_apis/wit/workitemtypes?api-version=7.1" -Headers $AuthHeader -ErrorAction Stop
    $parsed = $raw.Content | ConvertFrom-Json -AsHashtable
    return @($parsed.value | ForEach-Object { $_.name })
}

Export-ModuleMember -Function Get-ProcessMap, Get-ActualProcessName, Get-AvailableWorkItemTypes
