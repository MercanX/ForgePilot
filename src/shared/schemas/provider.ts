import { z } from "zod";

import { PROVIDER_ID_VALUES } from "@shared/constants/providerIds";

export const providerIdSchema = z.enum(PROVIDER_ID_VALUES);

export const providerStatusSchema = z.enum([
  "not-installed",
  "installed",
  "authenticated",
  "busy",
  "error"
]);

export const providerAuthStatusSchema = z.enum([
  "unknown",
  "authenticated",
  "unauthenticated",
  "error"
]);

export const providerVersionInfoSchema = z
  .object({
    providerId: providerIdSchema,
    version: z.string().min(1).nullable(),
    rawOutput: z.string().nullable()
  })
  .strict();

export const providerDetectionResultSchema = z
  .object({
    id: providerIdSchema,
    label: z.string().min(1),
    installed: z.boolean(),
    status: providerStatusSchema,
    version: providerVersionInfoSchema.nullable(),
    errorMessage: z.string().min(1).nullable()
  })
  .strict();

export type ProviderId = z.infer<typeof providerIdSchema>;
export type ProviderStatus = z.infer<typeof providerStatusSchema>;
export type ProviderAuthStatus = z.infer<typeof providerAuthStatusSchema>;
export type ProviderVersionInfo = z.infer<typeof providerVersionInfoSchema>;
export type ProviderDetectionResult = z.infer<typeof providerDetectionResultSchema>;
