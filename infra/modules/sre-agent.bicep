// =============================================================================
// sre-agent.bicep — Azure SRE Agent + connectors + RBAC
// API version: 2025-05-01-preview
//
// ─── SCHEMA NOTES (verified against official microsoft/sre-agent repo) ──────
//
// API version used: 2025-05-01-preview (not 2026-01-01 GA).
//   Reason: the GA (2026-01-01) spec is missing the working properties
//   `monthlyAgentUnitLimit`, `experimentalSettings`, and `sandboxConfiguration`
//   that the official microsoft/sre-agent templates rely on. This module
//   tracks the same version as the official recipe templates so it stays
//   compatible with Microsoft's own tooling.
//   When 2026-01-01 gains these properties, update the apiVersion and remove
//   the #disable-next-line BCP081 suppressions.
//
// actionMode values: 'Review' | 'Automatic' (2025-05-01-preview API)
//   Note: The 2026-01-01 GA docs show 'Review' | 'Autonomous'. The working
//   preview API uses 'Automatic'. Parameter @allowed reflects the preview values.
//
// Connector child resource: Microsoft.App/agents/connectors (NOT dataConnectors)
//   The resource name in Microsoft's own IaC templates is `connectors`, not
//   `dataConnectors` as described in secondary sources.
//
// IDENTITY REQUIREMENT (verified against official bicep/agent-core.bicep):
//   The agent MUST use 'SystemAssigned, UserAssigned' combined identity.
//   knowledgeGraphConfiguration.identity and actionConfiguration.identity MUST
//   be set to the user-assigned managed identity resource ID — NOT '' and NOT omitted.
//   Passing '' causes: InvalidIdentity: The identity value '' of
//   'KnowledgeGraphConfiguration' is invalid: the referenced managed identity
//   must be set in the agent.
//
// ─── CONNECTOR-CLOBBERING HAZARD (github.com/microsoft/sre-agent issue #30) ─
//
// PROBLEM: Redeploying the parent `Microsoft.App/agents` resource can DELETE
// existing connector children, because ARM performs a full PUT on the parent
// which may reconcile child state to "nothing" if the connectors are not
// explicitly re-listed in the same deployment.
//
// MITIGATION APPLIED HERE:
//   1. Connectors are declared using an `existing` reference to the parent so
//      they do NOT trigger a re-PUT of the agent on incremental deploys.
//   2. Each connector declares `dependsOn: [sreAgent]` to ensure create-order
//      is correct on first deploy only.
//   3. The second connector depends on the first for serial (not parallel) PUT.
//   4. On subsequent infra-only redeployments (no agent changes), set
//      `skipRoleAssignments=true` to minimise what ARM touches.
//   5. Never redeploy this module while connectors are being modified in the
//      portal — the ARM PUT may race with portal writes.
//
// ─── GITHUB / AZURE DEVOPS CONNECTORS ────────────────────────────────────────
//
// GitHub and ADO connectors CANNOT be expressed in Bicep ARM. They require
// OAuth tokens / PATs provisioned through the SRE Agent data-plane API
// (the apply-extras.sh script in microsoft/sre-agent). They are NOT ARM
// sub-resources — the resource provider does not expose them via ARM today.
// See infra/sre-agent-README.md §Connectors for the full setup instructions.
//
// =============================================================================

@description('Resource name of the SRE Agent (matches pattern ^[A-Za-z]([-A-Za-z0-9]{0,30}[A-Za-z0-9])$).')
param agentName string

@description('Azure region.')
param location string

@description('Name prefix (informational — passed for naming consistency with other modules).')
#disable-next-line no-unused-params
param namePrefix string

@description('Environment name (informational — passed for naming consistency).')
#disable-next-line no-unused-params
param environmentName string

@description('Tags applied to the agent resource.')
param tags object

@description('Target resource group name that the agent monitors.')
param targetResourceGroup string

@description('Subscription ID that contains the target resource group.')
param subscriptionId string

// ── User-Assigned Managed Identity ──
// Must be pre-created (from identity.bicep). The agent uses this UAMI for
// knowledgeGraphConfiguration and actionConfiguration identity binding.
@description('ARM resource ID of the user-assigned managed identity for the agent.')
param managedIdentityId string

@description('Principal ID of the user-assigned managed identity.')
param managedIdentityPrincipalId string

// ── App Insights / Log Analytics ──
@description('App Insights Application ID GUID (properties.AppId — the GUID shown under Overview in the portal, used for KQL queries).')
param appInsightsAppId string

