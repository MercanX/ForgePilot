import { z } from "zod";

import {
  DESKTOP_PROTOCOL_VERSION,
  SUPPORTED_CAPABILITIES
} from "@shared/constants/protocolVersion";

import { findingSchema } from "./finding";
import { jobSchema, taskResultSchema, taskSchema } from "./job";
import { projectSchema } from "./project";
import { providerIdSchema } from "./provider";
import { workflowStageSchema } from "./run";

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
    capabilities: z.array(capabilitySchema)
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

export type HandshakeRequest = z.infer<typeof handshakeRequestSchema>;
export type HandshakeResponse = z.infer<typeof handshakeResponseSchema>;
export type WorkflowResponse = z.infer<typeof workflowResponseSchema>;
export type RequestJobRequest = z.infer<typeof requestJobRequestSchema>;
export type SubmitResultResponse = z.infer<typeof submitResultResponseSchema>;
export type HeartbeatRequest = z.infer<typeof heartbeatRequestSchema>;
export type FailJobRequest = z.infer<typeof failJobRequestSchema>;
export type SyncFindingsRequest = z.infer<typeof syncFindingsRequestSchema>;
