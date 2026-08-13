import { z } from "zod";

export const findingSeveritySchema = z.enum(["critical", "high", "medium", "low", "info"]);

export const findingStatusSchema = z.enum([
  "open",
  "acknowledged",
  "in-progress",
  "resolved",
  "ignored",
  "reopened"
]);

export const findingSchema = z
  .object({
    id: z.string().uuid(),
    runId: z.string().uuid(),
    stageId: z.string().min(1).nullable(),
    agent: z.string().min(1).nullable(),
    severity: findingSeveritySchema,
    status: findingStatusSchema,
    title: z.string().min(1),
    description: z.string().min(1),
    recommendation: z.string().nullable(),
    filePath: z.string().min(1).nullable(),
    line: z.number().int().positive().nullable(),
    createdAt: z.string().datetime(),
    syncedAt: z.string().datetime().nullable()
  })
  .strict();

export type FindingSeverity = z.infer<typeof findingSeveritySchema>;
export type FindingStatus = z.infer<typeof findingStatusSchema>;
export type Finding = z.infer<typeof findingSchema>;
