export type OfflineEnvironment = "preview" | "production";

export interface OfflineScope {
  readonly environment: OfflineEnvironment;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly proofContextDigest?: string;
}

export interface OfflineOperationInput {
  readonly clientOperationId: string;
  readonly kind: "intake" | "attachment" | "message" | "lifecycle";
  readonly payloadDigest: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly dependencies: readonly string[];
}

export interface OfflineOperation extends OfflineOperationInput {
  readonly sequence: number;
  readonly status: "queued" | "processing" | "conflict";
  readonly attempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class OfflineStoreError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "OfflineStoreError";
  }
}

interface StoredRecord {
  readonly key: string;
  readonly scope: string;
}

interface StoredDraft extends StoredRecord {
  readonly id: string;
  readonly version: number;
  readonly updatedAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

interface StoredBlob extends StoredRecord {
  readonly id: string;
  readonly value: Blob;
  readonly size: number;
}

interface StoredProjection extends StoredRecord {
  readonly id: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly updatedAt: string;
}

interface StoredOperation extends StoredRecord, OfflineOperation {
  readonly id: string;
}

const databaseVersion = 1;
const stores = ["drafts", "blobs", "projections", "outbox"] as const;
const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const digest = /^sha256[_:-][A-Za-z0-9_-]{8,128}$/u;
const prohibited = /^(accessproof|proof|authorization|token|credential|secret)$/iu;
const maximumBlobSize = 10 * 1024 * 1024;

function validScope(scope: OfflineScope): boolean {
  const environment: unknown = scope.environment;
  return (
    (environment === "preview" || environment === "production") &&
    identifier.test(scope.workspaceId) &&
    identifier.test(scope.projectId) &&
    identifier.test(scope.actorId) &&
    (scope.proofContextDigest === undefined || digest.test(scope.proofContextDigest))
  );
}

function scopeKey(scope: OfflineScope): string {
  if (!validScope(scope)) throw new OfflineStoreError("OFFLINE_SCOPE_INVALID");
  return [
    scope.environment,
    scope.workspaceId,
    scope.projectId,
    scope.actorId,
    scope.proofContextDigest ?? "no-proof-context",
  ].join("\u0000");
}

function safe(value: unknown, seen = new Set<unknown>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((entry) => safe(entry, seen));
  const entries = Object.entries(value as Readonly<Record<string, unknown>>);
  return entries.every(([key, entry]) => !prohibited.test(key) && safe(entry, seen));
}

function payload(value: Readonly<Record<string, unknown>>) {
  if (!safe(value)) throw new OfflineStoreError("OFFLINE_PROHIBITED_DATA");
  return structuredClone(value);
}

function request<T>(input: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    input.onsuccess = () => {
      resolve(input.result);
    };
    input.onerror = () => {
      reject(new OfflineStoreError("OFFLINE_STORAGE_FAILED"));
    };
  });
}

function completion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onerror = () => {
      reject(new OfflineStoreError("OFFLINE_STORAGE_FAILED"));
    };
    transaction.onabort = () => {
      reject(new OfflineStoreError("OFFLINE_STORAGE_FAILED"));
    };
  });
}

function open(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const input = indexedDB.open(name, databaseVersion);
    input.onupgradeneeded = () => {
      for (const name of stores) {
        if (input.result.objectStoreNames.contains(name)) continue;
        const store = input.result.createObjectStore(name, { keyPath: "key" });
        store.createIndex("scope", "scope", { unique: false });
      }
    };
    input.onsuccess = () => {
      resolve(input.result);
    };
    input.onerror = () => {
      reject(new OfflineStoreError("OFFLINE_OPEN_FAILED"));
    };
    input.onblocked = () => {
      reject(new OfflineStoreError("OFFLINE_UPGRADE_BLOCKED"));
    };
  });
}

function key(scope: string, id: string): string {
  if (!identifier.test(id)) throw new OfflineStoreError("OFFLINE_ID_INVALID");
  return `${scope}\u0001${id}`;
}

