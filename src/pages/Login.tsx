import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function Login() {
  const { signIn, session, signInWithGoogle, domainError } = useAuth();
  const [email, setEmail] = useState("team@convertedclick.co.za");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };

  if (session) {
    navigate(loc.state?.from ?? "/", { replace: true });
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    navigate(loc.state?.from ?? "/", { replace: true });
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-m-surface-container-low p-4">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-60"
        style={{
          background:
            "radial-gradient(60% 40% at 20% 10%, hsl(var(--mcolor-primary-container)) 0%, transparent 60%), " +
            "radial-gradient(50% 40% at 80% 90%, hsl(var(--mcolor-tertiary-container)) 0%, transparent 60%)",
        }}
      />
      <Card className="w-full max-w-sm shadow-elev-2">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <img src="/conductor-mark.png" alt="Conductor" className="h-10 w-10 shrink-0 object-contain" />
            <div>
              <div className="text-title-small text-m-on-surface">Conductor</div>
              <div className="text-label-small text-m-on-surface-variant">Service pricing</div>
            </div>
          </div>
          <CardTitle className="text-headline-small">Sign in</CardTitle>
          <CardDescription>Internal team access.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2"
              onClick={async () => {
                setError(null);
                // signInWithOAuth resolves with { error } rather than throwing —
                // unhandled, a disabled provider silently does nothing at all.
                const { error } = await signInWithGoogle();
                if (error) setError(error.message);
              }}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Sign in with Google
            </Button>
            {domainError && (
              <p className="text-body-small text-destructive text-center">
                Only @convertedclick.co.za accounts are allowed.
              </p>
            )}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-m-outline-variant" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-card px-2 text-label-small text-m-on-surface-variant">or</span>
              </div>
            </div>
          </div>
          <form onSubmit={onSubmit} className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && <p className="text-body-small text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
