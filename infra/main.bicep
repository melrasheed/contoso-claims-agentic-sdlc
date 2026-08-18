// =============================================================================
// main.bicep — Agentic SDLC Accelerator  |  Resource Group scope
//
// SCOPE: resourceGroup
//   Deploy with:  az deployment group create \
//                   --resource-group <rg-name> \
//                   --template-file infra/main.bicep \
//                   --parameters @infra/main.parameters.json
//
// SKU / SLOT DECISION:
//   B1 (Basic) does NOT support deployment slots. The `enableSlots` parameter
//   defaults to false → B1 plan (~$13/mo per app, cheapest demo budget).
//   Set enableSlots=true to enable the API staging slot; this forces the plan
//   to S1 (~$56/mo) automatically via the appservice module.
//   For prod with canary deploys, set enableSlots=true.
//
// SPA SERVING:
//   The React/Vite SPA is served from a Linux Web App using Node 20 + `npx serve`.
//   This is the simplest reliable approach without requiring Azure Static Web Apps
//   or a CDN, keeping the demo self-contained on a single App Service Plan.
//
// VITE_API_BASE_URL NOTE:
//   Vite inlines environment variables at BUILD TIME. The `viteApiBaseUrl`
//   parameter here documents the expected value; the actual env var must be set
//   as a pipeline variable BEFORE `npm run build` runs (see pipelines/README.md).
//
// =============================================================================
targetScope = 'resourceGroup'

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------
@description('Azure region. Defaults to the resource group location.')
param location string = resourceGroup().location

@description('Short prefix used in all resource names (e.g. "contoso"). No special chars, max 10.')
@maxLength(10)
param namePrefix string = 'contoso'

@description('Environment label: dev or prod')
@allowed(['dev', 'prod'])
param environmentName string = 'dev'

@description('Base SKU for App Service Plan. Overridden to S1 automatically if enableSlots=true.')
@allowed(['B1', 'S1', 'P1v3'])
param sku string = 'B1'

@description('Enable staging slot on API app (requires Standard tier; forces S1 minimum).')
param enableSlots bool = false

@description('Enable the Node.js admin endpoint on the API app.')
param adminEnabled bool = false

@description('Ops team email for alert notifications.')
param alertEmailAddress string = 'ops-team@example.com'

@description('HTTP 5xx count threshold per 5-minute window before alerting.')
param http5xxThreshold int = 5

@description('Average response time threshold (seconds) before alerting.')
param responseTimeThresholdSeconds int = 3

@description('Whether Azure Monitor alert rules are enabled.')
param alertsEnabled bool = true

@description('API base URL for the SPA. Must be set as a pipeline variable before Vite build.')
param viteApiBaseUrl string = ''

// ---------------------------------------------------------------------------
// SRE Agent parameters
// ---------------------------------------------------------------------------
@description('Enable the Azure SRE Agent. Default false — keeps base deployment cost-free.')
param enableSreAgent bool = false

@description('SRE Agent action mode. Review = human approves each action (safe demo default). Automatic = autonomous execution. WARNING: In Automatic mode, Ask-level tools execute WITHOUT approval.')
@allowed(['Review', 'Automatic'])
param sreAgentMode string = 'Review'

@description('SRE Agent access level on the monitored resource group. Low = Reader + Log Analytics Reader. High adds Contributor.')
@allowed(['Low', 'High'])
param sreAgentAccessLevel string = 'Low'

@description('Monthly agent unit budget cap (token-based billing guard).')
param sreAgentMonthlyUnitLimit int = 10000

@description('Skip RBAC role assignments on SRE Agent re-deploy (avoids RoleAssignmentExists errors).')
param sreAgentSkipRbac bool = false

@description('Object ID of the deployer (az ad signed-in-user show --query id -o tsv). Used to grant SRE Agent Administrator role. Leave empty to skip.')
param sreAgentDeployerObjectId string = ''

// ---------------------------------------------------------------------------
// Tags applied to every resource
// ---------------------------------------------------------------------------
var tags = {
  project: 'agentic-sdlc'
  env: environmentName
  managedBy: 'bicep'
}

// ---------------------------------------------------------------------------
// Module: Managed Identity
// ---------------------------------------------------------------------------
module identity 'modules/identity.bicep' = {
  name: 'identity'
  params: {
    location: location
    namePrefix: namePrefix
    environmentName: environmentName
    tags: tags
  }
}

// ---------------------------------------------------------------------------
// Module: Monitoring (Log Analytics + App Insights)
// ---------------------------------------------------------------------------
module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    location: location
    namePrefix: namePrefix
    environmentName: environmentName
    tags: tags
  }
}

// ---------------------------------------------------------------------------
// Module: App Service (Plan + API Web App + Web SPA + optional Staging Slot)
// ---------------------------------------------------------------------------
module appservice 'modules/appservice.bicep' = {
  name: 'appservice'
  params: {
    location: location
    namePrefix: namePrefix
    environmentName: environmentName
    tags: tags
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    managedIdentityId: identity.outputs.identityId
    viteApiBaseUrl: viteApiBaseUrl
    sku: sku
    enableSlots: enableSlots
    adminEnabled: adminEnabled
  }
}

