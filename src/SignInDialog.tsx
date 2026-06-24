import * as Dialog from "@radix-ui/react-dialog";
import { useSignIn } from "@clerk/react/legacy";
import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  LockKeyhole,
  LogIn,
  Mail,
  X
} from "lucide-react";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";

type SetActiveFn = (params: { session: string }) => Promise<unknown>;
type AuthStep = "sign-in" | "reset-request" | "reset-code";

const stepCopy: Record<AuthStep, { title: string; description: string }> = {
  "sign-in": {
    title: "Sign in",
    description: "Use your Covenants admin account credentials to continue."
  },
  "reset-request": {
    title: "Reset password",
    description: "Enter your email and we will send a reset code."
  },
  "reset-code": {
    title: "Choose a new password",
    description: "Enter the code from your email and set a new password."
  }
};

function getClerkErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "errors" in error &&
    Array.isArray((error as { errors?: unknown }).errors)
  ) {
    const [firstError] = (error as {
      errors: Array<{ longMessage?: string; message?: string }>;
    }).errors;
    return firstError?.longMessage ?? firstError?.message ?? "Unable to sign in.";
  }

  return error instanceof Error ? error.message : "Unable to sign in.";
}

async function activateSession(setActive: SetActiveFn | undefined, sessionId: string | null) {
  if (setActive && sessionId) {
    await setActive({ session: sessionId });
  }
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="auth-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function StatusMessage({
  message,
  tone
}: {
  message: string | null;
  tone: "error" | "success";
}) {
  if (!message) {
    return null;
  }

  return <div className={`auth-status ${tone}`}>{message}</div>;
}

