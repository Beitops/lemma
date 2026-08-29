import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const BOARD_FOCUS_SUPPRESSION_MS = 400;

export interface ObjectiveDisclosureController {
  closeObjective: () => void;
  dismissObjectiveFromOutside: () => void;
  isHovered: boolean;
  isOpen: boolean;
  isPinned: boolean;
  onObjectivePointerEnter: () => void;
  onObjectivePointerLeave: () => void;
  pinObjective: () => void;
}

export interface UseWorkspaceViewStateOptions {
  activeDialog: string | null;
  inspectorOpen?: boolean;
  onCloseInspector?: () => void;
  onCloseStepInspector?: () => void;
  selectedStepId?: string | null;
}

export interface WorkspaceViewStateController {
  consumeBoardFocusSuppression: () => boolean;
  enterBoardFocus: () => void;
  exitBoardFocus: () => void;
  isBoardFocused: boolean;
  isSidebarCollapsed: boolean;
  objective: ObjectiveDisclosureController;
  toggleBoardFocus: () => void;
  toggleSidebarCollapsed: () => void;
}

export function useWorkspaceViewState({
  activeDialog,
  inspectorOpen,
  onCloseInspector,
  onCloseStepInspector,
  selectedStepId = null,
}: UseWorkspaceViewStateOptions): WorkspaceViewStateController {
  const [isObjectiveHovered, setIsObjectiveHovered] = useState(false);
  const [isObjectivePinned, setIsObjectivePinned] = useState(false);
  const [isBoardFocused, setIsBoardFocused] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const boardFocusSuppressedRef = useRef(false);
  const boardFocusSuppressionTimerRef = useRef<number | null>(null);

  const closeObjective = useCallback(() => {
    setIsObjectiveHovered(false);
    setIsObjectivePinned(false);
  }, []);

  const pinObjective = useCallback(() => {
    setIsObjectivePinned(true);
  }, []);

  const consumeBoardFocusSuppression = useCallback(() => {
    const wasSuppressed = boardFocusSuppressedRef.current;
    boardFocusSuppressedRef.current = false;
    if (boardFocusSuppressionTimerRef.current !== null) {
      window.clearTimeout(boardFocusSuppressionTimerRef.current);
      boardFocusSuppressionTimerRef.current = null;
    }
    return wasSuppressed;
  }, []);

  const dismissObjectiveFromOutside = useCallback(() => {
    closeObjective();
    boardFocusSuppressedRef.current = true;
    if (boardFocusSuppressionTimerRef.current !== null) {
      window.clearTimeout(boardFocusSuppressionTimerRef.current);
    }
    boardFocusSuppressionTimerRef.current = window.setTimeout(() => {
      boardFocusSuppressedRef.current = false;
      boardFocusSuppressionTimerRef.current = null;
    }, BOARD_FOCUS_SUPPRESSION_MS);
  }, [closeObjective]);

  const enterBoardFocus = useCallback(() => {
    if (consumeBoardFocusSuppression()) return;
    closeObjective();
    setIsBoardFocused(true);
  }, [closeObjective, consumeBoardFocusSuppression]);

  const exitBoardFocus = useCallback(() => {
    setIsBoardFocused(false);
  }, []);

  const toggleBoardFocus = useCallback(() => {
    if (!isBoardFocused && consumeBoardFocusSuppression()) return;
    if (!isBoardFocused) closeObjective();
    setIsBoardFocused((current) => !current);
  }, [closeObjective, consumeBoardFocusSuppression, isBoardFocused]);

  const toggleSidebarCollapsed = useCallback(() => {
    setIsSidebarCollapsed((current) => !current);
  }, []);

  useEffect(
    () => () => {
      if (boardFocusSuppressionTimerRef.current !== null) {
        window.clearTimeout(boardFocusSuppressionTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || activeDialog !== null) return;

      if (inspectorOpen ?? selectedStepId !== null) {
        event.preventDefault();
        event.stopPropagation();
        (onCloseInspector ?? onCloseStepInspector)?.();
        return;
      }

      if (isBoardFocused) {
        event.preventDefault();
        exitBoardFocus();
        return;
      }

      if (isObjectivePinned) {
        event.preventDefault();
        closeObjective();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [activeDialog, closeObjective, exitBoardFocus, inspectorOpen, isBoardFocused, isObjectivePinned, onCloseInspector, onCloseStepInspector, selectedStepId]);

  return useMemo(
    () => ({
      consumeBoardFocusSuppression,
      enterBoardFocus,
      exitBoardFocus,
      isBoardFocused,
      isSidebarCollapsed,
      objective: {
        closeObjective,
        dismissObjectiveFromOutside,
        isHovered: isObjectiveHovered,
        isOpen: isObjectiveHovered || isObjectivePinned,
        isPinned: isObjectivePinned,
        onObjectivePointerEnter: () => setIsObjectiveHovered(true),
        onObjectivePointerLeave: () => setIsObjectiveHovered(false),
        pinObjective,
      },
      toggleBoardFocus,
      toggleSidebarCollapsed,
    }),
    [
      closeObjective,
      consumeBoardFocusSuppression,
      dismissObjectiveFromOutside,
      enterBoardFocus,
      exitBoardFocus,
      isBoardFocused,
      isSidebarCollapsed,
      isObjectiveHovered,
      isObjectivePinned,
      pinObjective,
      toggleBoardFocus,
      toggleSidebarCollapsed,
    ],
  );
}
