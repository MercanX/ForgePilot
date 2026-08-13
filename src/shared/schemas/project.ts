import { z } from "zod";

const absolutePathSchema = z
  .string()
  .refine(
    (value) =>
      value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value),
    "Path must be absolute."
  );

export const projectSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1),
    rootPath: absolutePathSchema,
    addedAt: z.string().datetime(),
    lastOpenedAt: z.string().datetime().nullable()
  })
  .strict();

export const projectListResponseSchema = z.array(projectSchema);

export const projectAddRequestSchema = z.object({}).strict();

export const projectRemoveRequestSchema = z
  .object({
    projectId: z.string().uuid()
  })
  .strict();

export const projectOpenRequestSchema = projectRemoveRequestSchema;

export type Project = z.infer<typeof projectSchema>;
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;
export type ProjectAddRequest = z.infer<typeof projectAddRequestSchema>;
export type ProjectRemoveRequest = z.infer<typeof projectRemoveRequestSchema>;
export type ProjectOpenRequest = z.infer<typeof projectOpenRequestSchema>;
