// =============================================================================
// appservice.bicep — App Service Plan + API Web App + Web SPA Web App
// =============================================================================
//
// SLOT / SKU DECISION:
//   B1 (Basic) does NOT support deployment slots. The `enableSlots` parameter
//   controls whether a `staging` slot is created on the API app.
//   When enableSlots=true the plan SKU is automatically promoted to S1
//   (Standard), which is the minimum tier supporting slots.
//   Default: enableSlots=false  →  B1  (cheapest, no slot)
//           enableSlots=true   →  S1  (Standard, staging slot available)
//
// WEB APP (SPA) SERVING STRATEGY:
//   The static SPA is deployed to a Linux Web App using the built-in
//   staticfiles runtime (NODE|20-lts with a custom startup command that
//   invokes `npx serve dist`). This avoids needing a separate CDN or storage
//   account while keeping the demo self-contained. The startup command is set
//   via linuxFxVersion + appCommandLine.
// =============================================================================

@description('Azure region for all resources')
param location string

@description('Name prefix for resource naming')
param namePrefix string

@description('Environment name (dev | prod)')
param environmentName string

@description('Tags applied to all resources')
param tags object

@description('App Insights connection string')
param appInsightsConnectionString string

@description('User-assigned managed identity resource ID')
param managedIdentityId string

@description('Vite API base URL baked into the SPA at build time (document only — not injected at runtime)')
param viteApiBaseUrl string = ''

@description('Base SKU for the plan. When enableSlots=true this is overridden to S1.')
@allowed(['B1', 'S1', 'P1v3'])
param sku string = 'B1'

@description('Enable staging slot on API app (requires Standard or above; forces S1 minimum)')
param enableSlots bool = false

@description('Node.js admin endpoint toggle')
param adminEnabled bool = false

// ---------------------------------------------------------------------------
// Derived SKU: if slots are requested and the chosen SKU is B1, upgrade to S1
// ---------------------------------------------------------------------------
var effectiveSku = (enableSlots && sku == 'B1') ? 'S1' : sku

// ---------------------------------------------------------------------------
// App Service Plan (shared by both apps)
// ---------------------------------------------------------------------------
resource appServicePlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: '${namePrefix}-asp-${environmentName}'
  location: location
  tags: tags
  kind: 'linux'
  sku: {
    name: effectiveSku
    tier: (effectiveSku == 'B1') ? 'Basic' : (effectiveSku == 'S1') ? 'Standard' : 'PremiumV3'
  }
  properties: {
    reserved: true // required for Linux
  }
}

// ---------------------------------------------------------------------------
// API Web App
// ---------------------------------------------------------------------------
resource apiWebApp 'Microsoft.Web/sites@2023-01-01' = {
  name: '${namePrefix}-api-${environmentName}'
  location: location
  tags: union(tags, { app: 'api' })
  kind: 'app,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentityId}': {}
    }
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      appCommandLine: 'node dist/index.js'
      alwaysOn: effectiveSku != 'B1' // alwaysOn not available on B1
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      appSettings: [
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
        }
        {
          name: 'ApplicationInsightsAgent_EXTENSION_VERSION'
          value: '~3'
        }
        {
          name: 'NODE_ENV'
          value: environmentName
        }
        {
          name: 'ADMIN_ENABLED'
          value: adminEnabled ? 'true' : 'false'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~20'
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'false'
        }
      ]
    }
  }
}

// ---------------------------------------------------------------------------
// API Staging Slot (only when enableSlots=true and plan supports it)
// ---------------------------------------------------------------------------
resource apiStagingSlot 'Microsoft.Web/sites/slots@2023-01-01' = if (enableSlots) {
  name: 'staging'
  parent: apiWebApp
  location: location
  tags: union(tags, { app: 'api', slot: 'staging' })
  kind: 'app,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentityId}': {}
    }
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      appCommandLine: 'node dist/index.js'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      appSettings: [
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
        }
        {
          name: 'ApplicationInsightsAgent_EXTENSION_VERSION'
          value: '~3'
        }
        {
          name: 'NODE_ENV'
          value: 'staging'
        }
        {
          name: 'ADMIN_ENABLED'
          value: 'false'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~20'
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'false'
        }
      ]
    }
  }
}

// ---------------------------------------------------------------------------
// Web (SPA) Web App
// NOTE: VITE_API_BASE_URL is NOT injected at runtime — Vite inlines env vars
// at build time. This app setting is a documentation marker only. The actual
// VITE_API_BASE_URL must be set as a pipeline variable before `npm run build`.
// ---------------------------------------------------------------------------
resource webApp 'Microsoft.Web/sites@2023-01-01' = {
  name: '${namePrefix}-web-${environmentName}'
  location: location
  tags: union(tags, { app: 'web' })
  kind: 'app,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentityId}': {}
    }
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      // `serve` is included in the published dist artifact via devDependencies.
      // Alternatively the pipeline injects a minimal server.js — see pipeline README.
      appCommandLine: 'npx serve dist -s -l $PORT'
      alwaysOn: effectiveSku != 'B1'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      appSettings: [
        {
          name: 'VITE_API_BASE_URL'
          // Documentation marker — this value is not used at runtime.
          // See comment above.
          value: viteApiBaseUrl
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~20'
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'false'
        }
      ]
    }
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
output appServicePlanId string = appServicePlan.id
output appServicePlanName string = appServicePlan.name
output effectiveSku string = effectiveSku

output apiWebAppId string = apiWebApp.id
output apiWebAppName string = apiWebApp.name
output apiDefaultHostname string = apiWebApp.properties.defaultHostName
output apiStagingHostname string = enableSlots ? (apiStagingSlot.?properties.defaultHostName ?? '') : ''

output webAppId string = webApp.id
output webAppName string = webApp.name
output webDefaultHostname string = webApp.properties.defaultHostName
