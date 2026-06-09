import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HoursUsedCell } from "./HoursUsedCell";
import type { RetainerBurnRow } from "@/types/pulse";

const burn: RetainerBurnRow = {
  projectId: "p1",
  clientName: "Test Conductor",
  feePerMonthCents: 1000000,
  hoursTarget: 10,
  hoursUsed: 2,
  burnPct: 20,
  daysLeftInMonth: 21,
  effectiveHourlyRateCents: 100000,
  projectedHours: 6,
  isOverrunRisk: false,
  isUnderutilised: false,
  rag: "green",
};

describe("HoursUsedCell", () => {
  it("renders used / target and a bar when burn data is present", () => {
    const { container } = render(<HoursUsedCell burn={burn} />);
    expect(screen.getByText("2 / 10h")).toBeInTheDocument();
    expect(container.querySelector(".bg-green-500")).toBeTruthy();
  });

  it("renders an em dash when there is no burn data", () => {
    render(<HoursUsedCell burn={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("uses the amber bar colour at moderate burn", () => {
    const { container } = render(<HoursUsedCell burn={{ ...burn, burnPct: 75, rag: "amber" }} />);
    expect(container.querySelector(".bg-amber-400")).toBeTruthy();
  });

  it("uses the red bar colour at high burn", () => {
    const { container } = render(<HoursUsedCell burn={{ ...burn, burnPct: 92, rag: "red" }} />);
    expect(container.querySelector(".bg-m-error")).toBeTruthy();
  });
});
