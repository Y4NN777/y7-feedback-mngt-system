# Day 5 recovery evidence

Task: `TASK-REC-001`  
Requirements: `NFR-REC-001`, `NFR-REC-002`, `NFR-REC-003`, `ADR-009`  
Command: `pnpm verify:recovery:g5`

## Automated coverage

- deterministic complete inventory and exact 30-day manifest expiry;
- SHA-256 missing/modified-entry detection;
- AES-256-GCM payload encryption with fresh wrapped data keys;
- independent envelope authentication and metadata substitution denial;
- private Azure endpoint/container enforcement and conditional publication;
- double Appwrite inventory with source-change rejection;
- Function configuration export excluding environment-variable values;
- target isolation and pre-exposure deletion replay;
- incomplete, corrupted, non-isolated and deletion-unsafe restore denial;
- exact boundary expiry and idempotent cleanup.

## Real-service result

Pending execution on Appwrite Preview plus the permanent private Azure recovery
container. This document must be updated with the safe `RECOVERY_G5_PASSED` output,
commit SHA, workflow run and cleanup result before `TASK-REC-001` is marked `DONE`.