export function createIndexedDbOfflineStore(input: {
  readonly databaseName?: string;
  readonly now?: () => string;
}) {
  const databaseName = input.databaseName ?? "y7-feedback-offline";
  if (!identifier.test(databaseName))
    throw new OfflineStoreError("OFFLINE_NAME_INVALID");
  const now = input.now ?? (() => new Date().toISOString());
  let connection: Promise<IDBDatabase> | undefined;
  const database = () => (connection ??= open(databaseName));
  const read = async <T>(storeName: (typeof stores)[number], recordKey: string) => {
    const db = await database();
    const transaction = db.transaction(storeName, "readonly");
    return (await request(transaction.objectStore(storeName).get(recordKey))) as
      T | undefined;
  };
  const write = async (storeName: (typeof stores)[number], value: StoredRecord) => {
    const db = await database();
    const transaction = db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    await completion(transaction);
  };
  return {
    async saveDraft(
      scope: OfflineScope,
      id: string,
      value: Readonly<Record<string, unknown>>,
    ) {
      const partition = scopeKey(scope);
      const recordKey = key(partition, id);
      const prior = await read<StoredDraft>("drafts", recordKey);
      const record: StoredDraft = {
        key: recordKey,
        scope: partition,
        id,
        version: (prior?.version ?? 0) + 1,
        updatedAt: now(),
        payload: payload(value),
      };
      await write("drafts", record);
      return record;
    },
    async loadDraft(scope: OfflineScope, id: string) {
      return (await read<StoredDraft>("drafts", key(scopeKey(scope), id))) ?? null;
    },
    async putBlob(scope: OfflineScope, id: string, value: Blob) {
      if (value.size > maximumBlobSize)
        throw new OfflineStoreError("OFFLINE_BLOB_SIZE");
      const partition = scopeKey(scope);
      const db = await database();
      const transaction = db.transaction("blobs", "readwrite");
      const target = transaction.objectStore("blobs");
      const count = await request(target.index("scope").count(partition));
      const recordKey = key(partition, id);
      const existing = await request(target.getKey(recordKey));
      if (existing === undefined && count >= 5) {
        transaction.abort();
        try {
          await completion(transaction);
        } catch {
          // The bounded rejection is the public outcome.
        }
        throw new OfflineStoreError("OFFLINE_BLOB_LIMIT");
      }
      const record: StoredBlob = {
        key: recordKey,
        scope: partition,
        id,
        value,
        size: value.size,
      };
      target.put(record);
      await completion(transaction);
    },
    async saveProjection(
      scope: OfflineScope,
      id: string,
      value: Readonly<Record<string, unknown>>,
    ) {
      const partition = scopeKey(scope);
      const record: StoredProjection = {
        key: key(partition, id),
        scope: partition,
        id,
        payload: payload(value),
        updatedAt: now(),
      };
      await write("projections", record);
    },
    async enqueue(scope: OfflineScope, value: OfflineOperationInput) {
      const partition = scopeKey(scope);
      const safePayload = payload(value.payload);
      if (
        !identifier.test(value.clientOperationId) ||
        !digest.test(value.payloadDigest) ||
        value.dependencies.some((dependency) => !identifier.test(dependency))
      )
        throw new OfflineStoreError("OFFLINE_OPERATION_INVALID");
      const recordKey = key(partition, value.clientOperationId);
      const prior = await read<StoredOperation>("outbox", recordKey);
      if (prior) {
        if (prior.payloadDigest !== value.payloadDigest)
          throw new OfflineStoreError("OFFLINE_OPERATION_CONFLICT");
        return { ...prior, replayed: true as const };
      }
      const current = now();
      const existing = await this.listOperations(scope);
      const record: StoredOperation = {
        key: recordKey,
        scope: partition,
        id: value.clientOperationId,
        ...value,
        payload: safePayload,
        dependencies: [...value.dependencies],
        sequence: (existing.at(-1)?.sequence ?? 0) + 1,
        status: "queued",
        attempts: 0,
        createdAt: current,
        updatedAt: current,
      };
      await write("outbox", record);
      return { ...record, replayed: false as const };
    },
    async listOperations(scope: OfflineScope): Promise<readonly OfflineOperation[]> {
      const partition = scopeKey(scope);
      const db = await database();
      const transaction = db.transaction("outbox", "readonly");
      const rows = (await request(
        transaction.objectStore("outbox").index("scope").getAll(partition),
      )) as StoredOperation[];
      return rows.sort((left, right) => left.sequence - right.sequence);
    },
    async eraseScope(scope: OfflineScope) {
      const partition = scopeKey(scope);
      const db = await database();
      const transaction = db.transaction(stores, "readwrite");
      let deleted = 0;
      for (const name of stores) {
        const target = transaction.objectStore(name);
        const keys = await request(target.index("scope").getAllKeys(partition));
        for (const recordKey of keys) {
          target.delete(recordKey);
          deleted += 1;
        }
      }
      await completion(transaction);
      return { deleted };
    },
    async close() {
      const current = await connection;
      current?.close();
      connection = undefined;
    },
  };
}
