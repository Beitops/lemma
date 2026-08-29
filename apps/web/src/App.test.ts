import { describe, expect, it } from "vitest";
import { mutationNotice } from "./App";

const OBJECTIVE_ID = "20000000-0000-4000-8000-000000000001";
const STRATEGY_ID = "30000000-0000-4000-8000-000000000001";
const BRANCH_ID = "40000000-0000-4000-8000-000000000001";
const CONTEXT_ID = "50000000-0000-4000-8000-000000000001";
const STEP_ID = "60000000-0000-4000-8000-000000000001";
const DECISION_ID = "70000000-0000-4000-8000-000000000001";

describe("WebMCP mutation notices", () => {
  it("preserves the target objective for objective, strategy, result, and context highlights", () => {
    expect(mutationNotice({ id: OBJECTIVE_ID, objectiveId: OBJECTIVE_ID, type: "objective" }))
      .toEqual({ objectiveId: OBJECTIVE_ID, type: "objective" });
    expect(mutationNotice({ id: STRATEGY_ID, objectiveId: OBJECTIVE_ID, type: "strategy" }))
      .toEqual({ objectiveId: OBJECTIVE_ID, strategyId: STRATEGY_ID, type: "strategy" });
    expect(mutationNotice({ id: BRANCH_ID, objectiveId: OBJECTIVE_ID, type: "branch" }))
      .toEqual({ branchId: BRANCH_ID, objectiveId: OBJECTIVE_ID, type: "branch" });
    expect(mutationNotice({ id: CONTEXT_ID, objectiveId: OBJECTIVE_ID, type: "context" }))
      .toEqual({ contextItemId: CONTEXT_ID, objectiveId: OBJECTIVE_ID, type: "context" });
  });

  it("routes a pending decision to its affected graph node without treating it as a modal action", () => {
    expect(mutationNotice({
      ancestry: {
        branchId: BRANCH_ID,
        objectiveId: OBJECTIVE_ID,
        stepId: STEP_ID,
        strategyId: STRATEGY_ID,
      },
      id: DECISION_ID,
      objectiveId: OBJECTIVE_ID,
      type: "decision",
    })).toEqual({ objectiveId: OBJECTIVE_ID, stepId: STEP_ID, type: "step" });

    expect(mutationNotice({
      ancestry: {},
      id: DECISION_ID,
      type: "decision",
    })).toEqual({});
  });
});
