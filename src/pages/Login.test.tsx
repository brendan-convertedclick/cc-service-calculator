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

import { Login } from "./Login";

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
