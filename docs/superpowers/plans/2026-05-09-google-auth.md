# Google OAuth Multi-User Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google OAuth sign-in so each team member can log in with their `@convertedclick.co.za` Google account, with auto-provisioning into `team_members` on first sign-in, while keeping the existing email/password fallback.

**Architecture:** `AuthContext` gains `signInWithGoogle`, a domain guard in `onAuthStateChange`, and auto-provisioning logic in the existing `currentUserId` resolver. The Login page gains a Google button and domain-error display above the existing form.

**Tech Stack:** Supabase JS (`supabase.auth.signInWithOAuth`), React, TypeScript, React Testing Library + Vitest.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/context/AuthContext.tsx` | Modify | Add `signInWithGoogle`, `domainError`, domain guard, auto-provisioning |
| `src/pages/Login.tsx` | Modify | Add Google button, "or" divider, domain error message |
| `src/pages/Login.test.tsx` | Create | Render tests for Google button and domain error |

---

## Task 0: Manual prerequisites (no code)

These steps must be done before any code changes are deployed to a real browser. Local dev with `import.meta.env.DEV = true` bypasses auth entirely, so this only matters for a real sign-in test.

- [ ] **Step 1: Create Google OAuth credentials**

  In [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID:
  - Application type: **Web application**
  - Authorised redirect URIs: `https://lpgwxacoqiqpcfpkklib.supabase.co/auth/v1/callback`
  
  Copy the **Client ID** and **Client Secret**.

