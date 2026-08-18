// =============================================================================
// identity.bicep — User-Assigned Managed Identity
// =============================================================================
@description('Azure region for all resources')
param location string

@description('Name prefix for resource naming')
param namePrefix string

@description('Environment name (dev | prod)')
param environmentName string

@description('Tags applied to all resources')
param tags object

resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${namePrefix}-id-${environmentName}'
  location: location
  tags: tags
}

output identityId string = managedIdentity.id
output identityName string = managedIdentity.name
output identityPrincipalId string = managedIdentity.properties.principalId
output identityClientId string = managedIdentity.properties.clientId
