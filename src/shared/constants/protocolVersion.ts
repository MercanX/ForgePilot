export const DESKTOP_PROTOCOL_VERSION = "1";

export const SUPPORTED_CAPABILITIES = [
  "provider:claude-code",
  "provider:codex",
  "job:heartbeat",
  "job:fail",
  "language-pack:local"
] as const;
