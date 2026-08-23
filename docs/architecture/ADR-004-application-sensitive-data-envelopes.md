# ADR-004 — Application-level sensitive-data envelopes

- Status: accepted
- Date: 2026-08-23
- Tasks: `TASK-DEL-002`, `TASK-SEC-001`
- Scenarios: `BDD-DATA-ENC-001` through `BDD-DATA-ENC-007`

## Context

The Appwrite Education project accepted TablesDB columns requested with native
encryption but reported them as unencrypted on replay. Real preview evidence
therefore failed closed. Moving the project to another hosting model or relying
on a capability the active plan does not provide would delay the Day 1/Day 2
delivery spine.

Sensitive values must remain unreadable at rest even when an Appwrite database
export or row is exposed. Queryable scope, identity, state, and routing values
must remain independently available so trusted Functions can authorize before
opening protected content.

## Decision

Trusted Functions protect sensitive database fields before calling TablesDB by
using AES-256-GCM envelopes with the format
`v1.<key-id>.<nonce>.<ciphertext>.<authentication-tag>`.

Each envelope authenticates its environment, table ID, row ID, and field name
as associated data. An envelope copied to another record, field, table, or
environment therefore cannot be opened. Configuration supplies an active key
ID and a versioned keyring. Writes use only the active key; reads may use
retained older keys to support rotation.

Keys for sensitive data, accountless Access Proof envelopes, and provider grants
must be distinct. They remain server-only and are never exposed through
`VITE_*`, logs, session summaries, or committed environment files.

Appwrite columns that contain application envelopes explicitly declare native
encryption as disabled, matching the Education project metadata. They remain
unindexed. The private attachment bucket continues to require Appwrite storage
encryption and antivirus scanning.

## Consequences

- Intake, accountless access, and attachment metadata adapters must receive a
  sensitive-data protector explicitly; production composition has no plaintext
  fallback.
- Sensitive fields cannot be queried or sorted in TablesDB. Queryable derived
  values must be non-sensitive, purpose-specific, and justified separately.
- Key loss makes protected data unrecoverable. Rotation must retain prior keys
  until all corresponding envelopes have been rewritten or expired.
- Any new adapter writing a declared envelope column must prove that plaintext
  is absent from its TablesDB request and that reads fail closed on invalid
  context, key ID, or authentication tag.
- Existing nonconforming preview resources must be recreated before they can
  become G1 acceptance evidence. That destructive remote action requires the
  operator's explicit approval.

## Rejected alternatives

- Treat Appwrite Education as if it supported native database encryption: real
  replay evidence disproved this.
- Store sensitive JSON as plaintext: violates the at-rest confidentiality
  invariant.
- Use one shared key for every encryption purpose: expands blast radius and
  makes independent rotation unsafe.
- Add searchable encryption now: no accepted use case requires it, and it adds
  leakage and operational complexity.
