import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RouteBoundary } from "./RouteBoundary";

describe("lazy route boundary", () => {
  it("offers an explicit reload when a deployed chunk cannot load", async () => {
    const retry = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    function BrokenRoute(): never {
      throw new Error("chunk unavailable");
    }

    render(
      <RouteBoundary locale="fr" reload={retry}>
        <BrokenRoute />
      </RouteBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Cette partie de l’application n’a pas pu être chargée.",
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Recharger l’application" }));
    expect(retry).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
