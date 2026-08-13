import { runSchema, workflowStageSchema } from "@shared/schemas/run";
import {
  canTransition,
  JOB_TRANSITIONS,
  RUN_TRANSITIONS,
  STAGE_TRANSITIONS
} from "@shared/types/state-machines";

import { runFixture, workflowStageFixture } from "./fixtures";

describe("run schemas", () => {
  it("validates a run with stages, jobs and findings", () => {
    expect(runSchema.parse(runFixture)).toEqual(runFixture);
  });

  it("keeps stage progress inside percent bounds", () => {
    expect(() => workflowStageSchema.parse({ ...workflowStageFixture, progress: 101 })).toThrow();
  });
});

describe("state machine transitions", () => {
  it("allows documented run transitions", () => {
    expect(canTransition(RUN_TRANSITIONS, "idle", "preparing")).toBe(true);
    expect(canTransition(RUN_TRANSITIONS, "interrupted", "discarded")).toBe(true);
  });

  it("rejects undocumented run transitions", () => {
    expect(canTransition(RUN_TRANSITIONS, "completed", "running")).toBe(false);
  });

  it("models server-owned stage transitions", () => {
    expect(canTransition(STAGE_TRANSITIONS, "ready", "running")).toBe(true);
    expect(canTransition(STAGE_TRANSITIONS, "completed", "failed")).toBe(false);
  });

  it("models job retry transitions", () => {
    expect(canTransition(JOB_TRANSITIONS, "submitting", "retry")).toBe(true);
    expect(canTransition(JOB_TRANSITIONS, "acked", "retry")).toBe(false);
  });
});
