import { z } from "zod";

import { jobRunRequestSchema, jobRunResponseSchema } from "./cloud-api";

export const stageRepairStatusSchema = z.enum(["needs_manual", "ready_to_save"]);

export const stageRepairStateSchema = z
  .object({
    available: z.boolean(),
    autoAttempts: z.number().int().min(0),
    canManualRepair: z.boolean(),
    canSave: z.boolean(),
    changedPaths: z.array(z.string()),
    manualAttempts: z.number().int().min(0),
    maxAutoAttempts: z.number().int().positive(),
    originalJson: z.string().nullable(),
    repairBaseWarning: z.string().nullable(),
    stageId: z.string().min(1),
    status: stageRepairStatusSchema.nullable(),
    updatedAt: z.string().datetime().nullable(),
    validationErrors: z.array(z.string()),
    workingJson: z.string().nullable()
  })
  .strict();

export const stageRepairGetRequestSchema = z
  .object({
    projectRootPath: z.string().min(1),
    stageId: z.string().min(1)
  })
  .strict();

export const stageRepairValidateRequestSchema = stageRepairGetRequestSchema
  .extend({ workingJson: z.string().min(1) })
  .strict();

export const stageRepairActionRequestSchema = jobRunRequestSchema
  .extend({
    newRun: z.literal(false).default(false),
    stageId: z.string().min(1)
  })
  .strict();

export const stageRepairImportRequestSchema = stageRepairActionRequestSchema
  .extend({
    workingJson: z.string().min(1)
  })
  .strict();

export const stageRepairSaveResponseSchema = jobRunResponseSchema;

export type StageRepairState = z.infer<typeof stageRepairStateSchema>;
export type StageRepairGetRequest = z.infer<typeof stageRepairGetRequestSchema>;
export type StageRepairValidateRequest = z.infer<typeof stageRepairValidateRequestSchema>;
export type StageRepairActionRequest = z.infer<typeof stageRepairActionRequestSchema>;
export type StageRepairImportRequest = z.infer<typeof stageRepairImportRequestSchema>;
