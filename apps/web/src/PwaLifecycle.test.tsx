import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({
  needRefresh: false,
  offlineReady: false,
  setNeedRefresh: vi.fn(),
  setOfflineReady: vi.fn(),
  updateServiceWorker: vi.fn(() => Promise.resolve()),
}));

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    needRefresh: [lifecycle.needRefresh, lifecycle.setNeedRefresh],
    offlineReady: [lifecycle.offlineReady, lifecycle.setOfflineReady],
    updateServiceWorker: lifecycle.updateServiceWorker,
  }),
}));

import { PwaLifecycle, PwaUpdateNotice } from "./PwaLifecycle";

afterEach(() => {
  cleanup();
  document.documentElement.lang = "fr";
  lifecycle.needRefresh = false;
  lifecycle.offlineReady = false;
  vi.clearAllMocks();
});

describe("PWA update lifecycle", () => {
  it("BDD-PWA-001 stays absent when no lifecycle event needs attention", () => {
    const { container } = render(
      <PwaUpdateNotice
        locale="fr"
        needRefresh={false}
        offlineReady={false}
        onApply={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("BDD-PWA-002 announces offline readiness without forcing a reload", () => {
    render(
      <PwaUpdateNotice
        locale="fr"
        needRefresh={false}
        offlineReady
        onApply={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText(/prête à fonctionner hors ligne/u)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Mettre à jour" })).toBeNull();
  });

  it("BDD-PWA-003 lets the user explicitly apply or defer an English update", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onDismiss = vi.fn();
    render(
      <PwaUpdateNotice
        locale="en"
        needRefresh
        offlineReady={false}
        onApply={onApply}
        onDismiss={onDismiss}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Update now" }));
    await user.click(screen.getByRole("button", { name: "Later" }));
    expect(onApply).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("BDD-PWA-004 registers an explicit update action and follows the document locale", async () => {
    const user = userEvent.setup();
    document.documentElement.lang = "en";
    lifecycle.needRefresh = true;
    const view = render(<PwaLifecycle />);
    await user.click(screen.getByRole("button", { name: "Update now" }));
    expect(lifecycle.updateServiceWorker).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole("button", { name: "Later" }));
    expect(lifecycle.setNeedRefresh).toHaveBeenCalledWith(false);
    expect(lifecycle.setOfflineReady).toHaveBeenCalledWith(false);
    view.unmount();
    lifecycle.needRefresh = false;
    lifecycle.offlineReady = true;
    const localized = render(<PwaLifecycle />);
    expect(screen.getByText(/ready to work offline/u)).toBeVisible();
    document.documentElement.lang = "fr";
    await waitFor(() => {
      expect(screen.getByText(/prête à fonctionner hors ligne/u)).toBeVisible();
    });
    localized.unmount();
  });
});
