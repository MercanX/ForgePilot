import { z } from "zod";

export const appPingRequestSchema = z.object({}).strict();

export const appPingResponseSchema = z
  .object({
    ok: z.literal(true),
    appName: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    timestamp: z.string().datetime()
  })
  .strict();

export type AppPingRequest = z.infer<typeof appPingRequestSchema>;
export type AppPingResponse = z.infer<typeof appPingResponseSchema>;
