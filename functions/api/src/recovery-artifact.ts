import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes as nodeRandomBytes,
  timingSafeEqual,
} from "node:crypto";

import {
  validateRecoveryManifest,
  type RecoveryDigest,
  type RecoveryEntry,
  type RecoveryEntryKind,
  type RecoveryManifest,
} from "@y7-feedback/domain";

export interface RecoveryArtifact {
  readonly version: 1;
  readonly recoverySetId: string;
  readonly sourceEnvironment: "preview" | "production";
  readonly expiresAt: string;
  readonly encryptionKeyId: string;
  readonly signingKeyId: string;
  readonly wrappedKeyIv: string;
  readonly wrappedKeyTag: string;
  readonly wrappedKey: string;
  readonly payloadIv: string;
  readonly payloadTag: string;
  readonly ciphertext: string;
  readonly signature: string;
}

interface SerializedEntry {
  readonly kind: RecoveryEntryKind;
  readonly path: string;
  readonly bytes: string;
}

interface RecoveryPayload {
  readonly manifest: RecoveryManifest;
  readonly entries: readonly SerializedEntry[];
}

const encoder = new TextEncoder();

function encode(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function base64url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function decode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function assertKey(key: Uint8Array) {
  if (key.byteLength !== 32) throw new Error("RECOVERY_KEY_INVALID");
}

function metadata(artifact: Omit<RecoveryArtifact, "signature">) {
  return {
    version: artifact.version,
    recoverySetId: artifact.recoverySetId,
    sourceEnvironment: artifact.sourceEnvironment,
    expiresAt: artifact.expiresAt,
    encryptionKeyId: artifact.encryptionKeyId,
    signingKeyId: artifact.signingKeyId,
    wrappedKeyIv: artifact.wrappedKeyIv,
    wrappedKeyTag: artifact.wrappedKeyTag,
    wrappedKey: artifact.wrappedKey,
    payloadIv: artifact.payloadIv,
    payloadTag: artifact.payloadTag,
    ciphertext: artifact.ciphertext,
  };
}

function aad(manifest: RecoveryManifest) {
  return encode({
    version: manifest.version,
    recoverySetId: manifest.recoverySetId,
    sourceEnvironment: manifest.sourceEnvironment,
    expiresAt: manifest.expiresAt,
    encryptionKeyId: manifest.encryptionKeyId,
    signingKeyId: manifest.signingKeyId,
  });
}

function encrypt(
  plaintext: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  associatedData: Uint8Array,
) {
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(associatedData);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, tag: cipher.getAuthTag() };
}

