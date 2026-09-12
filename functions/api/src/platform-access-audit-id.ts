import { createHash } from "node:crypto";

export function createPlatformAccessAuditId(grantId: string, sequence: number): string {
  return `audit_${createHash("sha256")
    .update(`${grantId}:${String(sequence)}`)
    .digest("hex")
    .slice(0, 30)}`;
}
