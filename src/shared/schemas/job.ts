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

export const taskExecutionModeSchema = z.enum(["echo-fixture", "provider"]);

export const taskExecutionRequestSchema = z
  .object({
    providerId: providerIdSchema,
    projectRootPath: z.string().min(1),
    instructions: taskInstructionsSchema,
    model: z.string().min(1).nullable().default(null),
    timeoutMs: z.number().int().positive().default(DEFAULT_JOB_TIMEOUT_MS),
    mode: taskExecutionModeSchema.default("echo-fixture"),
    outputJsonSchema: z.record(z.string(), z.unknown()).nullable().default(null)
  })
  .strict();

export const taskHandleSchema = z
  .object({
    id: z.string().uuid(),
    providerId: providerIdSchema,
    processId: z.number().int().positive().nullable()
  })
  .strict();

export const taskStartResponseSchema = z
  .object({
    handle: taskHandleSchema,
    startedAt: z.string().datetime(),
    command: z.string().min(1),
    args: z.array(z.string())
  })
  .strict();

export const taskStopRequestSchema = z
  .object({
    taskId: z.string().uuid()
  })
  .strict();

export const taskStopResponseSchema = z
  .object({
    stopped: z.boolean()
  })
  .strict();

export const taskOutputEventSchema = z
  .object({
    taskId: z.string().uuid(),
    providerId: providerIdSchema,
    chunk: providerOutputChunkSchema
  })
  .strict();

export const taskExitEventSchema = z
  .object({
    taskId: z.string().uuid(),
    providerId: providerIdSchema,
    exitInfo: providerExitInfoSchema
  })
  .strict();


export const jobProviderDebugEventSchema = z
  .object({
    projectId: z.string().uuid(),
    stageId: z.string().min(1),
    taskId: z.string().uuid().nullable(),
    processId: z.number().int().positive().nullable(),
    providerId: providerIdSchema,
    model: z.string().min(1).nullable(),
    kind: z.enum([
      "provider-start",
      "stdout",
      "stderr",
      "provider-event",
      "provider-result",
      "provider-exit",
      "parser",
      "contract"
    ]),
    message: z.string().min(1),
    text: z.string().nullable(),
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
    timestamp: z.string().datetime()
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
export type TaskExecutionMode = z.infer<typeof taskExecutionModeSchema>;
export type TaskExecutionRequest = z.infer<typeof taskExecutionRequestSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Job = z.infer<typeof jobSchema>;
export type ProviderOutputChunk = z.infer<typeof providerOutputChunkSchema>;
export type ProviderExitInfo = z.infer<typeof providerExitInfoSchema>;
export type TaskResult = z.infer<typeof taskResultSchema>;
export type TaskStartResponse = z.infer<typeof taskStartResponseSchema>;
export type TaskStopRequest = z.infer<typeof taskStopRequestSchema>;
export type TaskOutputEvent = z.infer<typeof taskOutputEventSchema>;
export type TaskExitEvent = z.infer<typeof taskExitEventSchema>;
export type JobProviderDebugEvent = z.infer<typeof jobProviderDebugEventSchema>;
