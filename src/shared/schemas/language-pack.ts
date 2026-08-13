import { z } from "zod";

import { DEFAULT_LOCALE, LOCALE_PATTERN, TRANSLATION_NAMESPACES } from "@shared/constants/locales";

export const localeIdSchema = z.string().regex(LOCALE_PATTERN);

export const textDirectionSchema = z.enum(["ltr", "rtl"]);

export const translationNamespaceSchema = z.enum(TRANSLATION_NAMESPACES);

export const languagePackManifestSchema = z
  .object({
    id: localeIdSchema.refine((locale) => locale !== DEFAULT_LOCALE, {
      message: "The default en-US locale is bundled and must not be installed as a language pack."
    }),
    name: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    forgepilotProtocol: z.string().min(1),
    direction: textDirectionSchema,
    fallback: localeIdSchema.default(DEFAULT_LOCALE),
    namespaces: z.array(translationNamespaceSchema).min(1),
    checksum: z.string().min(32),
    signature: z.string().min(32).nullable()
  })
  .strict();

export const translationFileSchema = z.record(z.string().min(1), z.string());

export type LocaleId = z.infer<typeof localeIdSchema>;
export type TextDirection = z.infer<typeof textDirectionSchema>;
export type TranslationNamespace = z.infer<typeof translationNamespaceSchema>;
export type LanguagePackManifest = z.infer<typeof languagePackManifestSchema>;
export type TranslationFile = z.infer<typeof translationFileSchema>;