export default function SignInDialog() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<AuthStep>("sign-in");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function reset() {
    setStep("sign-in");
    setIdentifier("");
    setPassword("");
    setResetCode("");
    setResetPassword("");
    setMessage(null);
    setError(null);
    setIsSubmitting(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      reset();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isLoaded || !signIn) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await signIn.create({
        identifier: identifier.trim(),
        password,
        strategy: "password",
        signUpIfMissing: false
      });

      if (result.status === "complete") {
        await activateSession(setActive, result.createdSessionId);
        setOpen(false);
        reset();
        return;
      }

      setError("Additional verification is required to sign in.");
    } catch (caughtError) {
      setError(getClerkErrorMessage(caughtError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isLoaded || !signIn) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      await signIn.create({
        identifier: identifier.trim(),
        strategy: "reset_password_email_code",
        signUpIfMissing: false
      });
      setStep("reset-code");
      setMessage(`We sent a reset code to ${identifier.trim()}.`);
    } catch (caughtError) {
      setError(getClerkErrorMessage(caughtError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isLoaded || !signIn) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const result = await signIn.attemptFirstFactor({
        strategy: "reset_password_email_code",
        code: resetCode.trim(),
        password: resetPassword
      });

      if (result.status === "complete") {
        await activateSession(setActive, result.createdSessionId);
        setOpen(false);
        reset();
        return;
      }

      setMessage("Password reset. Please sign in to finish authentication.");
      setStep("sign-in");
      setPassword("");
    } catch (caughtError) {
      setError(getClerkErrorMessage(caughtError));
    } finally {
      setIsSubmitting(false);
    }
  }

  function goToReset() {
    setStep("reset-request");
    setPassword("");
    setResetCode("");
    setResetPassword("");
    setError(null);
    setMessage(null);
  }

  function goToSignIn() {
    setStep("sign-in");
    setError(null);
    setMessage(null);
  }

  const copy = stepCopy[step];
  const isResetFlow = step !== "sign-in";

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger asChild>
        <button className="auth-primary-button auth-trigger" type="button">
          Sign in
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="auth-dialog-overlay" />
        <Dialog.Content className="auth-dialog-content">
          <Dialog.Close className="auth-dialog-close" aria-label="Close">
            <X aria-hidden="true" size={16} />
          </Dialog.Close>

          <header className="auth-flow-header">
            <div className="auth-flow-icon">
              {isResetFlow ? <KeyRound size={20} /> : <LogIn size={20} />}
            </div>
            <div>
              <Dialog.Title>{copy.title}</Dialog.Title>
              <Dialog.Description>{copy.description}</Dialog.Description>
            </div>
          </header>

          {step === "sign-in" ? (
            <form className="auth-form-shell" onSubmit={handleSubmit}>
              <div className="auth-flow-body">
                <Field label="Email">
                  <div className="auth-input-wrap">
                    <Mail aria-hidden="true" size={16} />
                    <input
                      autoComplete="email"
                      onChange={(event) => setIdentifier(event.target.value)}
                      placeholder="you@company.com"
                      required
                      value={identifier}
                    />
                  </div>
                </Field>

                <Field label="Password">
                  <div className="auth-input-wrap">
                    <LockKeyhole aria-hidden="true" size={16} />
                    <input
                      autoComplete="current-password"
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="Password"
                      required
                      type="password"
                      value={password}
                    />
                  </div>
                </Field>

                <div className="auth-link-row">
                  <button className="auth-link-button" type="button" onClick={goToReset}>
                    Forgot password?
                  </button>
                </div>

                <StatusMessage message={message} tone="success" />
                <StatusMessage message={error} tone="error" />
              </div>

              <div className="auth-flow-actions">
                <button
                  className="auth-primary-button auth-submit"
                  type="submit"
                  disabled={!isLoaded || isSubmitting}
                >
                  <LogIn aria-hidden="true" size={16} />
                  {isSubmitting ? "Signing in..." : "Sign in"}
                </button>
              </div>
            </form>
          ) : null}

          {step === "reset-request" ? (
            <form className="auth-form-shell" onSubmit={handleResetRequest}>
              <div className="auth-flow-body">
                <Field label="Email">
                  <div className="auth-input-wrap">
                    <Mail aria-hidden="true" size={16} />
                    <input
                      autoComplete="email"
                      onChange={(event) => setIdentifier(event.target.value)}
                      placeholder="you@company.com"
                      required
                      value={identifier}
                    />
                  </div>
                </Field>

                <StatusMessage message={message} tone="success" />
                <StatusMessage message={error} tone="error" />
              </div>

              <div className="auth-flow-actions auth-action-stack">
                <button
                  className="auth-primary-button auth-submit"
                  type="submit"
                  disabled={!isLoaded || isSubmitting}
                >
                  <KeyRound aria-hidden="true" size={16} />
                  {isSubmitting ? "Sending code..." : "Send reset code"}
                </button>
                <button
                  className="auth-ghost-button"
                  type="button"
                  disabled={isSubmitting}
                  onClick={goToSignIn}
                >
                  <ArrowLeft aria-hidden="true" size={16} />
                  Back to sign in
                </button>
              </div>
            </form>
          ) : null}

          {step === "reset-code" ? (
            <form className="auth-form-shell" onSubmit={handleResetSubmit}>
              <div className="auth-flow-body">
                <StatusMessage
                  message={
                    message ??
                    "Check your inbox for the reset code before choosing a new password."
                  }
                  tone="success"
                />

                <Field label="Reset code">
                  <input
                    className="auth-input"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    onChange={(event) => setResetCode(event.target.value)}
                    placeholder="Enter reset code"
                    required
                    value={resetCode}
                  />
                </Field>

                <Field label="New password">
                  <div className="auth-input-wrap">
                    <LockKeyhole aria-hidden="true" size={16} />
                    <input
                      autoComplete="new-password"
                      minLength={8}
                      onChange={(event) => setResetPassword(event.target.value)}
                      placeholder="At least 8 characters"
                      required
                      type="password"
                      value={resetPassword}
                    />
                  </div>
                </Field>

                <StatusMessage message={error} tone="error" />
              </div>

              <div className="auth-flow-actions auth-action-stack">
                <button
                  className="auth-primary-button auth-submit"
                  type="submit"
                  disabled={!isLoaded || isSubmitting}
                >
                  <CheckCircle2 aria-hidden="true" size={16} />
                  {isSubmitting ? "Resetting password..." : "Reset password"}
                </button>
                <button
                  className="auth-ghost-button"
                  type="button"
                  disabled={isSubmitting}
                  onClick={goToReset}
                >
                  Use a different account
                </button>
              </div>
            </form>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
