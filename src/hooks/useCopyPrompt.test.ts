import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { useCopyPrompt } from "./useCopyPrompt";

describe("useCopyPrompt", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with copiedId null", () => {
    const { result } = renderHook(() => useCopyPrompt());
    expect(result.current.copiedId).toBeNull();
  });

  it("sets copiedId on copy", async () => {
    const { result } = renderHook(() => useCopyPrompt());
    await act(async () => {
      result.current.copy("prompt-a", "hello");
    });
    expect(result.current.copiedId).toBe("prompt-a");
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("hello");
  });

  it("resets copiedId to null after 2000ms", async () => {
    const { result } = renderHook(() => useCopyPrompt());
    await act(async () => {
      result.current.copy("prompt-a", "hello");
    });
    expect(result.current.copiedId).toBe("prompt-a");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.copiedId).toBeNull();
  });

  it("replaces copiedId when copy called again before reset", async () => {
    const { result } = renderHook(() => useCopyPrompt());
    await act(async () => {
      result.current.copy("prompt-a", "hello");
    });
    await act(async () => {
      result.current.copy("prompt-b", "world");
    });
    expect(result.current.copiedId).toBe("prompt-b");
  });
});
