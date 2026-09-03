# Day 4 — Platform exceptional-access evidence

## Scope

- Task: `TASK-PLAT-001`
- Requirements: D4.6 and the Platform clauses of G4
- Environment: Appwrite Preview
- Function deployment: `6a997d74f21ec8a94043`
- Source commit deployed: `b9834a6`

## Real-service command

```bash
pnpm verify:appwrite:g4:platform-access
```

Result:

```json
{
  "result": "APPWRITE_G4_PLATFORM_ACCESS_PASSED",
  "standingAccessDenied": true,
  "missingPrincipalDenied": true,
  "beforeApprovalDenied": true,
  "selfApprovalDenied": true,
  "maximumDurationDenied": true,
  "extensionDenied": true,
  "scopeBreachDenied": true,
  "exactContentPassed": true,
  "idempotentReplayPassed": true,
  "concurrentRevokeUsePassed": true,
  "afterRevocationDenied": true,
  "afterExpiryDenied": true,
  "breakGlassReviewPassed": true,
  "immutableAuditPassed": true,
  "cleanupPassed": true
}
```

The verifier used temporary Appwrite users with completed TOTP MFA challenges,
the permanent Preview Platform teams, a private feedback fixture, independent
operator and owner principals, real TablesDB transactions, and the deployed
Function command boundary. The expiry adapter ran against Preview TablesDB.
All temporary memberships, users, content, grants, idempotency rows and audit
rows were removed in the verifier's `finally` cleanup.

No credential, MFA secret, JWT, private content, provider identifier, raw
response payload or environment value is retained in this evidence.
