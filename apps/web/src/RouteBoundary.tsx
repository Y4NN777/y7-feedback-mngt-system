import { Component, Suspense, type ReactNode } from "react";

import type { Locale } from "@y7-feedback/domain";

const copy = {
  fr: {
    error: "Cette partie de l’application n’a pas pu être chargée.",
    loading: "Chargement…",
    reload: "Recharger l’application",
  },
  en: {
    error: "This part of the application could not be loaded.",
    loading: "Loading…",
    reload: "Reload the application",
  },
} as const;

type Props = {
  readonly children: ReactNode;
  readonly locale: Locale;
  readonly reload?: () => void;
};

type State = { readonly failed: boolean };

export class RouteBoundary extends Component<Props, State> {
  public override state: State = { failed: false };

  private readonly reload = (): void => {
    if (this.props.reload) {
      this.props.reload();
      return;
    }
    window.location.reload();
  };

  public static getDerivedStateFromError(): State {
    return { failed: true };
  }

  public override componentDidCatch(): void {
    // The boundary intentionally owns recovery UI; telemetry is added at composition roots.
  }

  public override render(): ReactNode {
    const messages = copy[this.props.locale];
    if (this.state.failed) {
      return (
        <main className="root-page" data-visual-anchor="organic">
          <section role="alert">
            <p>{messages.error}</p>
            <button type="button" onClick={this.reload}>
              {messages.reload}
            </button>
          </section>
        </main>
      );
    }
    return (
      <Suspense fallback={<p role="status">{messages.loading}</p>}>
        {this.props.children}
      </Suspense>
    );
  }
}
