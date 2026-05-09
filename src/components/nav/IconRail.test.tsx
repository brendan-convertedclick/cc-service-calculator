import { render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { vi, describe, it, expect } from "vitest"

const mockSignOut = vi.fn()

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

import { IconRail } from "./IconRail"

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>
}

describe("IconRail", () => {
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

  it("renders sign-out button", () => {
    render(<IconRail navOpen={false} onToggle={vi.fn()} />, { wrapper: Wrapper })
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument()
  })
})
