import { Show, SignInButton, SignOutButton, useAuth, useUser } from "@clerk/react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import AdminConsole from "./AdminConsole";

interface AdminMeResponse {
  user: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    role: "admin";
  };
}

export default function App() {
  return (
    <>
      <Show when="signed-out">
        <AuthScreen
          action={
            <SignInButton mode="modal">
              <button className="primary-button auth-action" type="button">
                Sign in
              </button>
            </SignInButton>
          }
          eyebrow="Admin Access"
          title="Covenants Control Room"
          message="Sign in with your authorized admin account to continue."
        />
      </Show>
      <Show when="signed-in">
        <AdminGate />
      </Show>
    </>
  );
}

function AdminGate() {
  const { getToken, isLoaded } = useAuth();
  const { user, isLoaded: isUserLoaded } = useUser();
  const [adminUser, setAdminUser] = useState<AdminMeResponse["user"] | null>(null);
  const [status, setStatus] = useState<"loading" | "authorized" | "forbidden" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!isLoaded || !isUserLoaded || !user) {
      return;
    }

    let cancelled = false;

    async function loadAdminAccess() {
      try {
        setStatus("loading");
        setMessage("");

        const token = await getToken();
        if (!token) {
          throw new Error("You must be signed in to continue.");
        }

        const syncResponse = await fetch("/api/users/sync", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            email: user.primaryEmailAddress?.emailAddress,
            firstName: user.firstName,
            lastName: user.lastName,
            imageUrl: user.imageUrl,
            emailVerified: user.primaryEmailAddress?.verification?.status === "verified"
          })
        });
        const syncData = (await syncResponse.json().catch(() => null)) as
          | { error?: string; details?: string }
          | null;

        if (!syncResponse.ok) {
          throw new Error(syncData?.error ?? "Unable to prepare your account.");
        }

        const response = await fetch("/api/auth/me", {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        const data = (await response.json().catch(() => null)) as
          | (AdminMeResponse & { error?: string; details?: string })
          | null;

        if (!response.ok) {
          const errorMessage = data?.error ?? "Unable to verify admin access.";
          if (!cancelled) {
            setStatus(response.status === 403 ? "forbidden" : "error");
            setMessage(errorMessage);
          }
          return;
        }

        if (!cancelled) {
          setAdminUser(data?.user ?? null);
          setStatus("authorized");
        }
      } catch (error) {
        if (!cancelled) {
          setStatus("error");
          setMessage(error instanceof Error ? error.message : "Unable to verify admin access.");
        }
      }
    }

    void loadAdminAccess();

    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, isUserLoaded, user]);

  if (!isLoaded || !isUserLoaded || status === "loading") {
    return (
      <AuthScreen
        eyebrow="Checking Access"
        title="Verifying admin role"
        message="Confirming your account has access to this admin area."
      />
    );
  }

  if (status === "forbidden") {
    return (
      <AuthScreen
        action={
          <SignOutButton>
            <button className="ghost-button auth-action" type="button">
              Sign out
            </button>
          </SignOutButton>
        }
        eyebrow="Access Denied"
        title="Admin role required"
        message={message || "Your account is signed in, but it is not assigned the admin role."}
      />
    );
  }

  if (status === "error") {
    return (
      <AuthScreen
        action={
          <SignOutButton>
            <button className="ghost-button auth-action" type="button">
              Sign out
            </button>
          </SignOutButton>
        }
        eyebrow="Auth Error"
        title="Could not verify access"
        message={message}
      />
    );
  }

  return <AdminConsole adminUser={adminUser} />;
}

function AuthScreen({
  action,
  eyebrow,
  message,
  title
}: {
  action?: ReactNode;
  eyebrow: string;
  message: string;
  title: string;
}) {
  return (
    <main className="auth-screen">
      <section className="auth-panel">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{message}</p>
        {action ? <div className="auth-actions">{action}</div> : null}
      </section>
    </main>
  );
}