- [ ] **Step 2: Enable Google provider in Supabase**

  In [Supabase dashboard](https://supabase.com/dashboard/project/lpgwxacoqiqpcfpkklib) → Authentication → Providers → Google:
  - Toggle **Enabled**
  - Paste Client ID and Client Secret
  - Save

- [ ] **Step 3: Add redirect URLs**

  In Supabase dashboard → Authentication → URL Configuration → Redirect URLs:
  - Add `http://localhost:5174`
  - Add production URL when available

---

## Task 1: Update `AuthContext`

**Files:**
- Modify: `src/context/AuthContext.tsx`

- [ ] **Step 1: Add `signInWithGoogle` and `domainError` to the context type**

  Replace the `AuthContextValue` type (lines 9–18) with:

  ```ts
  type AuthContextValue = {
    session: Session | null;
    user: Session["user"] | null;
    loading: boolean;
    domainError: boolean;
    /** team_members.id resolved from the signed-in auth.users email. */
    currentUserId: string | null;
    signIn: (email: string, password: string) => ReturnType<typeof supabase.auth.signInWithPassword>;
    signInWithGoogle: () => ReturnType<typeof supabase.auth.signInWithOAuth>;
    signOut: () => ReturnType<typeof supabase.auth.signOut>;
  };
  ```

- [ ] **Step 2: Add `domainError` state to `AuthProvider`**

  Inside `AuthProvider`, after the existing `useState` declarations, add:

  ```ts
  const [domainError, setDomainError] = useState(false);
  ```

- [ ] **Step 3: Add domain guard to `onAuthStateChange`**

  Replace the existing `onAuthStateChange` callback (the `const { data: sub }` block) with:

  ```ts
  const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
    if (cancelled) return;
    if (s?.user?.email && !s.user.email.endsWith('@convertedclick.co.za')) {
      supabase.auth.signOut();
      setDomainError(true);
      return;
    }
    setDomainError(false);
    setSession(s);
  });
  ```

- [ ] **Step 4: Add auto-provisioning to the `currentUserId` resolver**

  Replace the existing `useEffect` keyed on `session?.user?.email` (lines 45–65) with:

  ```ts
  useEffect(() => {
    const email = session?.user?.email;
    if (!email) {
      setCurrentUserId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("team_members")
        .select("id")
        .eq("email", email)
        .is("archived_at", null)
        .maybeSingle();

      if (cancelled) return;

      if (data) {
        setCurrentUserId(data.id);
        return;
      }

      // Auto-provision: only for real company accounts, not the shared login
      if (email.endsWith('@convertedclick.co.za') && email !== 'team@convertedclick.co.za') {
        const fullName =
          session?.user?.user_metadata?.full_name ??
          session?.user?.user_metadata?.name ??
          email;
        const { data: newMember } = await supabase
          .from("team_members")
          .insert({ full_name: fullName, email })
          .select("id")
          .single();
        if (!cancelled) setCurrentUserId(newMember?.id ?? null);
      } else {
        setCurrentUserId(null);
      }
    })();
    return () => { cancelled = true; };
  }, [session?.user?.email]);
  ```

- [ ] **Step 5: Add `signInWithGoogle` implementation and wire `domainError` into context value**

  Replace the `value` object (lines 67–74) with:

  ```ts
  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    loading,
    domainError,
    currentUserId,
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signInWithGoogle: () =>
      supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
          queryParams: { hd: 'convertedclick.co.za' },
        },
      }),
    signOut: () => supabase.auth.signOut(),
  };
  ```

- [ ] **Step 6: Verify TypeScript compiles**

  ```bash
  npm run typecheck
  ```
  Expected: no errors.

- [ ] **Step 7: Commit**

  ```bash
  git add src/context/AuthContext.tsx
  git commit -m "feat(auth): add Google OAuth, domain guard, and auto-provisioning"
  ```

---

## Task 2: Update Login page

**Files:**
- Modify: `src/pages/Login.tsx`

- [ ] **Step 1: Destructure `signInWithGoogle` and `domainError` from `useAuth`**

  Replace line 11:
  ```ts
  const { signIn, session } = useAuth();
  ```
  with:
  ```ts
  const { signIn, signInWithGoogle, domainError, session } = useAuth();
  ```

- [ ] **Step 2: Add the Google button, divider, and domain error above the email/password form**

  Inside `<CardContent>`, replace:
  ```tsx
  <form onSubmit={onSubmit} className="space-y-4">
  ```
  with:
  ```tsx
  <div className="space-y-4">
    <Button
      type="button"
      variant="outline"
      className="w-full gap-2"
      onClick={() => signInWithGoogle()}
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
  <form onSubmit={onSubmit} className="space-y-4">
  ```

  Also close the outer `<div>` after the existing `</form>` closing tag — the structure in `<CardContent>` becomes:
  ```tsx
  <CardContent>
    <div className="space-y-4">
      {/* Google button, error, divider */}
    </div>
    <form onSubmit={onSubmit} className="space-y-4 mt-4">
      {/* existing email/password fields */}
    </form>
  </CardContent>
  ```

- [ ] **Step 3: Verify TypeScript compiles**

  ```bash
  npm run typecheck
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add src/pages/Login.tsx
  git commit -m "feat(auth): add Google sign-in button and domain error to Login page"
  ```

---

## Task 3: Tests for Login page

**Files:**
- Create: `src/pages/Login.test.tsx`

The test mocks `useAuth` so we can control `domainError` and verify rendering without a real Supabase session.

- [ ] **Step 1: Create the test file**

  ```tsx
  // src/pages/Login.test.tsx
  import { render, screen } from "@testing-library/react";
  import userEvent from "@testing-library/user-event";
  import { MemoryRouter } from "react-router-dom";
  import { vi, describe, it, expect, beforeEach } from "vitest";
  import { Login } from "./Login";

  const mockSignIn = vi.fn();
  const mockSignInWithGoogle = vi.fn();

  vi.mock("@/context/AuthContext", () => ({
    useAuth: () => ({
      signIn: mockSignIn,
      signInWithGoogle: mockSignInWithGoogle,
      domainError: false,
      session: null,
    }),
  }));

  function renderLogin() {
    return render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );
  }

  describe("Login", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("renders the Google sign-in button", () => {
      renderLogin();
      expect(screen.getByRole("button", { name: /sign in with google/i })).toBeInTheDocument();
    });

    it("calls signInWithGoogle when the Google button is clicked", async () => {
      renderLogin();
      await userEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
      expect(mockSignInWithGoogle).toHaveBeenCalledOnce();
    });

    it("does not show domain error by default", () => {
      renderLogin();
      expect(screen.queryByText(/only @convertedclick\.co\.za/i)).not.toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail (no implementation yet in this task)**

  At this point the tests should pass since Task 2 is already complete. Run anyway to confirm:

  ```bash
  npm test -- Login
  ```
  Expected: 3 tests pass.

- [ ] **Step 3: Add the domain error test (requires re-mocking)**

  Append to `Login.test.tsx`:

  ```tsx
  describe("Login — domain error", () => {
    it("shows domain error message when domainError is true", () => {
      vi.doMock("@/context/AuthContext", () => ({
        useAuth: () => ({
          signIn: mockSignIn,
          signInWithGoogle: mockSignInWithGoogle,
          domainError: true,
          session: null,
        }),
      }));
      // Re-import after mock override
      // Simpler: use a wrapper component pattern
      render(
        <MemoryRouter>
          <Login />
        </MemoryRouter>
      );
      // domainError is static in the module-level mock above — test separately
    });
  });
  ```

  Actually, because `vi.mock` is hoisted, testing `domainError: true` is cleaner in a second test file or by parameterising the mock. Use this approach instead — replace the entire test file with a version that tests both states:

  ```tsx
  // src/pages/Login.test.tsx
  import { render, screen } from "@testing-library/react";
  import userEvent from "@testing-library/user-event";
  import { MemoryRouter } from "react-router-dom";
  import { vi, describe, it, expect, beforeEach } from "vitest";

  const mockSignIn = vi.fn();
  const mockSignInWithGoogle = vi.fn();
  let mockDomainError = false;

  vi.mock("@/context/AuthContext", () => ({
    useAuth: () => ({
      signIn: mockSignIn,
      signInWithGoogle: mockSignInWithGoogle,
      domainError: mockDomainError,
      session: null,
    }),
  }));

  // Import AFTER mock registration
  const { Login } = await import("./Login");

  function renderLogin() {
    return render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>
    );
  }

  describe("Login", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockDomainError = false;
    });

    it("renders the Google sign-in button", () => {
      renderLogin();
      expect(screen.getByRole("button", { name: /sign in with google/i })).toBeInTheDocument();
    });

    it("calls signInWithGoogle when the Google button is clicked", async () => {
      renderLogin();
      await userEvent.click(screen.getByRole("button", { name: /sign in with google/i }));
      expect(mockSignInWithGoogle).toHaveBeenCalledOnce();
    });

    it("does not show domain error by default", () => {
      renderLogin();
      expect(screen.queryByText(/only @convertedclick\.co\.za/i)).not.toBeInTheDocument();
    });

    it("shows domain error message when domainError is true", () => {
      mockDomainError = true;
      renderLogin();
      expect(screen.getByText(/only @convertedclick\.co\.za/i)).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 4: Run all tests**

  ```bash
  npm test
  ```
  Expected: all tests pass, including the 4 Login tests.

- [ ] **Step 5: Commit**

  ```bash
  git add src/pages/Login.test.tsx
  git commit -m "test(auth): Login page Google button and domain error rendering"
  ```

---

## Task 4: Smoke test in browser

The dev bypass (`DEV_SESSION`) means you can't test the real OAuth flow locally without disabling it. Verify the UI changes at minimum.

- [ ] **Step 1: Start the dev server**

  ```bash
  npm run dev
  ```

- [ ] **Step 2: Open `http://localhost:5174/login`**

  Confirm:
  - "Sign in with Google" button is visible above the "or" divider
  - Email/password form is still present and functional
  - Signing in with the shared credentials still works

- [ ] **Step 3: Test real Google OAuth (requires Task 0 to be complete)**

  Open the app in a non-dev build or temporarily comment out the `DEV_SESSION` shortcut. Click "Sign in with Google". Pick a `@convertedclick.co.za` account. Confirm you land on the dashboard. Check the `team_members` table to confirm a new row was created.

  ```sql
  SELECT id, full_name, email, created_at FROM team_members ORDER BY created_at DESC LIMIT 5;
  ```

  Expected: a new row with the signed-in user's name and email.
