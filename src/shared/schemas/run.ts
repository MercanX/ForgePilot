import { z } from "zod";

import { findingSchema } from "./finding";
import { jobSchema } from "./job";
import { providerIdSchema } from "./provider";

export const runStatusSchema = z.enum([
  "idle",
  "preparing",
  "running",
  "paused",
  "completed",
  "cancelled",
  "failed",
  "interrupted",
  "discarded"
]);

export const stageStatusSchema = z.enum([
  "waiting",
  "ready",
  "running",
  "completed",
  "failed",
  "skipped"
]);

export const stageActivityEntrySchema = z
  .object({
    message: z.string().min(1),
    status: z.enum(["started", "completed", "blocked", "failed", "skipped"]),
    stepId: z.string().min(1),
    updatedAt: z.string().datetime()
  })
  .strict();

export const stageReportSchema = z
  .object({
    completedAt: z.string().datetime(),
    executionId: z.string().min(1).nullable(),
    message: z.string().min(1),
    outcome: z.enum(["completed", "blocked", "failed"]),
    progress: z.number().min(0).max(100)
  })
  .strict();

export const workflowStageSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    status: stageStatusSchema,
    progress: z.number().min(0).max(100).nullable(),
    currentAgent: z.string().min(1).nullable(),
    currentOperation: z.string().min(1).nullable(),
    activity: z.array(stageActivityEntrySchema).default([]),
    report: stageReportSchema.nullable().default(null)
  })
  .strict();

export const runCheckpointSchema = z
  .object({
    stageId: z.string().min(1).nullable(),
    jobId: z.string().uuid().nullable(),
    updatedAt: z.string().datetime()
  })
  .strict();

export const runSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    workflowId: z.string().min(1),
    workflowVersion: z.string().min(1),
    providerId: providerIdSchema,
    status: runStatusSchema,
    stages: z.array(workflowStageSchema),
    jobs: z.array(jobSchema).default([]),
    findings: z.array(findingSchema).default([]),
    checkpoint: runCheckpointSchema.nullable(),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable()
  })
  .strict();

export type RunStatus = z.infer<typeof runStatusSchema>;
export type StageStatus = z.infer<typeof stageStatusSchema>;
export type StageActivityEntry = z.infer<typeof stageActivityEntrySchema>;
export type StageReport = z.infer<typeof stageReportSchema>;
export type WorkflowStage = z.infer<typeof workflowStageSchema>;
export type RunCheckpoint = z.infer<typeof runCheckpointSchema>;
export type Run = z.infer<typeof runSchema>;
