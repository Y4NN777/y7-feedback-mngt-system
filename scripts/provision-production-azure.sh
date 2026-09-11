#!/usr/bin/env bash
set -Eeuo pipefail
set +x
umask 077

SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID:-60489914-d68d-46a3-bbae-a246fbda2902}"
LOCATION="${AZURE_LOCATION:-centralus}"
RESOURCE_GROUP="${AZURE_PRODUCTION_RESOURCE_GROUP:-rg-y7-feedback-production-cus}"
IDENTITY_NAME="${AZURE_PRODUCTION_IDENTITY_NAME:-id-y7-feedback-production-deploy}"
ACTION_GROUP_NAME="${AZURE_PRODUCTION_ACTION_GROUP_NAME:-ag-y7-feedback-production}"
ACTION_GROUP_SHORT_NAME="${AZURE_PRODUCTION_ACTION_GROUP_SHORT_NAME:-y7prod}"
OIDC_REPOSITORY_SUBJECT="${GITHUB_OIDC_REPOSITORY_SUBJECT:-Y4NN777@171065166/y7-feedback-mngt-system@1329343404}"
ALERT_EMAIL="${AZURE_PRODUCTION_ALERT_EMAIL:-}"

if [[ ! "$SUBSCRIPTION_ID" =~ ^[0-9a-fA-F-]{36}$ ]] ||
  [[ ! "$RESOURCE_GROUP" =~ ^[A-Za-z0-9._()-]{1,90}$ ]] ||
  [[ ! "$OIDC_REPOSITORY_SUBJECT" =~ ^[A-Za-z0-9_.-]+@[0-9]+/[A-Za-z0-9_.-]+@[0-9]+$ ]] ||
  [[ ! "$ALERT_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  printf '{"error":"PRODUCTION_AZURE_BOOTSTRAP_CONFIG_INVALID"}\n' >&2
  exit 1
fi

az account set --subscription "$SUBSCRIPTION_ID"
az provider register --namespace Microsoft.App --wait
az provider register --namespace Microsoft.Insights --wait
az provider register --namespace Microsoft.ManagedIdentity --wait
az provider register --namespace Microsoft.OperationalInsights --wait
az provider register --namespace Microsoft.Resources --wait

az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --output none

if ! az identity show \
  --name "$IDENTITY_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --output none 2>/dev/null; then
  az identity create \
    --name "$IDENTITY_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --output none
fi

if az identity federated-credential show \
  --name github-production \
  --identity-name "$IDENTITY_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --output none 2>/dev/null; then
  az identity federated-credential update \
    --name github-production \
    --identity-name "$IDENTITY_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --issuer https://token.actions.githubusercontent.com \
    --subject "repo:${OIDC_REPOSITORY_SUBJECT}:environment:production" \
    --audiences api://AzureADTokenExchange \
    --output none
else
  az identity federated-credential create \
    --name github-production \
    --identity-name "$IDENTITY_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --issuer https://token.actions.githubusercontent.com \
    --subject "repo:${OIDC_REPOSITORY_SUBJECT}:environment:production" \
    --audiences api://AzureADTokenExchange \
    --output none
fi

az monitor action-group create \
  --name "$ACTION_GROUP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --short-name "$ACTION_GROUP_SHORT_NAME" \
  --action email production-operations "$ALERT_EMAIL" usecommonalertschema \
  --output none

IDENTITY_CLIENT_ID="$(az identity show \
  --name "$IDENTITY_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query clientId --output tsv)"
IDENTITY_PRINCIPAL_ID="$(az identity show \
  --name "$IDENTITY_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query principalId --output tsv)"
RESOURCE_GROUP_ID="$(az group show \
  --name "$RESOURCE_GROUP" \
  --query id --output tsv)"
ACTION_GROUP_ID="$(az monitor action-group show \
  --name "$ACTION_GROUP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query id --output tsv)"

if [[ "$(az role assignment list \
  --assignee-object-id "$IDENTITY_PRINCIPAL_ID" \
  --role Contributor \
  --scope "$RESOURCE_GROUP_ID" \
  --query 'length(@)' --output tsv)" == "0" ]]; then
  az role assignment create \
    --assignee-object-id "$IDENTITY_PRINCIPAL_ID" \
    --assignee-principal-type ServicePrincipal \
    --role Contributor \
    --scope "$RESOURCE_GROUP_ID" \
    --output none
fi

printf '{"result":"PRODUCTION_AZURE_AUTHORITY_PROVISIONED","clientId":"%s","actionGroupId":"%s","resourceGroup":"%s","location":"%s"}\n' \
  "$IDENTITY_CLIENT_ID" "$ACTION_GROUP_ID" "$RESOURCE_GROUP" "$LOCATION"
