import { useEffect, useState, type ReactNode } from "react";
import { LogIn } from "lucide-react";
import { authService, type AuthStatus } from "../api/auth";

interface AuthGateProps { children: ReactNode }

export function AuthGate({ children }: AuthGateProps) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  const refresh = async () => {
    try {
      setStatus(await authService.status());
      setUnreachable(false);
    } catch {
      setUnreachable(true);
      setStatus(null);
    }
  };

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const onUnauthorized = () => setStatus((current) => current ? {
      ...current,
      authenticated: false,
      user: null,
    } : current);
    window.addEventListener("kintara-unauthorized", onUnauthorized);
    return () => window.removeEventListener("kintara-unauthorized", onUnauthorized);
  }, []);

  if (unreachable) {
    return (
      <div className="auth-screen">
        <div className="auth-card" role="alert">
          <h1 className="auth-title">Can&rsquo;t reach the Kintara server</h1>
          <p className="auth-subtitle">The web app loaded, but the Kintara API did not answer.</p>
          <button className="btn btn-primary auth-submit" onClick={refresh}>Try again</button>
        </div>
      </div>
    );
  }
  if (!status) return <div className="auth-screen" role="status">Loading…</div>;
  if (status.authenticated) return <>{children}</>;

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <img src="/logo.png" alt="" width={56} height={56} />
        <h1 className="auth-title">{status.needsOwner ? "Claim this Kintara" : "Sign in to Kintara"}</h1>
        <p className="auth-subtitle">
          {status.needsOwner
            ? "The first GitHub account to sign in becomes the owner."
            : "Access is limited to GitHub accounts invited by a Kintara admin."}
        </p>
        {status.oauthConfigured ? (
          <a className="btn btn-primary auth-submit auth-github" href={authService.githubStartUrl()}>
            <LogIn size={18} /> Continue with GitHub
          </a>
        ) : (
          <p className="auth-error" role="alert">
            GitHub login is not configured. Set the GitHub OAuth environment variables on the NAS, then restart Kintara.
          </p>
        )}
      </div>
    </div>
  );
}
