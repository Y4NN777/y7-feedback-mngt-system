import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";

import type { Locale } from "@y7-feedback/domain";

import type { AdministrationSession } from "./AdministrationSession";

type TeamSessionState = "loading" | "anonymous" | "authenticated";

interface TeamSessionValue {
  readonly state: TeamSessionState;
  readonly signIn: (
    email: string,
    password: string,
  ) => Promise<"authenticated" | "denied">;
  readonly signOut: () => Promise<void>;
}

const TeamSessionContext = createContext<TeamSessionValue | undefined>(undefined);

function TeamSessionProvider({
  children,
  session,
}: {
  readonly children: ReactNode;
  readonly session: AdministrationSession;
}) {
  const [state, setState] = useState<TeamSessionState>("loading");

  useEffect(() => {
    let active = true;
    void session.current().then((result) => {
      if (active) {
        setState((current) => (current === "loading" ? result : current));
      }
    });
    return () => {
      active = false;
    };
  }, [session]);

  const value = useMemo<TeamSessionValue>(
    () => ({
      state,
      async signIn(email, password) {
        const result = await session.signIn(email, password);
        setState(result === "authenticated" ? "authenticated" : "anonymous");
        return result;
      },
      async signOut() {
        setState("loading");
        try {
          await session.signOut();
        } catch {
          // Local access still closes when the remote session is already expired.
        } finally {
          setState("anonymous");
        }
      },
    }),
    [session, state],
  );

  return (
    <TeamSessionContext.Provider value={value}>{children}</TeamSessionContext.Provider>
  );
}

function useTeamSession(): TeamSessionValue {
  const value = useContext(TeamSessionContext);
  if (value === undefined) throw new Error("TEAM_SESSION_PROVIDER_REQUIRED");
  return value;
}

const copy = {
  fr: {
    authenticated: "Session active.",
    denied: "Accès refusé.",
    email: "Adresse e-mail",
    loading: "Vérification de la session…",
    password: "Mot de passe",
    signIn: "Se connecter",
    signOut: "Se déconnecter",
  },
  en: {
    authenticated: "Team session active.",
    denied: "Access denied.",
    email: "Email address",
    loading: "Checking session…",
    password: "Password",
    signIn: "Sign in",
    signOut: "Sign out",
  },
} as const;

export function TeamSessionShell({
  children,
  locale,
  onSignedOut,
}: {
  readonly children: ReactNode;
  readonly locale: Locale;
  readonly onSignedOut?: () => void;
}) {
  const session = useTeamSession();
  const messages = copy[locale];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [denied, setDenied] = useState(false);

  async function signIn(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await session.signIn(email, password);
    setPassword("");
    setDenied(result !== "authenticated");
  }

  if (session.state === "loading") {
    return <p role="status">{messages.loading}</p>;
  }
  if (session.state === "anonymous") {
    return (
      <form
        className="administration-form"
        onSubmit={(event) => {
          void signIn(event);
        }}
      >
        <label>
          {messages.email}
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </label>
        <label>
          {messages.password}
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </label>
        <button type="submit">{messages.signIn}</button>
        {denied ? <p role="alert">{messages.denied}</p> : null}
      </form>
    );
  }
  return (
    <>
      <div className="session-banner">
        <p>{messages.authenticated}</p>
        <button
          type="button"
          onClick={() => {
            void session.signOut().then(onSignedOut);
          }}
        >
          {messages.signOut}
        </button>
      </div>
      {children}
    </>
  );
}

export function TeamSessionBoundary({
  children,
  locale,
  onSignedOut,
  session,
}: {
  readonly children: ReactNode;
  readonly locale: Locale;
  readonly onSignedOut?: () => void;
  readonly session: AdministrationSession;
}) {
  return (
    <TeamSessionProvider session={session}>
      <TeamSessionShell locale={locale} {...(onSignedOut ? { onSignedOut } : {})}>
        {children}
      </TeamSessionShell>
    </TeamSessionProvider>
  );
}