function decrypt(
  ciphertext: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  tag: Uint8Array,
  associatedData: Uint8Array,
) {
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(associatedData);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function createRecoveryArtifact(input: {
  readonly manifest: RecoveryManifest;
  readonly entries: readonly RecoveryEntry[];
  readonly encryptionKey: Uint8Array;
  readonly signingKey: Uint8Array;
  readonly randomBytes?: (length: number) => Uint8Array;
}): RecoveryArtifact {
  assertKey(input.encryptionKey);
  assertKey(input.signingKey);
  const random = input.randomBytes ?? nodeRandomBytes;
  const dataKey = random(32);
  const payloadIv = random(12);
  const wrappedKeyIv = random(12);
  if (
    dataKey.byteLength !== 32 ||
    payloadIv.byteLength !== 12 ||
    wrappedKeyIv.byteLength !== 12
  )
    throw new Error("RECOVERY_RANDOM_INVALID");
  const payload: RecoveryPayload = {
    manifest: input.manifest,
    entries: [...input.entries]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((entry) => ({
        kind: entry.kind,
        path: entry.path,
        bytes: base64url(entry.bytes),
      })),
  };
  const associatedData = aad(input.manifest);
  const sealedPayload = encrypt(encode(payload), dataKey, payloadIv, associatedData);
  const sealedKey = encrypt(dataKey, input.encryptionKey, wrappedKeyIv, associatedData);
  const unsigned = {
    version: 1 as const,
    recoverySetId: input.manifest.recoverySetId,
    sourceEnvironment: input.manifest.sourceEnvironment,
    expiresAt: input.manifest.expiresAt,
    encryptionKeyId: input.manifest.encryptionKeyId,
    signingKeyId: input.manifest.signingKeyId,
    wrappedKeyIv: base64url(wrappedKeyIv),
    wrappedKeyTag: base64url(sealedKey.tag),
    wrappedKey: base64url(sealedKey.ciphertext),
    payloadIv: base64url(payloadIv),
    payloadTag: base64url(sealedPayload.tag),
    ciphertext: base64url(sealedPayload.ciphertext),
  };
  return {
    ...unsigned,
    signature: createHmac("sha256", input.signingKey)
      .update(encode(metadata(unsigned)))
      .digest("base64url"),
  };
}

export function openRecoveryArtifact(input: {
  readonly artifact: RecoveryArtifact;
  readonly encryptionKey: Uint8Array;
  readonly signingKey: Uint8Array;
}): {
  readonly manifest: RecoveryManifest;
  readonly entries: readonly RecoveryEntry[];
} {
  try {
    assertKey(input.encryptionKey);
    assertKey(input.signingKey);
    const { signature, ...unsigned } = input.artifact;
    const expected = createHmac("sha256", input.signingKey)
      .update(encode(metadata(unsigned)))
      .digest();
    const actual = decode(signature);
    if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected))
      throw new Error("signature");
    const associatedData = encode({
      version: unsigned.version,
      recoverySetId: unsigned.recoverySetId,
      sourceEnvironment: unsigned.sourceEnvironment,
      expiresAt: unsigned.expiresAt,
      encryptionKeyId: unsigned.encryptionKeyId,
      signingKeyId: unsigned.signingKeyId,
    });
    const dataKey = decrypt(
      decode(unsigned.wrappedKey),
      input.encryptionKey,
      decode(unsigned.wrappedKeyIv),
      decode(unsigned.wrappedKeyTag),
      associatedData,
    );
    const plaintext = decrypt(
      decode(unsigned.ciphertext),
      dataKey,
      decode(unsigned.payloadIv),
      decode(unsigned.payloadTag),
      associatedData,
    );
    const payload = JSON.parse(plaintext.toString("utf8")) as RecoveryPayload;
    if (
      payload.manifest.recoverySetId !== unsigned.recoverySetId ||
      payload.manifest.expiresAt !== unsigned.expiresAt ||
      payload.manifest.encryptionKeyId !== unsigned.encryptionKeyId ||
      payload.manifest.signingKeyId !== unsigned.signingKeyId
    )
      throw new Error("metadata");
    const entries = payload.entries.map((entry) => ({
      kind: entry.kind,
      path: entry.path,
      bytes: new Uint8Array(decode(entry.bytes)),
    }));
    const validation = validateRecoveryManifest(
      payload.manifest,
      entries,
      (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`,
    );
    if (validation.status === "valid") return { manifest: payload.manifest, entries };
    throw new Error("inventory");
  } catch {
    throw new Error("RECOVERY_ARTIFACT_INVALID");
  }
}

export interface RecoveryObjectRepository {
  put(
    key: string,
    value: Uint8Array,
    options: { readonly ifAbsent: boolean },
  ): Promise<"stored" | "exists">;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<void>;
}

export async function publishRecoveryArtifact(input: {
  readonly repository: RecoveryObjectRepository;
  readonly artifact: RecoveryArtifact;
  readonly digest: RecoveryDigest;
}): Promise<{
  readonly status: "published" | "replayed";
  readonly recoverySetId: string;
}> {
  const artifactKey = `generations/${input.artifact.recoverySetId}.recovery`;
  const markerKey = `complete/${input.artifact.recoverySetId}.json`;
  const serialized = encode(input.artifact);
  const artifactDigest = input.digest(serialized);
  const existingMarker = await input.repository.get(markerKey);
  if (existingMarker) {
    const marker = JSON.parse(Buffer.from(existingMarker).toString("utf8")) as {
      artifactDigest?: string;
    };
    if (marker.artifactDigest !== artifactDigest)
      throw new Error("RECOVERY_GENERATION_CONFLICT");
    return { status: "replayed", recoverySetId: input.artifact.recoverySetId };
  }
  await input.repository.put(artifactKey, serialized, { ifAbsent: true });
  const staged = await input.repository.get(artifactKey);
  if (!staged || input.digest(staged) !== artifactDigest) {
    await input.repository.delete(artifactKey);
    throw new Error("RECOVERY_STAGING_VERIFICATION_FAILED");
  }
  const marker = encode({
    version: 1,
    recoverySetId: input.artifact.recoverySetId,
    sourceEnvironment: input.artifact.sourceEnvironment,
    expiresAt: input.artifact.expiresAt,
    artifactKey,
    artifactDigest,
  });
  const markerResult = await input.repository.put(markerKey, marker, {
    ifAbsent: true,
  });
  if (markerResult === "exists") {
    const winner = await input.repository.get(markerKey);
    if (!winner || Buffer.compare(Buffer.from(winner), Buffer.from(marker)) !== 0)
      throw new Error("RECOVERY_GENERATION_CONFLICT");
    return { status: "replayed", recoverySetId: input.artifact.recoverySetId };
  }
  return { status: "published", recoverySetId: input.artifact.recoverySetId };
}
