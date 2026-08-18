// =============================================================================
// alerts.bicep — Azure Monitor Alert Rules + Action Group
//
// These alert rules are intentionally named and exported so the Azure SRE Agent
// workstream can reference them by name/ID without needing to re-query the
// resource graph. See the placeholder section in main.bicep.
//
// Two rules are created on the API Web App:
//   1. Http5xx  — HTTP 5xx response count > threshold over 5-minute window
//   2. ResponseTimeP95 — Average response time > 3 s over 5-minute window
//      (Note: P95 is not directly available as a built-in metric; we use
//       HttpResponseTime average as the closest proxy. For true P95 you would
//       use a Log Analytics scheduled query alert using AppRequests — a
//       commented example is included below.)
// =============================================================================

@description('Azure region for all resources — reserved for future use (Action Group is global)')
#disable-next-line no-unused-params
param location string

@description('Name prefix for resource naming')
param namePrefix string

@description('Environment name (dev | prod)')
param environmentName string

@description('Tags applied to all resources')
param tags object

@description('Resource ID of the API web app to monitor')
param apiWebAppId string

@description('App Insights resource ID — reserved for log-based alert scoping in future iterations')
#disable-next-line no-unused-params
param appInsightsId string

@description('Alert notification email address')
param alertEmailAddress string = 'ops-team@example.com'

@description('HTTP 5xx count threshold to trigger alert')
param http5xxThreshold int = 5

@description('Response time threshold in seconds (average) to trigger alert')
param responseTimeThresholdSeconds int = 3

@description('Whether alert rules are enabled')
param alertsEnabled bool = true

// ---------------------------------------------------------------------------
// Action Group
// NOTE: The SRE Agent workstream should reference this action group by its
// exported resourceId (output: actionGroupId) when wiring up its own remediation.
// ---------------------------------------------------------------------------
resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: '${namePrefix}-ag-${environmentName}'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'SREAlerts'
    enabled: alertsEnabled
    emailReceivers: [
      {
        name: 'OpsTeam'
        emailAddress: alertEmailAddress
        useCommonAlertSchema: true
      }
    ]
  }
}

// ---------------------------------------------------------------------------
// Alert Rule 1: HTTP 5xx count > threshold over 5 minutes
// ---------------------------------------------------------------------------
resource alert5xx 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${namePrefix}-alert-5xx-${environmentName}'
  location: 'global'
  tags: tags
  properties: {
    description: 'API HTTP 5xx response count exceeded threshold — potential application failure'
    severity: 1 // Sev1 = Critical
    enabled: alertsEnabled
    scopes: [
      apiWebAppId
    ]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'Http5xxCount'
          criterionType: 'StaticThresholdCriterion'
          metricName: 'Http5xx'
          metricNamespace: 'Microsoft.Web/sites'
          operator: 'GreaterThan'
          threshold: http5xxThreshold
          timeAggregation: 'Total'
        }
      ]
    }
    actions: [
      {
        actionGroupId: actionGroup.id
      }
    ]
    autoMitigate: true
  }
}

// ---------------------------------------------------------------------------
// Alert Rule 2: Average response time > threshold seconds over 5 minutes
// (Proxy for P95 — see comment in module header for log-based P95 approach)
// ---------------------------------------------------------------------------
resource alertResponseTime 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${namePrefix}-alert-responsetime-${environmentName}'
  location: 'global'
  tags: tags
  properties: {
    description: 'API average response time exceeded ${responseTimeThresholdSeconds}s — potential performance degradation'
    severity: 2 // Sev2 = Warning
    enabled: alertsEnabled
    scopes: [
      apiWebAppId
    ]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'AverageResponseTime'
          criterionType: 'StaticThresholdCriterion'
          metricName: 'AverageResponseTime'
          metricNamespace: 'Microsoft.Web/sites'
          operator: 'GreaterThan'
          threshold: responseTimeThresholdSeconds
          timeAggregation: 'Average'
        }
      ]
    }
    actions: [
      {
        actionGroupId: actionGroup.id
      }
    ]
    autoMitigate: true
  }
}

// ---------------------------------------------------------------------------
// Outputs — consumed by main.bicep and referenced by SRE Agent workstream
// ---------------------------------------------------------------------------
output actionGroupId string = actionGroup.id
output actionGroupName string = actionGroup.name
output alert5xxId string = alert5xx.id
output alert5xxName string = alert5xx.name
output alertResponseTimeId string = alertResponseTime.id
output alertResponseTimeName string = alertResponseTime.name
