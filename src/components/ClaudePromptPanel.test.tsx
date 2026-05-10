import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { ClaudePromptPanel } from "./ClaudePromptPanel";
import type { ClaudePrompt } from "@/types/claude";

const prompts: ClaudePrompt[] = [
  { id: "sow", label: "Draft SoW", build: () => "sow prompt text" },
  { id: "update", label: "Client update", build: () => "update prompt text" },
];

describe("ClaudePromptPanel", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
    });
  });

  it("renders section header", () => {
    render(<ClaudePromptPanel prompts={prompts} />);
    expect(screen.getByText("Claude")).toBeInTheDocument();
  });

  it("renders a row for each prompt", () => {
    render(<ClaudePromptPanel prompts={prompts} />);
    expect(screen.getByText("Draft SoW")).toBeInTheDocument();
    expect(screen.getByText("Client update")).toBeInTheDocument();
  });

  it("calls clipboard with built prompt on click", async () => {
    render(<ClaudePromptPanel prompts={prompts} />);
    fireEvent.click(screen.getByTitle("Draft SoW"));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("sow prompt text");
    });
  });

  it("renders nothing when prompts array is empty", () => {
    const { container } = render(<ClaudePromptPanel prompts={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
