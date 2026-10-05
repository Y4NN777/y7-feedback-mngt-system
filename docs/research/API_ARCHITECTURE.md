# API architecture migration contract

Status: active migration  
Owner plan: `docs/sessions/plans/2026-10-05-api-restructuring.md`

## Baseline

At `main@12ad8ac`, `functions/api/src` contains 398 top-level TypeScript files:

- 192 production/runtime or supporting modules;
- 179 colocated tests;
- 27 deployed verification programs;
- 131 emitted JavaScript modules in the Appwrite runtime artifact;
- approximately 1.1 MiB of emitted runtime JavaScript and source maps.

The runtime exposes one Appwrite entry point, `src/main.ts`, and one ordered HTTP
registry with these stable operations:

```text
provider_webhook
provider_maintenance
provider_event_inbox
provider_issue_outbox
source_connection
project_administration
platform_access
conversation_lifecycle
workbench
external_issue
intelligence
privacy
public_api
```

The API package is private. Its externally stable surface is HTTP behavior,
Appwrite schema and deployed identifiers rather than its internal TypeScript
paths.

## Target boundaries

```text
main.ts -> runtime/composition -> capability-owned ports
                                  ^
                                  |
                         infrastructure adapters

tooling -> runtime and capabilities (verification only)
runtime -X-> tooling
infrastructure -X-> HTTP handlers
capabilities -X-> concrete Appwrite adapters
```

`main.ts` remains the only final production file directly under `src`. During
the migration, the architecture test permits only a decreasing number of legacy
root files. New work must begin in one of the target directories.

## Stable compatibility surface

The migration must not change:

- HTTP methods, paths, request/response shapes or public `ERR-*` values;
- authorization, scope derivation, idempotency, redaction or transaction order;
- Appwrite database, table, bucket, column or index identifiers;
- environment variables, OAuth callbacks, Function URLs or secret names;
- the deployed migration marker `day4-control-plane-v1`;
- the single-Function deployment model.

Planning-era source names are replaced capability by capability. Persisted or
deployed values keep a clearly named `legacy` compatibility constant until a
separate additive migration proves they can change.

## Migration rule

Each slice uses `git mv`, moves implementation and tests together, and remains
independently revertible. Mechanical relocation and behavior-preserving
composition changes are separate commits when both are necessary. No generic
repository, service locator or framework dependency is introduced.

