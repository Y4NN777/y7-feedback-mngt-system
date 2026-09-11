@description('Azure region allowed by the target subscription policy.')
param location string = resourceGroup().location

@description('Permanent Container Apps environment name.')
param environmentName string = 'cae-y7-feedback-production-cus'

@description('Permanent antivirus Container App name.')
param appName string = 'ca-y7-antivirus-production'

@description('Immutable Y7 scanner gateway image, normally a sha-* GHCR tag.')
param gatewayImage string
@description('Exact lowercase Git commit represented by the immutable gateway image.')
@minLength(40)
@maxLength(40)
param gatewayRelease string

@description('Pinned ClamAV daemon image.')
param clamavImage string = 'clamav/clamav:1.5.4'

@description('Identifier for the active scanner signing key.')
param scannerKeyId string

@secure()
@description('Unpadded base64url-encoded 32-byte scanner signing key.')
param scannerHmacKey string

@description('Required Azure Monitor action group resource ID for Production alerts.')
param actionGroupId string

var workspaceName = 'log-y7-feedback-production-cus'
var alertActions = [
  {
    actionGroupId: actionGroupId
  }
]

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: workspaceName
  location: location
  properties: {
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
    retentionInDays: 30
    sku: {
      name: 'PerGB2018'
    }
  }
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource scanner 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        allowInsecure: false
        targetPort: 8080
        transport: 'auto'
      }
      secrets: [
        {
          name: 'scanner-hmac-key'
          value: scannerHmacKey
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'gateway'
          image: gatewayImage
          env: [
            {
              name: 'CLAMAV_HOST'
              value: '127.0.0.1'
            }
            {
              name: 'CLAMAV_PORT'
              value: '3310'
            }
            {
              name: 'Y7_SCANNER_KEY_ID'
              value: scannerKeyId
            }
            {
              name: 'Y7_SCANNER_RELEASE'
              value: gatewayRelease
            }
            {
              name: 'Y7_SCANNER_HMAC_KEY'
              secretRef: 'scanner-hmac-key'
            }
          ]
          probes: [
            {
              type: 'Startup'
              httpGet: {
                path: '/health'
                port: 8080
                scheme: 'HTTP'
              }
              initialDelaySeconds: 5
              periodSeconds: 10
              failureThreshold: 10
            }
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 8080
                scheme: 'HTTP'
              }
              periodSeconds: 30
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 8080
                scheme: 'HTTP'
              }
              periodSeconds: 10
              failureThreshold: 3
            }
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
        {
          name: 'clamav'
          image: clamavImage
          resources: {
            cpu: json('1.25')
            memory: '2.5Gi'
          }
          volumeMounts: [
            {
              volumeName: 'clamav-signatures'
              mountPath: '/var/lib/clamav'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 2
      }
      volumes: [
        {
          name: 'clamav-signatures'
          storageType: 'EmptyDir'
        }
      ]
    }
  }
}

resource serverErrors 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${appName}-server-errors'
  location: 'global'
  properties: {
    description: 'Y7 Production antivirus returned a server error.'
    severity: 1
    enabled: true
    scopes: [scanner.id]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'ServerErrors'
          metricNamespace: 'Microsoft.App/containerapps'
          metricName: 'Requests'
          operator: 'GreaterThan'
          threshold: 0
          timeAggregation: 'Total'
          dimensions: [
            {
              name: 'statusCodeCategory'
              operator: 'Include'
              values: ['5xx']
            }
          ]
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    autoMitigate: true
    actions: alertActions
  }
}

resource noReplica 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${appName}-no-replica'
  location: 'global'
  properties: {
    description: 'Y7 Production antivirus has no ready replica.'
    severity: 0
    enabled: true
    scopes: [scanner.id]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'NoReplica'
          metricNamespace: 'Microsoft.App/containerapps'
          metricName: 'Replicas'
          operator: 'LessThan'
          threshold: 1
          timeAggregation: 'Average'
          dimensions: []
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    autoMitigate: true
    actions: alertActions
  }
}

output scannerOrigin string = 'https://${scanner.properties.configuration.ingress.fqdn}'
output scannerResourceId string = scanner.id
output logWorkspaceResourceId string = logs.id
