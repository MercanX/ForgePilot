import type { JobStatus } from "@shared/schemas/job";
import type { RunStatus, StageStatus } from "@shared/schemas/run";

export const RUN_TRANSITIONS = {
  idle: ["preparing"],
  preparing: ["running", "failed"],
  running: ["paused", "completed", "failed", "interrupted"],
  paused: ["running", "cancelled", "failed"],
  completed: [],
  cancelled: [],
  failed: [],
  interrupted: ["running", "discarded"],
  discarded: []
} as const satisfies Record<RunStatus, readonly RunStatus[]>;

export const STAGE_TRANSITIONS = {
  waiting: ["ready"],
  ready: ["running"],
  running: ["completed", "failed", "skipped"],
  completed: [],
  failed: [],
  skipped: []
} as const satisfies Record<StageStatus, readonly StageStatus[]>;

export const JOB_TRANSITIONS = {
  requested: ["received", "failed"],
  received: ["executing", "failed"],
  executing: ["validating", "failed"],
  validating: ["submitting", "failed"],
  submitting: ["acked", "retry", "failed"],
  retry: ["submitting", "failed"],
  acked: [],
  failed: []
} as const satisfies Record<JobStatus, readonly JobStatus[]>;

export const canTransition = <TState extends string>(
  transitions: Record<TState, readonly TState[]>,
  from: TState,
  to: TState
): boolean => transitions[from].includes(to);