@description('App Insights ARM resource ID.')
param appInsightsResourceId string

@secure()
@description('App Insights connection string (sensitive).')
param appInsightsConnectionString string

@description('Log Analytics workspace ARM resource ID.')
param lawResourceId string

// ── Access / mode ──
@allowed(['Low', 'High'])
@description('Access level. Low = Reader + Log Analytics Reader (safe demo default). High adds Contributor on the target RG.')
param accessLevel string = 'Low'

@allowed(['Review', 'Automatic'])
@description('''
Agent action mode.
  Review    — every action requires human approval in the portal. SAFE DEFAULT for demos.
  Automatic — agent executes autonomously without per-action approval.
  ⚠ WARNING: In Automatic mode, tools with "Ask" permission in the per-tool
  Parameter Policy will EXECUTE WITHOUT human approval. This is a genuine
  security and blast-radius risk. Do NOT set Automatic until every tool's
  policy has been reviewed and explicitly configured in the SRE Agent portal.
''')
param sreAgentMode string = 'Review'

@description('Monthly agent unit budget cap. Bills per consumed token — use this guard to cap demo costs.')
param monthlyAgentUnitLimit int = 10000

@allowed(['Stable', 'Preview'])
param upgradeChannel string = 'Preview'

@description('Default AI model provider.')
param defaultModelProvider string = 'MicrosoftFoundry'

@description('Skip RBAC role assignments (use on re-deploy to avoid RoleAssignmentExists errors).')
param skipRoleAssignments bool = false

@description('Object ID of the user or service principal running this deployment. If provided, grants SRE Agent Administrator on the agent so the deployer can open it in https://sre.azure.com. Leave empty to skip.')
param deployerObjectId string = ''

