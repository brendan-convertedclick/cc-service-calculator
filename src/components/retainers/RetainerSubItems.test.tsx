import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RetainerSubItem } from "@/hooks/useRetainerSubItems";

const mockUseRetainerSubItems = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useRetainerSubItems", () => ({
  useRetainerSubItems: mockUseRetainerSubItems,
}));

import { RetainerSubItems } from "./RetainerSubItems";

const item: RetainerSubItem = {
  taskId: "t1",
  serviceName: "Local SEO Pack",
  assigneeName: "Brendan",
  periodStart: "2026-06-01",
  periodEnd: "2026-06-30",
  estimatedHours: 0.25,
  usedHours: 2,
  status: "closed",
  isDone: true,
};

describe("RetainerSubItems", () => {
  it("renders a sub-task row with estimate, used hours and status", () => {
    mockUseRetainerSubItems.mockReturnValue({ data: [item], isLoading: false });
    render(<RetainerSubItems projectId="p1" />);
    expect(screen.getByText("Local SEO Pack")).toBeInTheDocument();
    expect(screen.getByText("Brendan")).toBeInTheDocument();
    expect(screen.getByText("0.25h")).toBeInTheDocument();
    expect(screen.getByText("2h")).toBeInTheDocument();
    expect(screen.getByText("Closed")).toBeInTheDocument();
  });

  it("shows Not synced for tasks with no actuals yet", () => {
    mockUseRetainerSubItems.mockReturnValue({
      data: [{ ...item, usedHours: null, status: null, isDone: false }],
      isLoading: false,
    });
    render(<RetainerSubItems projectId="p1" />);
    expect(screen.getByText("Not synced")).toBeInTheDocument();
  });

  it("shows an empty state when nothing is provisioned", () => {
    mockUseRetainerSubItems.mockReturnValue({ data: [], isLoading: false });
    render(<RetainerSubItems projectId="p1" />);
    expect(
      screen.getByText(/No tasks provisioned yet/i),
    ).toBeInTheDocument();
  });

  it("shows a loading state", () => {
    mockUseRetainerSubItems.mockReturnValue({ data: undefined, isLoading: true });
    render(<RetainerSubItems projectId="p1" />);
    expect(screen.getByText(/Loading tasks/i)).toBeInTheDocument();
  });
});
