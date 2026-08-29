import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceViewState } from "./useWorkspaceViewState";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function pressEscape(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" });
  act(() => {
    document.body.dispatchEvent(event);
  });
  return event;
}

describe("useWorkspaceViewState", () => {
  it("distinguishes a hover-only objective from a pinned objective", () => {
    const { result } = renderHook(() => useWorkspaceViewState({ activeDialog: null }));

    expect(result.current.objective.isOpen).toBe(false);
    expect(result.current.objective.isPinned).toBe(false);

    act(() => {
      result.current.objective.onObjectivePointerEnter();
    });
    expect(result.current.objective.isOpen).toBe(true);
    expect(result.current.objective.isHovered).toBe(true);
    expect(result.current.objective.isPinned).toBe(false);

    act(() => {
      result.current.objective.onObjectivePointerLeave();
    });
    expect(result.current.objective.isOpen).toBe(false);

    act(() => {
      result.current.objective.pinObjective();
      result.current.objective.onObjectivePointerLeave();
    });
    expect(result.current.objective.isOpen).toBe(true);
    expect(result.current.objective.isPinned).toBe(true);

    act(() => {
      result.current.objective.closeObjective();
    });
    expect(result.current.objective.isOpen).toBe(false);
    expect(result.current.objective.isPinned).toBe(false);
  });

  it("uses Escape to close a pinned objective outside board focus and exit board focus when active", () => {
    const { result } = renderHook(() => useWorkspaceViewState({ activeDialog: null }));

    act(() => {
      result.current.objective.pinObjective();
    });

    const firstEscape = pressEscape();
    expect(firstEscape.defaultPrevented).toBe(true);
    expect(result.current.objective.isPinned).toBe(false);

    act(() => {
      result.current.objective.pinObjective();
      result.current.enterBoardFocus();
    });
    expect(result.current.isBoardFocused).toBe(true);
    expect(result.current.objective.isOpen).toBe(false);

    const secondEscape = pressEscape();
    expect(secondEscape.defaultPrevented).toBe(true);
    expect(result.current.isBoardFocused).toBe(false);
    expect(result.current.objective.isOpen).toBe(false);
  });

  it("closes an inspector in the normal board before handling other Escape behavior", () => {
    const onCloseInspector = vi.fn();
    const { result } = renderHook(() => useWorkspaceViewState({
      activeDialog: null,
      inspectorOpen: true,
      onCloseInspector,
    }));

    act(() => {
      result.current.objective.pinObjective();
    });

    const escape = pressEscape();

    expect(escape.defaultPrevented).toBe(true);
    expect(onCloseInspector).toHaveBeenCalledTimes(1);
    expect(result.current.isBoardFocused).toBe(false);
    expect(result.current.objective.isPinned).toBe(true);
  });

  it("closes an open step inspector before leaving the focused board", () => {
    const onCloseStepInspector = vi.fn();
    const { result, rerender } = renderHook(
      ({ selectedStepId }: { selectedStepId: string | null }) => useWorkspaceViewState({
        activeDialog: null,
        onCloseStepInspector,
        selectedStepId,
      }),
      { initialProps: { selectedStepId: "step-1" as string | null } },
    );

    act(() => {
      result.current.enterBoardFocus();
    });
    expect(result.current.isBoardFocused).toBe(true);

    const boardKeyDown = vi.fn();
    document.body.addEventListener("keydown", boardKeyDown);
    const firstEscape = pressEscape();
    document.body.removeEventListener("keydown", boardKeyDown);

    expect(firstEscape.defaultPrevented).toBe(true);
    expect(boardKeyDown).not.toHaveBeenCalled();
    expect(onCloseStepInspector).toHaveBeenCalledTimes(1);
    expect(result.current.isBoardFocused).toBe(true);

    rerender({ selectedStepId: null });

    const secondEscape = pressEscape();
    expect(secondEscape.defaultPrevented).toBe(true);
    expect(onCloseStepInspector).toHaveBeenCalledTimes(1);
    expect(result.current.isBoardFocused).toBe(false);
  });

  it("does not let an outside objective dismissal activate board focus", () => {
    const { result } = renderHook(() => useWorkspaceViewState({ activeDialog: null }));

    act(() => {
      result.current.objective.pinObjective();
      result.current.objective.dismissObjectiveFromOutside();
      result.current.enterBoardFocus();
    });

    expect(result.current.objective.isOpen).toBe(false);
    expect(result.current.isBoardFocused).toBe(false);

    act(() => {
      result.current.enterBoardFocus();
    });
    expect(result.current.isBoardFocused).toBe(true);
  });

  it("releases a stale outside-dismissal suppression after its click window", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWorkspaceViewState({ activeDialog: null }));

    act(() => {
      result.current.objective.pinObjective();
      result.current.objective.dismissObjectiveFromOutside();
      vi.advanceTimersByTime(400);
      result.current.enterBoardFocus();
    });

    expect(result.current.isBoardFocused).toBe(true);
  });

  it("leaves Escape to an active dialog before closing an inspector or exiting board focus", () => {
    const onCloseStepInspector = vi.fn();
    const { result, rerender } = renderHook(
      ({ activeDialog, selectedStepId }: { activeDialog: string | null; selectedStepId: string | null }) => useWorkspaceViewState({
        activeDialog,
        onCloseStepInspector,
        selectedStepId,
      }),
      {
        initialProps: {
          activeDialog: null as string | null,
          selectedStepId: "step-1" as string | null,
        },
      },
    );

    act(() => {
      result.current.enterBoardFocus();
      result.current.objective.pinObjective();
    });
    rerender({ activeDialog: "step", selectedStepId: "step-1" });

    const escape = pressEscape();
    expect(escape.defaultPrevented).toBe(false);
    expect(result.current.isBoardFocused).toBe(true);
    expect(result.current.objective.isPinned).toBe(true);
    expect(onCloseStepInspector).not.toHaveBeenCalled();
  });

  it("toggles the workspace sidebar disclosure", () => {
    const { result } = renderHook(() => useWorkspaceViewState({ activeDialog: null }));

    expect(result.current.isSidebarCollapsed).toBe(false);

    act(() => {
      result.current.toggleSidebarCollapsed();
    });
    expect(result.current.isSidebarCollapsed).toBe(true);

    act(() => {
      result.current.toggleSidebarCollapsed();
    });
    expect(result.current.isSidebarCollapsed).toBe(false);
  });
});
