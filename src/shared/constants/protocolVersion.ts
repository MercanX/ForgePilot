export const DESKTOP_PROTOCOL_VERSION = "2";

export const SUPPORTED_CAPABILITIES = [
  "provider:claude-code",
  "provider:codex",
  "job:heartbeat",
  "job:fail",
  "language-pack:local",
  "stage-execution:directives-v1"
] as const;
