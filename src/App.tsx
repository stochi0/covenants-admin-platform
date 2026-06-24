import { Show, SignOutButton, useAuth, useUser } from "@clerk/react";
import { LoaderCircle, ShieldCheck, TriangleAlert } from "lucide-react";
import { Component, lazy, Suspense, useEffect, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import type { AdminMeResponse } from "../shared/types";
import SignInDialog from "./SignInDialog";
import { apiRequest, setApiTokenGetter } from "./lib/api";

const AdminConsole = lazy(() => import("./AdminConsole"));

export default function App() {
  return (
    <>
      <Show when="signed-out">
        <AuthScreen
          action={<SignInDialog />}
          eyebrow="Admin Access"
          title="Covenants Admin Platform"
          message="Sign in with your authorized admin account to continue."
          variant="sign-in"
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
  const userId = user?.id;
  const userEmail = user?.primaryEmailAddress?.emailAddress;
  const userFirstName = user?.firstName;
  const userLastName = user?.lastName;
  const userImageUrl = user?.hasImage ? user.imageUrl : null;
  const userEmailVerified = user?.primaryEmailAddress?.verification?.status === "verified";

  useEffect(() => {
    setApiTokenGetter(getToken);
    return () => setApiTokenGetter(null);
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded || !isUserLoaded || !user) {
      return;
    }

    let cancelled = false;

    async function loadAdminAccess() {
      try {
        setStatus((current) => (current === "authorized" ? current : "loading"));
        setMessage("");

        await apiRequest<{ id: string }>("/api/users/sync", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            email: userEmail,
            firstName: userFirstName,
            lastName: userLastName,
            imageUrl: userImageUrl,
            emailVerified: userEmailVerified
          })
        });

        const data = await apiRequest<AdminMeResponse>("/api/auth/me");

        if (!cancelled) {
          setAdminUser(data.user);
          setStatus("authorized");
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Unable to verify admin access.";
          setStatus(message === "Admin access is required." ? "forbidden" : "error");
          setMessage(message);
        }
      }
    }

    void loadAdminAccess();

    return () => {
      cancelled = true;
    };
  }, [
    getToken,
    isLoaded,
    isUserLoaded,
    userId,
    userEmail,
    userFirstName,
    userLastName,
    userImageUrl,
    userEmailVerified
  ]);

  if (!isLoaded || !isUserLoaded || status === "loading") {
    return (
      <AuthScreen
        eyebrow="Checking Access"
        title="Verifying admin role"
        message="Confirming your account has access to this admin area."
        variant="loading"
      />
    );
  }

  if (status === "forbidden") {
    return (
      <AuthScreen
        action={
          <SignOutButton>
            <button className="auth-ghost-button auth-trigger auth-state-action" type="button">
              Sign out
            </button>
          </SignOutButton>
        }
        eyebrow="Access Denied"
        title="Admin role required"
        message={message || "Your account is signed in, but it is not assigned the admin role."}
        variant="forbidden"
      />
    );
  }

  if (status === "error") {
    return (
      <AuthScreen
        action={
          <SignOutButton>
            <button className="auth-ghost-button auth-trigger auth-state-action" type="button">
              Sign out
            </button>
          </SignOutButton>
        }
        eyebrow="Auth Error"
        title="Could not verify access"
        message={message}
        variant="error"
      />
    );
  }

  return (
    <AdminConsoleErrorBoundary>
      <Suspense fallback={<div className="shell loading-screen">Loading admin console...</div>}>
        <AdminConsole adminUser={adminUser} onAdminUserChange={setAdminUser} />
      </Suspense>
    </AdminConsoleErrorBoundary>
  );
}

class AdminConsoleErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Admin console render failed:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <AuthScreen
          action={
            <button
              className="auth-primary-button auth-trigger auth-state-action"
              onClick={() => window.location.reload()}
              type="button"
            >
              Reload admin console
            </button>
          }
          eyebrow="Display Error"
          title="The admin console could not be displayed"
          message="Your data is safe. Reload the page to return to the admin console."
          variant="error"
        />
      );
    }

    return this.props.children;
  }
}

function AuthScreen({
  action,
  eyebrow,
  message,
  title,
  variant = "sign-in"
}: {
  action?: ReactNode;
  eyebrow: string;
  message: string;
  title: string;
  variant?: "sign-in" | "loading" | "forbidden" | "error";
}) {
  const icon =
    variant === "loading" ? (
      <LoaderCircle className="auth-state-spinner" aria-hidden="true" />
    ) : variant === "forbidden" ? (
      <ShieldCheck aria-hidden="true" />
    ) : variant === "error" ? (
      <TriangleAlert aria-hidden="true" />
    ) : null;

  return (
    <main className="auth-screen">
      <div className="auth-screen-background" />
      <section className="auth-panel">
        {icon ? <div className="auth-brand-icon">{icon}</div> : null}
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{message}</p>
        {action ? <div className="auth-actions">{action}</div> : null}
      </section>
    </main>
  );
}
