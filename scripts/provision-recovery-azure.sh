#!/usr/bin/env bash
set -Eeuo pipefail
set +x
umask 077

SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID:-60489914-d68d-46a3-bbae-a246fbda2902}"
LOCATION="${AZURE_LOCATION:-centralus}"
RESOURCE_GROUP="${AZURE_RECOVERY_RESOURCE_GROUP:-rg-y7-feedback-recovery-cus}"
STORAGE_ACCOUNT="${AZURE_RECOVERY_STORAGE_ACCOUNT:-y7feedbackrec60489914}"
CONTAINER="${AZURE_RECOVERY_CONTAINER:-recovery}"
REPOSITORY="${GITHUB_REPOSITORY:-Y4NN777/y7-feedback-mngt-system}"
BACKUP_IDENTITY="id-y7-feedback-recovery-backup"
RESTORE_IDENTITY="id-y7-feedback-recovery-restore"

ensure_identity() {
  local identity_name="$1"

  if ! az identity show \
    --name "$identity_name" \
    --resource-group "$RESOURCE_GROUP" \
    --output none 2>/dev/null; then
    az identity create \
      --name "$identity_name" \
      --resource-group "$RESOURCE_GROUP" \
      --location "$LOCATION" \
      --output none
  fi
}

upsert_federated_credential() {
  local credential_name="$1"
  local identity_name="$2"
  local subject="$3"

  if az identity federated-credential show \
    --name "$credential_name" \
    --identity-name "$identity_name" \
    --resource-group "$RESOURCE_GROUP" \
    --output none 2>/dev/null; then
    az identity federated-credential update \
      --name "$credential_name" \
      --identity-name "$identity_name" \
      --resource-group "$RESOURCE_GROUP" \
      --issuer https://token.actions.githubusercontent.com \
      --subject "$subject" \
      --audiences api://AzureADTokenExchange \
      --output none
  else
    az identity federated-credential create \
      --name "$credential_name" \
      --identity-name "$identity_name" \
      --resource-group "$RESOURCE_GROUP" \
      --issuer https://token.actions.githubusercontent.com \
      --subject "$subject" \
      --audiences api://AzureADTokenExchange \
      --output none
  fi
}

ensure_role_assignment() {
  local principal_id="$1"
  local role="$2"

  if [[ "$(az role assignment list \
    --assignee-object-id "$principal_id" \
    --role "$role" \
    --scope "$CONTAINER_RESOURCE_ID" \
    --query 'length(@)' \
    --output tsv)" == "0" ]]; then
    az role assignment create \
      --assignee-object-id "$principal_id" \
      --assignee-principal-type ServicePrincipal \
      --role "$role" \
      --scope "$CONTAINER_RESOURCE_ID" \
      --output none
  fi
}

az account set --subscription "$SUBSCRIPTION_ID"
az provider register --namespace Microsoft.Storage --wait
az provider register --namespace Microsoft.ManagedIdentity --wait

az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none
if ! az storage account show \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --output none 2>/dev/null; then
  az storage account create \
    --name "$STORAGE_ACCOUNT" \
    --resource-group "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --sku Standard_LRS \
    --kind StorageV2 \
    --min-tls-version TLS1_2 \
    --allow-blob-public-access false \
    --allow-shared-key-access false \
    --https-only true \
    --output none
fi

CONTAINER_RESOURCE_ID="/subscriptions/$SUBSCRIPTION_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Storage/storageAccounts/$STORAGE_ACCOUNT/blobServices/default/containers/$CONTAINER"
az rest \
  --method put \
  --url "https://management.azure.com${CONTAINER_RESOURCE_ID}?api-version=2023-05-01" \
  --body '{"properties":{"publicAccess":"None"}}' \
  --output none

POLICY_FILE="$(mktemp)"
trap 'rm -f "$POLICY_FILE"' EXIT
printf '%s' '{"rules":[{"enabled":true,"name":"expire-complete-recovery-sets-after-30-days","type":"Lifecycle","definition":{"actions":{"baseBlob":{"delete":{"daysAfterModificationGreaterThan":30}}},"filters":{"blobTypes":["blockBlob"],"prefixMatch":["recovery/generations/","recovery/complete/"]}}}]}' >"$POLICY_FILE"
az storage account management-policy create \
  --account-name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --policy "@$POLICY_FILE" \
  --output none

ensure_identity "$BACKUP_IDENTITY"
ensure_identity "$RESTORE_IDENTITY"

BACKUP_CLIENT_ID="$(az identity show --name "$BACKUP_IDENTITY" --resource-group "$RESOURCE_GROUP" --query clientId --output tsv)"
BACKUP_PRINCIPAL_ID="$(az identity show --name "$BACKUP_IDENTITY" --resource-group "$RESOURCE_GROUP" --query principalId --output tsv)"
RESTORE_CLIENT_ID="$(az identity show --name "$RESTORE_IDENTITY" --resource-group "$RESOURCE_GROUP" --query clientId --output tsv)"
RESTORE_PRINCIPAL_ID="$(az identity show --name "$RESTORE_IDENTITY" --resource-group "$RESOURCE_GROUP" --query principalId --output tsv)"

upsert_federated_credential \
  github-main-backup \
  "$BACKUP_IDENTITY" \
  "repo:${REPOSITORY}:environment:recovery-backup"
upsert_federated_credential \
  github-isolated-restore \
  "$RESTORE_IDENTITY" \
  "repo:${REPOSITORY}:environment:recovery-restore"

ensure_role_assignment "$BACKUP_PRINCIPAL_ID" "Storage Blob Data Contributor"
ensure_role_assignment "$RESTORE_PRINCIPAL_ID" "Storage Blob Data Reader"

printf '{"result":"AZURE_RECOVERY_DESTINATION_PROVISIONED","accountUrl":"https://%s.blob.core.windows.net","container":"%s","backupClientId":"%s","restoreClientId":"%s","location":"%s"}\n' \
  "$STORAGE_ACCOUNT" "$CONTAINER" "$BACKUP_CLIENT_ID" "$RESTORE_CLIENT_ID" "$LOCATION"
