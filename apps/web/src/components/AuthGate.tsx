import { useEffect, useState, type ReactNode } from "react";
import { authService, type AuthStatus } from "../api/auth";
import { ApiError } from "../api";

interface AuthGateProps {
  children: ReactNode;
}

/**
 * Stands in front of the app until the caller is signed in.
 *
 * Three states, decided by the server rather than guessed at: a fresh install
 * needs setup, a configured one needs a login, and everything else renders the
 * app. While no password is set the server still serves the library, so the
 * setup form is the only thing standing between a new install and use.
 */
export function AuthGate({ children }: AuthGateProps) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setStatus(await authService.status());
      setUnreachable(false);
    } catch {
      // Rendering the app anyway would give an empty library, a dead Save
      // button, and a console full of noise. Saying so plainly is far more
      // useful than letting every request fail on its own.
      setUnreachable(true);
      setStatus(null);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  // A session can expire while the tab is open, so a 401 from anywhere sends
  // the user back here instead of leaving a silently broken page.
  useEffect(() => {
    const onUnauthorized = () => {
      setStatus({ needsSetup: false, authenticated: false, user: null });
    };
    window.addEventListener("kintara-unauthorized", onUnauthorized);
    return () => window.removeEventListener("kintara-unauthorized", onUnauthorized);
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (status?.needsSetup) {
        await authService.setup(username, password);
      } else {
        await authService.login(username, password);
      }
      setPassword("");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  if (unreachable) {
    return (
      <div className="auth-screen">
        <div className="auth-card" role="alert">
          <h1 className="auth-title">Can&rsquo;t reach the Kintara server</h1>
          <p className="auth-subtitle">
            The app loaded, but the API did not answer. In development this usually means
            the server is not running &mdash; start both with <code>npm run dev</code> from
            the repository root.
          </p>
          <button
            className="btn btn-primary auth-submit"
            onClick={() => {
              setUnreachable(false);
              refresh();
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (status === null) {
    return (
      <div className="auth-screen" role="status" aria-live="polite">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }

  if (status.authenticated) return <>{children}</>;

  const isSetup = status.needsSetup;

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <img src="/logo.png" alt="" width={56} height={56} />
        <h1 className="auth-title">{isSetup ? "Set up Kintara" : "Sign in"}</h1>
        <p className="auth-subtitle">
          {isSetup
            ? "Choose the account you will use to reach your library."
            : "Your library is waiting."}
        </p>

        <label className="auth-label" htmlFor="auth-username">
          Username
        </label>
        <input
          id="auth-username"
          className="input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
          required
        />

        <label className="auth-label" htmlFor="auth-password">
          Password
        </label>
        <input
          id="auth-password"
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={isSetup ? "new-password" : "current-password"}
          minLength={isSetup ? 8 : undefined}
          required
        />
        {isSetup && <p className="auth-hint">At least 8 characters.</p>}

        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}

        <button className="btn btn-primary auth-submit" type="submit" disabled={busy}>
          {busy ? "Working…" : isSetup ? "Create account" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
