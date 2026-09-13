@description('Globally unique Email Communication Service name.')
param emailServiceName string

@description('Globally unique Azure Communication Service name.')
param communicationServiceName string

@description('Microsoft Entra application used for SMTP authentication.')
param entraApplicationId string

@description('Microsoft Entra tenant containing the SMTP application.')
param tenantId string

@description('Stable, non-email SMTP authentication username.')
param smtpUsername string = 'y7-feedback-production'

@description('Azure geography where email data is stored at rest.')
param dataLocation string = 'Europe'

resource emailService 'Microsoft.Communication/emailServices@2025-09-01' = {
  name: emailServiceName
  location: 'global'
  properties: {
    dataLocation: dataLocation
  }
}

resource managedDomain 'Microsoft.Communication/emailServices/domains@2025-09-01' = {
  parent: emailService
  name: 'AzureManagedDomain'
  location: 'global'
  properties: {
    domainManagement: 'AzureManaged'
    userEngagementTracking: 'Disabled'
  }
}

resource communicationService 'Microsoft.Communication/communicationServices@2025-09-01' = {
  name: communicationServiceName
  location: 'global'
  properties: {
    dataLocation: dataLocation
    linkedDomains: [managedDomain.id]
  }
}

resource smtpAuthority 'Microsoft.Communication/communicationServices/smtpUsernames@2025-09-01' = {
  parent: communicationService
  name: smtpUsername
  properties: {
    entraApplicationId: entraApplicationId
    tenantId: tenantId
    username: smtpUsername
  }
}

output communicationServiceId string = communicationService.id
output senderAddress string = managedDomain.properties.mailFromSenderDomain
output smtpUsername string = smtpAuthority.properties.username