// ---------------------------------------------------------------------------
// Module: Alerts (Action Group + Metric Alert Rules)
// ---------------------------------------------------------------------------
module alerts 'modules/alerts.bicep' = {
  name: 'alerts'
  params: {
    location: location
    namePrefix: namePrefix
    environmentName: environmentName
    tags: tags
    apiWebAppId: appservice.outputs.apiWebAppId
    appInsightsId: monitoring.outputs.appInsightsId
    alertEmailAddress: alertEmailAddress
    http5xxThreshold: http5xxThreshold
    responseTimeThresholdSeconds: responseTimeThresholdSeconds
    alertsEnabled: alertsEnabled
  }
}

// =============================================================================
// Module: SRE Agent (conditional — gated on enableSreAgent)
//
// enableSreAgent defaults to FALSE so the base deployment path is unaffected.
// Set enableSreAgent=true ONLY when you are ready to provision and bill.
//
// ──────────────────────────────────────────────────────────────────────
// The alert rules and Action Group from modules/alerts.bicep are wired
// to the same Log Analytics workspace and App Insights that the agent uses.
// The SRE Agent portal will automatically surface these alerts as incidents.
//
// Key values for the SRE Agent workstream:
//   Action Group ID:     alerts.outputs.actionGroupId
//   Alert 5xx Name:      alerts.outputs.alert5xxName
//   Alert RespTime Name: alerts.outputs.alertResponseTimeName
//   Agent Portal URL:    sreAgent.outputs.agentPortalUrl   (when enabled)
// ──────────────────────────────────────────────────────────────────────
// =============================================================================
module sreAgentMod 'modules/sre-agent.bicep' = if (enableSreAgent) {
  name: 'sre-agent'
  params: {
    agentName: '${namePrefix}-sre-agent-${environmentName}'
    location: location
    namePrefix: namePrefix
    environmentName: environmentName
    tags: tags
    targetResourceGroup: resourceGroup().name
    subscriptionId: subscription().subscriptionId
    managedIdentityId: identity.outputs.identityId
    managedIdentityPrincipalId: identity.outputs.identityPrincipalId
    appInsightsAppId: monitoring.outputs.appInsightsAppId
    appInsightsResourceId: monitoring.outputs.appInsightsId
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    lawResourceId: monitoring.outputs.logAnalyticsWorkspaceId
    accessLevel: sreAgentAccessLevel
    sreAgentMode: sreAgentMode
    monthlyAgentUnitLimit: sreAgentMonthlyUnitLimit
    skipRoleAssignments: sreAgentSkipRbac
    deployerObjectId: sreAgentDeployerObjectId
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
output resourceGroupName string = resourceGroup().name
output location string = location
output environmentName string = environmentName

// Identity
output managedIdentityId string = identity.outputs.identityId
output managedIdentityName string = identity.outputs.identityName
output managedIdentityPrincipalId string = identity.outputs.identityPrincipalId

// Monitoring
output logAnalyticsWorkspaceId string = monitoring.outputs.logAnalyticsWorkspaceId
output appInsightsId string = monitoring.outputs.appInsightsId
output appInsightsName string = monitoring.outputs.appInsightsName
output appInsightsConnectionString string = monitoring.outputs.appInsightsConnectionString

// App Service
output appServicePlanName string = appservice.outputs.appServicePlanName
output effectiveSku string = appservice.outputs.effectiveSku

output apiWebAppId string = appservice.outputs.apiWebAppId
output apiWebAppName string = appservice.outputs.apiWebAppName
output apiDefaultHostname string = appservice.outputs.apiDefaultHostname
output apiStagingHostname string = appservice.outputs.apiStagingHostname

output webAppId string = appservice.outputs.webAppId
output webAppName string = appservice.outputs.webAppName
output webDefaultHostname string = appservice.outputs.webDefaultHostname

// Alerts (referenced by SRE Agent workstream)
output actionGroupId string = alerts.outputs.actionGroupId
output actionGroupName string = alerts.outputs.actionGroupName
output alert5xxId string = alerts.outputs.alert5xxId
output alert5xxName string = alerts.outputs.alert5xxName
output alertResponseTimeId string = alerts.outputs.alertResponseTimeId
output alertResponseTimeName string = alerts.outputs.alertResponseTimeName

// SRE Agent (only populated when enableSreAgent=true)
output sreAgentId string = sreAgentMod.?outputs.agentId ?? ''
output sreAgentName string = sreAgentMod.?outputs.agentName ?? ''
output sreAgentPortalUrl string = sreAgentMod.?outputs.agentPortalUrl ?? ''
output sreAgentDataPlaneUrl string = sreAgentMod.?outputs.agentDataPlaneUrl ?? ''