import { render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { vi, describe, it, expect, beforeEach } from "vitest"

const mockSignOut = vi.fn()
const mockNavigate = vi.fn()

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    signOut: mockSignOut,
    session: null,
    user: null,
    loading: false,
    domainError: false,
    currentUserId: null,
  }),
}))

vi.mock("@/hooks/useTeam", () => ({
  useTeam: () => ({ data: [] }),
  memberColors: () => new Map(),
}))

// The rail is role-filtered (navEntriesFor), so every assertion about which
// links render depends on this. Default to owner — the full nav.
const mockRole = { role: "owner" as string | null }
vi.mock("@/hooks/useCurrentRole", () => ({
  useCurrentRole: () => ({ role: mockRole.role, isLoading: false }),
}))

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom")
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

import { IconRail } from "./IconRail"

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>
}

describe("IconRail", () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    mockSignOut.mockClear()
    mockRole.role = "owner"
  })

  it("renders all nav item icons with aria-labels", () => {
    render(<IconRail navOpen={false} onToggle={vi.fn()} />, { wrapper: Wrapper })
    expect(screen.getByRole("link", { name: /dashboard/i })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /inbox/i })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /settings/i })).toBeInTheDocument()
  })

  it("shows open chevron aria-label when navOpen is false", () => {
    render(<IconRail navOpen={false} onToggle={vi.fn()} />, { wrapper: Wrapper })
    expect(screen.getByRole("button", { name: /open navigation/i })).toBeInTheDocument()
  })

  it("shows close chevron aria-label when navOpen is true", () => {
    render(<IconRail navOpen={true} onToggle={vi.fn()} />, { wrapper: Wrapper })
    expect(screen.getByRole("button", { name: /close navigation/i })).toBeInTheDocument()
  })

  it("calls onToggle when chevron is clicked", () => {
    const onToggle = vi.fn()
    render(<IconRail navOpen={false} onToggle={onToggle} />, { wrapper: Wrapper })
    fireEvent.click(screen.getByRole("button", { name: /open navigation/i }))
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it("links the avatar to the profile page", () => {
    render(<IconRail navOpen={true} onToggle={vi.fn()} />, { wrapper: Wrapper })
    expect(screen.getByRole("link", { name: /^profile —/i })).toHaveAttribute("href", "/profile")
  })

  it("shows staff only the surfaces they can open", () => {
    mockRole.role = "staff"
    render(<IconRail navOpen={true} onToggle={vi.fn()} />, { wrapper: Wrapper })
    expect(screen.getByRole("link", { name: "My work" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Systems" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Profile" })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Clients" })).not.toBeInTheDocument()
  })

  it("hides owner-only surfaces from an admin", () => {
    mockRole.role = "admin"
    render(<IconRail navOpen={true} onToggle={vi.fn()} />, { wrapper: Wrapper })
    expect(screen.queryByRole("link", { name: "Escalations" })).not.toBeInTheDocument()
  })

  it("renders sign-out button", () => {
    render(<IconRail navOpen={false} onToggle={vi.fn()} />, { wrapper: Wrapper })
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument()
  })

  it("calls signOut and navigates to /login when sign-out button is clicked", async () => {
    render(<IconRail navOpen={false} onToggle={vi.fn()} />, { wrapper: Wrapper })
    await fireEvent.click(screen.getByRole("button", { name: /sign out/i }))
    expect(mockSignOut).toHaveBeenCalledOnce()
    expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true })
  })
})
