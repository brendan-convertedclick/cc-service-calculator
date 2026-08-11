import { render, screen, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { NavOverlay } from "./NavOverlay"
import { navEntriesFor } from "./navItems"
import { vi } from "vitest"

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>
}

describe("NavOverlay", () => {
  it("is not visible when open is false", () => {
    const { container } = render(<NavOverlay open={false} onClose={vi.fn()} />, { wrapper: Wrapper })
    const nav = container.querySelector("nav")
    expect(nav).not.toBeNull()
    expect(nav).toHaveAttribute("inert")
  })

  it("is visible when open is true", () => {
    render(<NavOverlay open={true} onClose={vi.fn()} />, { wrapper: Wrapper })
    expect(screen.getByRole("navigation")).toBeVisible()
  })

  it("renders all nav item labels when open", () => {
    render(
      <NavOverlay open={true} onClose={vi.fn()} entries={navEntriesFor("owner")} />,
      { wrapper: Wrapper },
    )
    expect(screen.getByText("Dashboard")).toBeInTheDocument()
    expect(screen.getByText("Inbox")).toBeInTheDocument()
    expect(screen.getByText("Settings")).toBeInTheDocument()
  })

  // Defaulting to the least-privileged nav is the safe failure mode: a caller
  // that forgets `entries` under-shows rather than leaking admin surfaces.
  it("defaults to the staff-visible nav when no entries are passed", () => {
    render(<NavOverlay open={true} onClose={vi.fn()} />, { wrapper: Wrapper })
    expect(screen.getByText("Systems")).toBeInTheDocument()
    expect(screen.queryByText("Settings")).not.toBeInTheDocument()
  })

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn()
    render(<NavOverlay open={true} onClose={onClose} />, { wrapper: Wrapper })
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("calls onClose when scrim is clicked", () => {
    const onClose = vi.fn()
    render(<NavOverlay open={true} onClose={onClose} />, { wrapper: Wrapper })
    fireEvent.click(screen.getByTestId("nav-scrim"))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("does not attach Escape listener when closed", () => {
    const onClose = vi.fn()
    render(<NavOverlay open={false} onClose={onClose} />, { wrapper: Wrapper })
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).not.toHaveBeenCalled()
  })
})
