// =============================================================================
// rbac-target.bicep — Role assignments on a target resource group
// Used by sre-agent.bicep to grant the agent's system MI access to the
// workload resource group (separate from the agent's own RG).
// =============================================================================

param principalId string

@allowed(['Low', 'High'])
param accessLevel string

// Reader — enumerate resources, read metadata
resource reader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, principalId, 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
  properties: {
    roleDefinitionId: resourceId('Microsoft.Authorization/roleDefinitions', 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}

// Log Analytics Reader — run KQL queries, read workspace data
resource logAnalyticsReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, principalId, '73c42c96-874c-492b-b04d-ab87d138a893')
  properties: {
    roleDefinitionId: resourceId('Microsoft.Authorization/roleDefinitions', '73c42c96-874c-492b-b04d-ab87d138a893')
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}

// Contributor — apply remediations (restarts, config changes).
// Only granted when accessLevel=High. Low is the safe default for demos.
resource contributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (accessLevel == 'High') {
  name: guid(resourceGroup().id, principalId, 'b24988ac-6180-42a0-ab88-20f7382dd24c')
  properties: {
    roleDefinitionId: resourceId('Microsoft.Authorization/roleDefinitions', 'b24988ac-6180-42a0-ab88-20f7382dd24c')
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}
