export const DEFAULT_LOCALE = "en-US";

export const TRANSLATION_NAMESPACES = [
  "common",
  "renderer",
  "errors",
  "settings",
  "providers"
] as const;

export const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|\d{3})$/;
