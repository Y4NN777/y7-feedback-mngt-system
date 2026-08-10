import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("root orientation", () => {
  it("BDD-ROOT-001 shows exactly the three French intents without enumeration", () => {
    render(<App />);

    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.getByRole("heading", { name: "Donner un avis" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Retrouver un avis" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Espace équipe" })).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByText("WiseMoney")).not.toBeInTheDocument();
  });

  it("BDD-ROOT-002 switches to English and updates the document language", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "English" }));

    expect(screen.getByRole("heading", { name: "Give feedback" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Retrieve feedback" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Team workspace" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");

    await user.click(screen.getByRole("button", { name: "Français" }));

    expect(screen.getByRole("heading", { name: "Donner un avis" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("fr");
  });
});
