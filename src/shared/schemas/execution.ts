import { z } from "zod";

import { SUPPORTED_CAPABILITIES } from "@shared/constants/protocolVersion";

import { jobSchema } from "./job";
import { projectSchema } from "./project";
import { providerIdSchema } from "./provider";

export const executionCapabilitySchema = z.enum(SUPPORTED_CAPABILITIES);

const directiveBaseSchema = z.object({
  id: z.string().uuid(),
  messageCompleted: z.string().min(1),
  messageStarted: z.string().min(1),
  progressCompleted: z.number().int().min(0).max(100),
  progressStarted: z.number().int().min(0).max(100)
});

export const localExecutionDirectiveSchema = directiveBaseSchema
  .extend({
    inputs: z.record(z.string(), z.unknown()).default({}),
    kind: z.literal("local"),
    operation: z.string().min(1),
    saveAs: z.string().min(1).nullable().default(null)
  })
  .strict();

export const providerExecutionDirectiveSchema = directiveBaseSchema
  .extend({
    job: jobSchema,
    kind: z.literal("provider"),
    mode: z.enum(["verification", "semantic"]),
    outputSchema: z.record(z.string(), z.unknown()).nullable().default(null),
    requireOk: z.boolean().default(false),
    saveAs: z.string().min(1).nullable().default(null)
  })
  .strict();

export const terminalExecutionDirectiveSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.literal("terminal"),
    message: z.string().min(1),
    outcome: z.enum(["completed", "blocked", "failed"]),
    progress: z.number().int().min(0).max(100)
  })
  .strict();

export const stageExecutionDirectiveSchema = z.discriminatedUnion("kind", [
  localExecutionDirectiveSchema,
  providerExecutionDirectiveSchema,
  terminalExecutionDirectiveSchema
]);

export const executionPreviousResultSchema = z
  .object({
    directiveId: z.string().uuid(),
    message: z.string().min(1).nullable().default(null),
    output: z.unknown().nullable().default(null),
    status: z.enum(["completed", "failed", "blocked"])
  })
  .strict();

export const stageExecutionNextRequestSchema = z
  .object({
    capabilities: z.array(executionCapabilitySchema).min(1),
    executionId: z.string().uuid().nullable().default(null),
    localOperations: z.array(z.string().min(1)).default([]),
    newRun: z.boolean().default(false),
    previous: executionPreviousResultSchema.nullable().default(null),
    project: projectSchema,
    providerId: providerIdSchema,
    outputLanguage: z.string().trim().min(1).max(64).default("Turkish"),
    timeoutMs: z.number().int().positive().max(10_800_000).default(5_400_000),
    stageId: z.string().min(1)
  })
  .strict();

export const stageExecutionNextResponseSchema = z
  .object({
    directive: stageExecutionDirectiveSchema,
    executionId: z.string().uuid(),
    stageId: z.string().min(1)
  })
  .strict();

export const stageExecutionOutcomeSchema = z
  .object({
    executionId: z.string().uuid(),
    message: z.string().min(1),
    progress: z.number().int().min(0).max(100),
    stageId: z.string().min(1),
    status: z.enum(["completed", "blocked", "failed"])
  })
  .strict();

export type LocalExecutionDirective = z.infer<typeof localExecutionDirectiveSchema>;
export type ProviderExecutionDirective = z.infer<typeof providerExecutionDirectiveSchema>;
export type StageExecutionDirective = z.infer<typeof stageExecutionDirectiveSchema>;
export type ExecutionPreviousResult = z.infer<typeof executionPreviousResultSchema>;
export type StageExecutionNextRequest = z.infer<typeof stageExecutionNextRequestSchema>;
export type StageExecutionNextResponse = z.infer<typeof stageExecutionNextResponseSchema>;
export type StageExecutionOutcome = z.infer<typeof stageExecutionOutcomeSchema>;
