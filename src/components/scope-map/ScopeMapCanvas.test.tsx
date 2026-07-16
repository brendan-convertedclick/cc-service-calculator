import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ScopeMapCanvas } from "./ScopeMapCanvas";
import type { BriefTaskSowPlacement } from "@/types/sow-placements";

function makeItem(overrides: Partial<BriefTaskSowPlacement>): BriefTaskSowPlacement {
  return {
    id: "p-id",
    brief_id: "brief-1",
    task_ref: "item_0_ref",
    service_area_id: null,
    is_inside: true,
    ai_match_quote: "Covered under the monthly retainer clause.",
    ai_confidence: 0.9,
    override_reason: null,
    approved_by: null,
    approved_at: null,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    item_name: "Homepage hero refresh",
    item_description: "Swap the hero image and copy.",
    sow_slug: "web-retainer",
    suggested_service_id: null,
    estimated_cents: null,
    // Scope Ledger Rail (migration 0071).
    disposition: null,
    quantity: null,
    grounding_quote: null,
    needs_review: null,
    client_reason: null,
    is_assumed: null,
    excluded: null,
    ...overrides,
  };
}

const items: BriefTaskSowPlacement[] = [
  makeItem({ id: "p1", task_ref: "item_0_hero", item_name: "Homepage hero refresh" }),
  makeItem({
    id: "p2",
    task_ref: "item_1_blog",
    item_name: "Two blog posts",
    ai_confidence: 0.7,
  }),
  makeItem({
    id: "p3",
    task_ref: "item_2_app",
    item_name: "Build a mobile app",
    is_inside: false,
    sow_slug: null,
    ai_confidence: 0.95,
    ai_match_quote: "No SOW covers native app development.",
    suggested_service_id: "svc-1",
    estimated_cents: 12_500_00,
  }),
];

describe("ScopeMapCanvas", () => {
  it("renders a chip per item: inside and outside", () => {
    render(
      <ScopeMapCanvas
        items={items}
        sowTitles={["Web Retainer"]}
        selectedRefs={new Set()}
        onToggleSelect={vi.fn()}
        onOverride={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Homepage hero refresh.*In SOW/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Two blog posts.*In SOW/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Build a mobile app.*Outside SOW/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Web Retainer")).toBeInTheDocument();
    expect(screen.getByText("In scope · 2")).toBeInTheDocument();
  });

  it("shows an empty state when there are no items", () => {
    render(
      <ScopeMapCanvas
        items={[]}
        sowTitles={[]}
        selectedRefs={new Set()}
        onToggleSelect={vi.fn()}
        onOverride={vi.fn()}
      />,
    );
    expect(screen.getByText(/No scope items yet/)).toBeInTheDocument();
  });

  it("fires onOverride when moving an inside item outside via the popover", async () => {
    const user = userEvent.setup();
    const onOverride = vi.fn();
    render(
      <ScopeMapCanvas
        items={items}
        sowTitles={[]}
        selectedRefs={new Set()}
        onToggleSelect={vi.fn()}
        onOverride={onOverride}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Homepage hero refresh/ }));
    await user.click(await screen.findByRole("button", { name: /Move outside/ }));
    expect(onOverride).toHaveBeenCalledWith("item_0_hero", false);
  });

  it("fires onOverride when moving an outside item inside via the popover", async () => {
    const user = userEvent.setup();
    const onOverride = vi.fn();
    render(
      <ScopeMapCanvas
        items={items}
        sowTitles={[]}
        selectedRefs={new Set()}
        onToggleSelect={vi.fn()}
        onOverride={onOverride}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Build a mobile app/ }));
    await user.click(await screen.findByRole("button", { name: /Move inside/ }));
    expect(onOverride).toHaveBeenCalledWith("item_2_app", true);
  });

  it("toggles estimate selection from the chip checkbox without opening the popover", async () => {
    const user = userEvent.setup();
    const onToggleSelect = vi.fn();
    render(
      <ScopeMapCanvas
        items={items}
        sowTitles={[]}
        selectedRefs={new Set()}
        onToggleSelect={onToggleSelect}
        onOverride={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId("chip-select-item_2_app"));
    expect(onToggleSelect).toHaveBeenCalledWith("item_2_app");
    // Popover stayed closed — no override actions in the document.
    expect(screen.queryByRole("button", { name: /Move inside/ })).not.toBeInTheDocument();
  });

  it("announces selected state in the outside chip's accessible name", () => {
    render(
      <ScopeMapCanvas
        items={items}
        sowTitles={[]}
        selectedRefs={new Set(["item_2_app"])}
        onToggleSelect={vi.fn()}
        onOverride={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", {
        name: /Build a mobile app.*Outside SOW.*Included in estimate/,
      }),
    ).toBeInTheDocument();
    // The inline checkbox is purely decorative — no checkbox semantics.
    expect(screen.getByTestId("chip-select-item_2_app")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("chip-select-item_2_app")).not.toHaveAttribute("role");
  });

  it("announces unselected outside chips as not included in the estimate", () => {
    render(
      <ScopeMapCanvas
        items={items}
        sowTitles={[]}
        selectedRefs={new Set()}
        onToggleSelect={vi.fn()}
        onOverride={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", {
        name: /Build a mobile app.*Outside SOW.*Not included in estimate/,
      }),
    ).toBeInTheDocument();
  });
});
