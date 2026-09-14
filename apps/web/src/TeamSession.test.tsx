import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AdministrationSession } from "./AdministrationSession";
import { TeamSessionBoundary, TeamSessionShell } from "./TeamSession";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function session(
  current: AdministrationSession["current"],
  signIn: AdministrationSession["signIn"] = () => Promise.resolve("authenticated"),
) {
  return {
    createJwt: () => Promise.resolve("jwt"),
    current,
    signIn: vi.fn(signIn),
    signOut: vi.fn(() => Promise.resolve()),
  } satisfies AdministrationSession;
}

describe("Team session boundary", () => {
  it("shows only a neutral loading state until Appwrite restores the session", async () => {
    const restoration = deferred<"authenticated" | "anonymous">();
    render(
      <TeamSessionBoundary locale="fr" session={session(() => restoration.promise)}>
        <p>Protected team content</p>
      </TeamSessionBoundary>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Vérification de la session");
    expect(screen.queryByText("Protected team content")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Adresse e-mail")).not.toBeInTheDocument();

    restoration.resolve("authenticated");
    expect(await screen.findByText("Protected team content")).toBeVisible();
  });

  it("preserves credentials across locale changes and authenticates once", async () => {
    const target = session(() => Promise.resolve("anonymous"));
    const user = userEvent.setup();
    function Harness() {
      const [locale, setLocale] = useState<"fr" | "en">("fr");
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setLocale("en");
            }}
          >
            English
          </button>
          <TeamSessionBoundary locale={locale} session={target}>
            <p>Protected team content</p>
          </TeamSessionBoundary>
        </>
      );
    }
    render(<Harness />);

    const email = await screen.findByLabelText("Adresse e-mail");
    await user.type(email, "owner@example.test");
    await user.type(screen.getByLabelText("Mot de passe"), "password");
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByLabelText("Email address")).toHaveValue("owner@example.test");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(target.signIn).toHaveBeenCalledWith("owner@example.test", "password");
    expect(await screen.findByText("Protected team content")).toBeVisible();
  });

  it("fails closed on denial and clears protected content after sign-out", async () => {
    const target = session(
      () => Promise.resolve("anonymous"),
      () => Promise.resolve("denied"),
    );
    const user = userEvent.setup();
    render(
      <TeamSessionBoundary locale="fr" session={target}>
        <p>Protected team content</p>
      </TeamSessionBoundary>,
    );

    await user.type(await screen.findByLabelText("Adresse e-mail"), "x@y.test");
    await user.type(screen.getByLabelText("Mot de passe"), "bad");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Accès refusé");
    expect(screen.queryByText("Protected team content")).not.toBeInTheDocument();

    target.signIn.mockResolvedValueOnce("authenticated");
    await user.type(screen.getByLabelText("Mot de passe"), "good");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    expect(await screen.findByText("Protected team content")).toBeVisible();
    target.signOut.mockRejectedValueOnce(new Error("already expired"));
    await user.click(screen.getByRole("button", { name: "Se déconnecter" }));
    expect(target.signOut).toHaveBeenCalledOnce();
    expect(await screen.findByLabelText("Adresse e-mail")).toBeVisible();
    expect(screen.queryByText("Protected team content")).not.toBeInTheDocument();
  });

  it("ignores a restoration result after the provider unmounts", () => {
    const restoration = deferred<"authenticated" | "anonymous">();
    const view = render(
      <TeamSessionBoundary locale="en" session={session(() => restoration.promise)}>
        <p>Protected team content</p>
      </TeamSessionBoundary>,
    );
    view.unmount();
    restoration.resolve("authenticated");
    expect(screen.queryByText("Protected team content")).not.toBeInTheDocument();
  });

  it("rejects a shell rendered outside its provider", () => {
    expect(() =>
      render(<TeamSessionShell locale="en">content</TeamSessionShell>),
    ).toThrow("TEAM_SESSION_PROVIDER_REQUIRED");
  });

  it("restores an authenticated session once and preserves it across team navigation", async () => {
    const current = vi.fn(() => Promise.resolve("authenticated" as const));
    const target = session(current);
    const user = userEvent.setup();
    function Harness() {
      const [route, setRoute] = useState("workbench");
      return (
        <TeamSessionBoundary locale="en" session={target}>
          <button
            type="button"
            onClick={() => {
              setRoute("intelligence");
            }}
          >
            Intelligence
          </button>
          <p>{route}</p>
        </TeamSessionBoundary>
      );
    }
    render(<Harness />);

    expect(await screen.findByText("workbench")).toBeVisible();
    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Intelligence" }));
    expect(screen.getByText("intelligence")).toBeVisible();
    expect(current).toHaveBeenCalledOnce();
  });
});
