import type { Branch, ReasoningResult } from "@lemma/contracts";
import {
  Bot,
  Flag,
  Minimize2,
  RefreshCw,
  ScrollText,
} from "lucide-react";
import { cx } from "../../../lib/ui";
import { Button, IconButton } from "../../../components/Primitives";

interface BoardFocusControlsProps {
  onExit: () => void;
  onOpenCleanSolution: () => void;
  onOpenResult: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  selectedResult: ReasoningResult | null;
  selectedBranch: Branch | null;
  webMcpAvailable: boolean;
}

export function BoardFocusControls({
  onExit,
  onOpenCleanSolution,
  onOpenResult,
  onRefresh,
  refreshing,
  selectedResult,
  selectedBranch,
  webMcpAvailable,
}: BoardFocusControlsProps) {
  return (
    <div className="board-focus-overlay" data-board-interactive="true">
      <div className="board-focus-exit">
        <Button icon={<Minimize2 />} onClick={onExit} tone="secondary">
          Exit full screen
        </Button>
        <kbd>Esc</kbd>
      </div>

      <div aria-label="Full screen board actions" className="board-focus-actions" role="toolbar">
        <IconButton
          className={cx(refreshing && "is-refreshing")}
          disabled={refreshing}
          label="Refresh workspace"
          onClick={onRefresh}
        >
          <RefreshCw />
        </IconButton>
        <Button icon={<ScrollText />} onClick={onOpenCleanSolution} tone="secondary">Clean solution</Button>
        <Button icon={<Flag />} onClick={onOpenResult} tone="secondary">
          {selectedResult ? "Edit outcome" : selectedBranch ? "Record branch outcome" : "Record outcome"}
        </Button>
      </div>

      <span className={cx("board-focus-agent", webMcpAvailable && "is-live")}>
        <span aria-hidden="true" /><Bot />
        {webMcpAvailable ? "Agent tools live" : "WebMCP unavailable"}
      </span>

    </div>
  );
}
