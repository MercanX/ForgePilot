import { z } from "zod";

import {
  DESKTOP_PROTOCOL_VERSION,
  SUPPORTED_CAPABILITIES
} from "@shared/constants/protocolVersion";

import { stageExecutionOutcomeSchema } from "./execution";
import { findingSchema } from "./finding";
import { jobSchema, taskResultSchema, taskSchema } from "./job";
import { projectSchema } from "./project";
import { providerIdSchema } from "./provider";
import { workflowStageSchema } from "./run";

export const cloudConnectionStatusSchema = z
  .object({
    connected: z.boolean(),
    message: z.string(),
    serverVersion: z.string().min(1).nullable()
  })
  .strict();

export const capabilitySchema = z.enum(SUPPORTED_CAPABILITIES);

export const handshakeRequestSchema = z
  .object({
    desktopVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    protocolVersion: z.literal(DESKTOP_PROTOCOL_VERSION),
    supportedCapabilities: z.array(capabilitySchema).min(1)
  })
  .strict();

export const handshakeResponseSchema = z
  .object({
    status: z.enum(["ok", "update-recommended", "update-required"]),
    serverVersion: z.string().min(1),
    protocolVersion: z.string().min(1),
    message: z.string().nullable()
  })
  .strict();

export const workflowResponseSchema = z
  .object({
    workflowId: z.string().min(1),
    workflowVersion: z.string().min(1),
    stages: z.array(workflowStageSchema)
  })
  .strict();

export const requestJobRequestSchema = z
  .object({
    project: projectSchema,
    providerId: providerIdSchema,
    capabilities: z.array(capabilitySchema),
    localExecution: z.unknown().nullable().default(null)
  })
  .strict();

export const requestJobResponseSchema = jobSchema;

export const getTaskResponseSchema = taskSchema;

export const submitResultRequestSchema = taskResultSchema;

export const submitResultResponseSchema = z
  .object({
    accepted: z.literal(true),
    findings: z.array(findingSchema).default([])
  })
  .strict();

export const heartbeatRequestSchema = z
  .object({
    jobId: z.string().uuid(),
    timestamp: z.string().datetime()
  })
  .strict();

export const failJobRequestSchema = z
  .object({
    jobId: z.string().uuid(),
    reason: z.enum([
      "user-cancelled",
      "timeout",
      "provider-error",
      "validation-error",
      "client-error"
    ]),
    message: z.string().min(1).nullable()
  })
  .strict();

export const syncFindingsRequestSchema = z
  .object({
    runId: z.string().uuid(),
    findings: z.array(findingSchema)
  })
  .strict();

export const syncFindingsResponseSchema = z.object({ accepted: z.literal(true) }).strict();

export const jobRunRequestSchema = z
  .object({
    project: projectSchema,
    providerId: providerIdSchema,
    model: z.string().min(1).nullable().default(null),
    newRun: z.boolean().default(false),
    stageId: z.string().min(1).nullable().default(null),
    serverUrl: z.string().url().default("http://localhost:4317"),
    outputLanguage: z.string().trim().min(1).max(64).default("Turkish"),
    timeoutMs: z.number().int().positive().max(10_800_000).default(5_400_000)
  })
  .strict();

export const jobRunResponseSchema = z
  .object({
    job: jobSchema.nullable(),
    result: taskResultSchema.nullable(),
    stageOutcome: stageExecutionOutcomeSchema,
    submitAccepted: z.boolean(),
    syncedFindings: z.array(findingSchema)
  })
  .strict();

export const jobRunProgressEventSchema = z
  .object({
    message: z.string().min(1),
    progress: z.number().int().min(0).max(100),
    projectId: z.string().uuid(),
    stageId: z.string().min(1).nullable(),
    status: z.enum(["started", "completed", "blocked", "failed", "skipped"]),
    stepId: z.string().min(1)
  })
  .strict();

export const cloudStatusRequestSchema = z
  .object({
    serverUrl: z.string().url().default("http://localhost:4317")
  })
  .strict();

export type HandshakeRequest = z.infer<typeof handshakeRequestSchema>;
export type HandshakeResponse = z.infer<typeof handshakeResponseSchema>;
export type WorkflowResponse = z.infer<typeof workflowResponseSchema>;
export type RequestJobRequest = z.infer<typeof requestJobRequestSchema>;
export type RequestJobResponse = z.infer<typeof requestJobResponseSchema>;
export type GetTaskResponse = z.infer<typeof getTaskResponseSchema>;
export type SubmitResultResponse = z.infer<typeof submitResultResponseSchema>;
export type HeartbeatRequest = z.infer<typeof heartbeatRequestSchema>;
export type FailJobRequest = z.infer<typeof failJobRequestSchema>;
export type SyncFindingsRequest = z.infer<typeof syncFindingsRequestSchema>;
export type SyncFindingsResponse = z.infer<typeof syncFindingsResponseSchema>;
export type JobRunRequest = z.infer<typeof jobRunRequestSchema>;
export type JobRunResponse = z.infer<typeof jobRunResponseSchema>;
export type JobRunProgressEvent = z.infer<typeof jobRunProgressEventSchema>;
export type CloudStatusRequest = z.infer<typeof cloudStatusRequestSchema>;
export type CloudConnectionStatus = z.infer<typeof cloudConnectionStatusSchema>;
