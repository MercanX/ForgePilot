import { z } from "zod";

import { DEFAULT_JOB_TIMEOUT_MS } from "@shared/constants/timeouts";

import { findingSchema } from "./finding";
import { providerIdSchema } from "./provider";

export const jobStatusSchema = z.enum([
  "requested",
  "received",
  "executing",
  "validating",
  "submitting",
  "acked",
  "failed",
  "retry"
]);

export const taskInstructionsSchema = z
  .object({
    body: z.string().min(1),
    format: z.enum(["plain-text", "markdown", "json"]).default("plain-text"),
    metadata: z.record(z.string(), z.unknown()).default({})
  })
  .strict();

export const taskSchema = z
  .object({
    id: z.string().uuid(),
    jobId: z.string().uuid(),
    instructions: taskInstructionsSchema,
    timeoutMs: z.number().int().positive().default(DEFAULT_JOB_TIMEOUT_MS)
  })
  .strict();

export const jobSchema = z
  .object({
    id: z.string().uuid(),
    runId: z.string().uuid(),
    stageId: z.string().min(1).nullable(),
    providerId: providerIdSchema,
    status: jobStatusSchema,
    task: taskSchema.nullable(),
    startedAt: z.string().datetime().nullable(),
    finishedAt: z.string().datetime().nullable(),
    exitCode: z.number().int().nullable()
  })
  .strict();

export const providerOutputChunkSchema = z
  .object({
    stream: z.enum(["stdout", "stderr"]),
    text: z.string(),
    timestamp: z.string().datetime()
  })
  .strict();

export const providerExitInfoSchema = z
  .object({
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
    finishedAt: z.string().datetime()
  })
  .strict();

export const taskResultSchema = z
  .object({
    taskId: z.string().uuid(),
    jobId: z.string().uuid(),
    providerId: providerIdSchema,
    status: z.enum(["completed", "failed", "cancelled", "timeout"]),
    exitCode: z.number().int().nullable(),
    outputChunks: z.array(providerOutputChunkSchema),
    findings: z.array(findingSchema).default([]),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime()
  })
  .strict();

export type JobStatus = z.infer<typeof jobStatusSchema>;
export type TaskInstructions = z.infer<typeof taskInstructionsSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Job = z.infer<typeof jobSchema>;
export type ProviderOutputChunk = z.infer<typeof providerOutputChunkSchema>;
export type ProviderExitInfo = z.infer<typeof providerExitInfoSchema>;
export type TaskResult = z.infer<typeof taskResultSchema>;
