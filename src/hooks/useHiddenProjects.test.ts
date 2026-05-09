import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHiddenProjects } from "./useHiddenProjects";

describe("useHiddenProjects", () => {
  it("starts with no hidden ids", () => {
    const { result } = renderHook(() => useHiddenProjects());
    expect(result.current.hiddenIds.size).toBe(0);
  });

  it("hides a project by id", () => {
    const { result } = renderHook(() => useHiddenProjects());
    act(() => result.current.hide("proj-1"));
    expect(result.current.isHidden("proj-1")).toBe(true);
  });

  it("does not affect other ids when hiding one", () => {
    const { result } = renderHook(() => useHiddenProjects());
    act(() => result.current.hide("proj-1"));
    expect(result.current.isHidden("proj-2")).toBe(false);
  });

  it("hiding the same id twice is idempotent", () => {
    const { result } = renderHook(() => useHiddenProjects());
    act(() => {
      result.current.hide("proj-1");
      result.current.hide("proj-1");
    });
    expect(result.current.hiddenIds.size).toBe(1);
  });
});
