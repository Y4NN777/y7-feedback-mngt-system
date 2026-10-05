import { describe, expect, it, vi } from "vitest";

const nodeSdk = vi.hoisted(() => ({
  get: vi.fn(() => Promise.resolve({ $id: "node-user" })),
}));

vi.mock("node-appwrite", () => ({
  Client: class {
    setEndpoint() {
      return this;
    }
    setProject() {
      return this;
    }
    setJWT() {
      return this;
    }
  },
  Account: class {
    get = nodeSdk.get;
  },
}));

import {
  createAppwritePrincipalVerifier,
  createNodeAppwritePrincipalVerifier,
  type AppwriteAccountFactory,
} from "./appwrite-principal-verifier";

const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLWEifQ.signature";

function setup(account: unknown = { $id: "user-a" }) {
  const get = vi.fn(() => Promise.resolve(account));
  const accountFactory = vi.fn<AppwriteAccountFactory>(() => ({ get }));
  return {
    verifier: createAppwritePrincipalVerifier(accountFactory),
    accountFactory,
    get,
  };
}

describe("Appwrite principal verification", () => {
  it("BDD-AUTH-PRINCIPAL-001 derives only the authoritative Account identity", async () => {
    const target = setup();

    await expect(target.verifier.verify(jwt)).resolves.toEqual({
      status: "verified",
      principalId: "user-a",
    });
    expect(target.accountFactory).toHaveBeenCalledWith(jwt);
    expect(target.get).toHaveBeenCalledOnce();
  });

  it.each(["", "not-a-jwt", "a.b", "a.b.c.d", "a b.c.d", `${"a".repeat(4_096)}.b.c`])(
    "denies malformed JWT %j before creating a client",
    async (candidate) => {
      const target = setup();
      await expect(target.verifier.verify(candidate)).resolves.toEqual({
        status: "denied",
      });
      expect(target.accountFactory).not.toHaveBeenCalled();
    },
  );

  it.each([null, {}, { $id: "" }, { $id: "bad/id" }, { $id: "a".repeat(37) }])(
    "fails closed on malformed Account result %#",
    async (account) => {
      const target = setup(account);
      await expect(target.verifier.verify(jwt)).resolves.toEqual({
        status: "retryable",
      });
    },
  );

  it.each([401, 403])(
    "maps Appwrite authentication code %i to denial",
    async (code) => {
      const target = setup();
      target.get.mockRejectedValueOnce({ code, message: "private auth detail" });
      await expect(target.verifier.verify(jwt)).resolves.toEqual({
        status: "denied",
      });
    },
  );

  it("maps factory, network, and unknown failures to one retryable result", async () => {
    const factoryFailure = setup();
    factoryFailure.accountFactory.mockImplementationOnce(() => {
      throw new Error("private client detail");
    });
    await expect(factoryFailure.verifier.verify(jwt)).resolves.toEqual({
      status: "retryable",
    });

    const getFailure = setup();
    getFailure.get.mockRejectedValueOnce(new Error("private network detail"));
    await expect(getFailure.verifier.verify(jwt)).resolves.toEqual({
      status: "retryable",
    });
  });

  it("adapts a JWT-bound Node Appwrite Account client", async () => {
    const verifier = createNodeAppwritePrincipalVerifier({
      endpoint: "https://fra.cloud.appwrite.io/v1",
      projectId: "feedback-preview",
    });
    await expect(verifier.verify(jwt)).resolves.toEqual({
      status: "verified",
      principalId: "node-user",
    });
    expect(nodeSdk.get).toHaveBeenCalledOnce();
  });

  it.each([
    { endpoint: "not-a-url", projectId: "feedback" },
    { endpoint: "http://remote.example/v1", projectId: "feedback" },
    { endpoint: "https://user@example.test/v1", projectId: "feedback" },
    { endpoint: "https://example.test/v1", projectId: "bad/id" },
  ])("rejects unsafe Node Appwrite configuration %#", (config) => {
    expect(() => createNodeAppwritePrincipalVerifier(config)).toThrow(
      "APPWRITE_PRINCIPAL_CONFIG_INVALID",
    );
  });
});
