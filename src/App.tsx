import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";

import type { AuthStatusResponse, AuthorizedUser } from "../shared/types";
import AdminConsole from "./AdminConsole";
import { supabase } from "./supabase";

interface CredentialsState {
  email: string;
  password: string;
}

export default function App() {
  const [credentials, setCredentials] = useState<CredentialsState>({ email: "", password: "" });
  const [accessToken, setAccessToken] = useState("");
  const [currentUser, setCurrentUser] = useState<AuthorizedUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession().then(async ({ data, error }) => {
      if (!active) {
        return;
      }

      if (error) {
        setAuthError(error.message);
        setBooting(false);
        return;
      }

      if (!data.session) {
        setBooting(false);
        return;
      }

      await hydrateAuthorizedUser(data.session, active);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) {
        return;
      }

      if (!session) {
        setAccessToken("");
        setCurrentUser(null);
        setBooting(false);
        return;
      }

      void hydrateAuthorizedUser(session, active);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function hydrateAuthorizedUser(session: Session, active: boolean) {
    try {
      setBooting(true);
      setAuthError("");

      const user = await fetchAuthorizedUser(session.access_token);

      if (!active) {
        return;
      }

      setAccessToken(session.access_token);
      setCurrentUser(user);
    } catch (error) {
      if (!active) {
        return;
      }

      const message = getErrorMessage(error);
      setAccessToken("");
      setCurrentUser(null);
      setAuthError(message);
      await supabase.auth.signOut();
    } finally {
      if (active) {
        setBooting(false);
      }
    }
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      setSigningIn(true);
      setAuthError("");

      const { data, error } = await supabase.auth.signInWithPassword({
        email: credentials.email.trim(),
        password: credentials.password
      });

      if (error) {
        throw error;
      }

      if (!data.session) {
        throw new Error("No session was returned from Supabase.");
      }

      const user = await fetchAuthorizedUser(data.session.access_token);
      setAccessToken(data.session.access_token);
      setCurrentUser(user);
      setCredentials((current) => ({ ...current, password: "" }));
    } catch (error) {
      setAccessToken("");
      setCurrentUser(null);
      setAuthError(getErrorMessage(error));
      await supabase.auth.signOut();
    } finally {
      setSigningIn(false);
      setBooting(false);
    }
  }

  async function handleSignOut() {
    setAuthError("");
    await supabase.auth.signOut();
    setAccessToken("");
    setCurrentUser(null);
  }

  if (booting) {
    return <div className="shell loading-screen">Checking secure session…</div>;
  }

  if (!accessToken || !currentUser) {
    return (
      <div className="auth-shell">
        <section className="auth-panel">
          <p className="eyebrow">Authorized Access</p>
          <h1>Sign in to Covenants Control Room</h1>
          <p className="auth-copy">
            Only users who exist in <code>public.users</code> and have an allowed admin role can access this platform.
          </p>

          <form className="auth-form" onSubmit={(event) => void handleSignIn(event)}>
            <label className="field">
              <span>Email</span>
              <input
                autoComplete="email"
                onChange={(event) =>
                  setCredentials((current) => ({
                    ...current,
                    email: event.target.value
                  }))
                }
                type="email"
                value={credentials.email}
              />
            </label>

            <label className="field">
              <span>Password</span>
              <input
                autoComplete="current-password"
                onChange={(event) =>
                  setCredentials((current) => ({
                    ...current,
                    password: event.target.value
                  }))
                }
                type="password"
                value={credentials.password}
              />
            </label>

            {authError ? <p className="banner error">{authError}</p> : null}

            <button className="primary-button" disabled={signingIn} type="submit">
              {signingIn ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </section>
      </div>
    );
  }

  return <AdminConsole accessToken={accessToken} currentUser={currentUser} onSignOut={handleSignOut} />;
}

async function fetchAuthorizedUser(accessToken: string): Promise<AuthorizedUser> {
  const response = await fetch("/api/auth/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  const data = (await response.json()) as Partial<AuthStatusResponse> & { error?: string };

  if (!response.ok || !data.user) {
    throw new Error(data.error ?? "Could not validate your access.");
  }

  return data.user;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}
