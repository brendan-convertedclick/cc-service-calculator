import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Calculator } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function Login() {
  const { signIn, session } = useAuth();
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
            <div className="grid h-10 w-10 place-items-center rounded-md bg-m-primary-container text-m-on-primary-container">
              <Calculator className="h-5 w-5" />
            </div>
            <div>
              <div className="text-title-small text-m-on-surface">CC Calculator</div>
              <div className="text-label-small text-m-on-surface-variant">Service pricing</div>
            </div>
          </div>
          <CardTitle className="text-headline-small">Sign in</CardTitle>
          <CardDescription>Internal team access.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
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
