import type { ServerConfig } from "@y7-feedback/config/server";

import { createProofProtector } from "../../proof-crypto.js";
import { createSensitiveDataProtector } from "../../sensitive-data-protector.js";

export function composeApplicationSecurity(config: ServerConfig) {
  return {
    proofProtector: createProofProtector(
      Buffer.from(config.accessProofEnvelopeKey, "base64url"),
    ),
    sensitivePersistence: {
      environment: config.environment,
      protector: createSensitiveDataProtector(
        config.sensitiveDataActiveKeyId,
        Object.entries(config.sensitiveDataEnvelopeKeys).map(([id, material]) => ({
          id,
          material: Buffer.from(material, "base64url"),
        })),
      ),
    },
  };
}
