import { describe, expect, it, vi } from "vitest";

import {
  createAdministrationSession,
  createAppwriteAdministrationSession,
} from "./AdministrationSession";

function setup() {
  const createEmailPasswordSession = vi.fn(() => Promise.resolve({}));
  const createJWT = vi.fn(() => Promise.resolve({ jwt: "short-lived-jwt" }));
  const deleteSession = vi.fn(() => Promise.resolve({}));
  return {
    createEmailPasswordSession,
    createJWT,
    deleteSession,
    session: createAdministrationSession({
      createEmailPasswordSession,
      createJWT,
      deleteSession,
    }),
  };
}

describe("Appwrite administration session", () => {
  it("builds the browser adapter from public Appwrite coordinates", () => {
    const session = createAppwriteAdministrationSession(
      "https://cloud.appwrite.io/v1",
      "project_1",
    );
    expect(typeof session.createJwt).toBe("function");
    expect(typeof session.signIn).toBe("function");
    expect(typeof session.signOut).toBe("function");
  });

  it("creates a session and obtains a bounded JWT without persisting it", async () => {
    const target = setup();
    await expect(target.session.signIn("owner@example.test", "password")).resolves.toBe(
      "authenticated",
    );
    await expect(target.session.createJwt()).resolves.toBe("short-lived-jwt");
    expect(target.createEmailPasswordSession).toHaveBeenCalledWith({
      email: "owner@example.test",
      password: "password",
    });
  });

  it("fails closed for invalid credentials, SDK denial, or malformed JWT", async () => {
    const target = setup();
    await expect(target.session.signIn("", "password")).resolves.toBe("denied");
    target.createEmailPasswordSession.mockRejectedValueOnce(new Error("denied"));
    await expect(target.session.signIn("owner@example.test", "bad")).resolves.toBe(
      "denied",
    );
    target.createJWT.mockResolvedValueOnce({ jwt: "" });
    await expect(target.session.createJwt()).rejects.toThrow("SESSION_DENIED");
  });

  it("deletes only the current session", async () => {
    const target = setup();
    await target.session.signOut();
    expect(target.deleteSession).toHaveBeenCalledWith({ sessionId: "current" });
  });
});