// ──────────────────────────────────────────────────────────────────────────────
// SRE Agent
// BCP081 suppressed: 2025-05-01-preview type definitions not in the local
// Bicep type cache. ARM will still validate on deploy.
// ──────────────────────────────────────────────────────────────────────────────
#disable-next-line BCP081
resource sreAgent 'Microsoft.App/agents@2025-05-01-preview' = {
  name: agentName
  location: location
  tags: tags
  identity: {
    // SystemAssigned + UserAssigned required. The UAMI is used as the
    // actionConfiguration and knowledgeGraphConfiguration identity binding.
    type: 'SystemAssigned, UserAssigned'
    userAssignedIdentities: { '${managedIdentityId}': {} }
  }
  properties: {
    knowledgeGraphConfiguration: {
      // identity MUST be the UAMI resource ID — '' or omission causes InvalidIdentity error.
      identity: managedIdentityId
      // Scope the agent to ONLY the demo workload RG — not the agent's own RG.
      managedResources: [
        subscriptionResourceId(subscriptionId, 'Microsoft.Resources/resourceGroups', targetResourceGroup)
      ]
    }
    actionConfiguration: {
      accessLevel: accessLevel
      // identity MUST be the UAMI resource ID (not '' and not omitted).
      identity: managedIdentityId
      mode: sreAgentMode
    }
    logConfiguration: {
      applicationInsightsConfiguration: {
        appId: appInsightsAppId
        connectionString: appInsightsConnectionString
      }
    }
    upgradeChannel: upgradeChannel
    monthlyAgentUnitLimit: monthlyAgentUnitLimit
    defaultModel: {
      provider: defaultModelProvider
      name: 'Automatic'
    }
    experimentalSettings: {
      EnableWorkspaceTools: true
      EnableHttpTriggers: true
      EnableV2AgentLoop: true
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// RBAC Role Assignments
//
// On TARGET resource group (both UAMI and system-assigned MI):
//   Reader                (acdd72a7) — enumerate/describe resources
//   Log Analytics Reader  (73c42c96) — run KQL queries
//   Contributor           (b24988ac) — High only: apply remediations
//
// On THIS (agent) resource group:
//   Monitoring Reader (43d0d8ad) — read metrics / alert rules / action groups
//     granted to UAMI principal
//
// On the agent resource:
//   SRE Agent Administrator (e79298df) — deployer gets portal + data-plane access
//   SRE Agent Administrator (e79298df) — UAMI (needed for Logic App webhook bridge)
// ──────────────────────────────────────────────────────────────────────────────

// UAMI roles on target RG (for knowledge graph and action execution)
module readerOnTargetRg 'rbac-target.bicep' = if (!skipRoleAssignments) {
  name: 'rbac-target-${uniqueString(deployment().name)}'
  scope: resourceGroup(subscriptionId, targetResourceGroup)
  params: {
    principalId: managedIdentityPrincipalId
    accessLevel: accessLevel
  }
}

// System-assigned MI roles on target RG (for connector KQL queries)
module readerOnTargetRgSmi 'rbac-target.bicep' = if (!skipRoleAssignments) {
  name: 'rbac-target-smi-${uniqueString(deployment().name)}'
  scope: resourceGroup(subscriptionId, targetResourceGroup)
  params: {
    principalId: sreAgent.identity.principalId
    accessLevel: accessLevel
  }
}

// Monitoring Reader on the agent's own RG — UAMI reads metrics/alerts here
// Role assignment name must be computable at deploy-start (BCP120).
resource monitoringReaderRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!skipRoleAssignments) {
  name: guid(resourceGroup().id, agentName, '43d0d8ad-25c7-4714-9337-8ba259a9fe05')
  properties: {
    roleDefinitionId: resourceId('Microsoft.Authorization/roleDefinitions', '43d0d8ad-25c7-4714-9337-8ba259a9fe05')
    principalId: managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// SRE Agent Administrator — scoped to the agent resource for the deployer.
// Enables opening the portal experience without a separate IAM step.
resource sreAgentAdminRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!skipRoleAssignments && !empty(deployerObjectId)) {
  name: guid(sreAgent.id, deployerObjectId, 'e79298df-d852-4c6d-84f9-5d13249d1e55')
  scope: sreAgent
  properties: {
    roleDefinitionId: resourceId('Microsoft.Authorization/roleDefinitions', 'e79298df-d852-4c6d-84f9-5d13249d1e55')
    principalId: deployerObjectId
    principalType: 'User'
  }
}

// SRE Agent Administrator — for UAMI (needed for Logic App webhook bridge to call HTTP triggers)
resource uamiAgentAdminRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!skipRoleAssignments) {
  name: guid(sreAgent.id, managedIdentityId, 'e79298df-d852-4c6d-84f9-5d13249d1e55')
  scope: sreAgent
  properties: {
    roleDefinitionId: resourceId('Microsoft.Authorization/roleDefinitions', 'e79298df-d852-4c6d-84f9-5d13249d1e55')
    principalId: managedIdentityPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Connectors — App Insights + Log Analytics
//
// Uses `existing` parent reference so these child resource declarations do NOT
// cause ARM to re-PUT the parent agent on incremental redeployments.
// (Avoids the connector-clobbering hazard — see module header.)
//
// Deployed serially (second depends on first) to prevent concurrent PUT
// requests from clobbering each other on the agent's connector collection.
//
// ⚠  GitHub and ADO connectors are NOT here — see sre-agent-README.md §Connectors.
// ──────────────────────────────────────────────────────────────────────────────

#disable-next-line BCP081
resource agentRef 'Microsoft.App/agents@2025-05-01-preview' existing = {
  name: agentName
}

#disable-next-line BCP081
resource appInsightsConnector 'Microsoft.App/agents/connectors@2025-05-01-preview' = {
  parent: agentRef
  name: 'app-insights'
  properties: {
    dataConnectorType: 'AppInsights'
    dataSource: appInsightsResourceId
    extendedProperties: {
      armResourceId: appInsightsResourceId
      resource: {
        name: last(split(appInsightsResourceId, '/'))
      }
      appId: appInsightsAppId
    }
    identity: managedIdentityId // UAMI queries App Insights
  }
  dependsOn: [sreAgent]
}

#disable-next-line BCP081
resource logAnalyticsConnector 'Microsoft.App/agents/connectors@2025-05-01-preview' = {
  parent: agentRef
  name: 'log-analytics'
  properties: {
    dataConnectorType: 'LogAnalytics'
    dataSource: lawResourceId
    extendedProperties: {
      armResourceId: lawResourceId
      resource: {
        name: last(split(lawResourceId, '/'))
      }
    }
    identity: managedIdentityId // UAMI queries Log Analytics
  }
  // Serial: prevents concurrent PUT from clobbering the connector collection
  dependsOn: [appInsightsConnector]
}

// ──────────────────────────────────────────────────────────────────────────────
// Outputs
// ──────────────────────────────────────────────────────────────────────────────
output agentId string = sreAgent.id
output agentName string = sreAgent.name
output agentDataPlaneUrl string = 'https://${agentName}.${location}.azuresre.ai'
output agentPortalUrl string = 'https://sre.azure.com/#/agent/${subscription().subscriptionId}/${resourceGroup().name}/${agentName}'
output agentSystemMiPrincipalId string = sreAgent.identity.principalId
