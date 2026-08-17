import { PROVIDER_IDS } from "@shared/constants/providerIds";
import { SUPPORTED_CAPABILITIES } from "@shared/constants/protocolVersion";
import {
  getTaskResponseSchema,
  submitResultResponseSchema,
  syncFindingsResponseSchema,
  type JobRunProgressEvent,
  type JobRunRequest,
  type JobRunResponse
} from "@shared/schemas/cloud-api";
import {
  stageExecutionNextResponseSchema,
  type ExecutionPreviousResult,
  type ProviderExecutionDirective,
  type StageExecutionNextRequest,
  type StageExecutionNextResponse
} from "@shared/schemas/execution";
import type {
  Job,
  JobProviderDebugEvent,
  ProviderOutputChunk,
  TaskResult,
  TaskStartResponse
} from "@shared/schemas/job";
import type { StageRepairState } from "@shared/schemas/repair";

import { createHttpClient, type HttpClient } from "../api/httpClient";
import { createTaskExecutionService, type TaskExecutionService } from "../tasks/taskExecutionService";

import { createLocalOperationRegistry, type LocalOperationRegistry } from "./localOperationRegistry";
import { createStageExecutionJournal, type StageExecutionJournal } from "./stageExecutionJournal";
import {
  createStageRepairStore,
  MAX_AUTO_REPAIR_ATTEMPTS,
  type RepairAuthority,
  type StageRepairRecord,
  type StageRepairStore
} from "./stageRepairStore";

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_DIRECTIVES_PER_RUN = 100;

export const PROVIDER_FAST_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000] as const;
export const PROVIDER_WATCH_RETRY_INTERVAL_MS = 300_000;

const RETRYABLE_PROVIDER_FAILURE_PATTERNS = [
  "api error",
  "connection lost",
  "connection reset",
  "econnreset",
  "etimedout",
  "eai_again",
  "enetunreach",
  "network error",
  "network request failed",
  "socket hang up",
  "fetch failed",
  "temporarily unavailable",
  "service unavailable",
  "overloaded",
  "rate limit",
  "too many requests",
  "http 429",
  "http 502",
  "http 503",
  "http 504"
] as const;

type ProgressListener = (event: JobRunProgressEvent) => void;
type DebugListener = (event: JobProviderDebugEvent) => void;

type StageExecutionServiceOptions = {
  createClient?: (serverUrl: string) => HttpClient;
  localOperationRegistry?: LocalOperationRegistry;
  taskExecutionService?: TaskExecutionService;
  createJournal?: (projectRootPath: string) => StageExecutionJournal;
  createRepairStore?: (projectRootPath: string) => StageRepairStore;
  providerRetryDelaysMs?: readonly number[];
  providerWatchIntervalMs?: number;
};

export type StageExecutionService = {
  getRepairState: (projectRootPath: string, stageId: string) => Promise<StageRepairState>;
  retryProviderNow: (
    projectId: string,
    stageId: string
  ) => { accepted: boolean; message: string };
  importRepairJson: (
    request: JobRunRequest & { stageId: string; workingJson: string },
    onProgress?: ProgressListener,
    onDebug?: DebugListener
  ) => Promise<StageRepairState>;
  manualRepair: (
    request: JobRunRequest & { stageId: string },
    onProgress?: ProgressListener,
    onDebug?: DebugListener
  ) => Promise<StageRepairState>;
  run: (
    request: JobRunRequest & { stageId: string },
    onProgress?: ProgressListener,
    onDebug?: DebugListener
  ) => Promise<JobRunResponse>;
  saveRepair: (
    request: JobRunRequest & { stageId: string },
    onProgress?: ProgressListener,
    onDebug?: DebugListener
  ) => Promise<JobRunResponse>;
  validateRepairJson: (
    projectRootPath: string,
    stageId: string,
    workingJson: string
  ) => Promise<StageRepairState>;
};

type ProviderExecutionResult = {
  autoRepairAttempts: number;
  changedPaths: string[];
  job: Job;
  originalOutput: Record<string, unknown> | null;
  outputContractErrors: string[];
  parsedOutput: Record<string, unknown> | null;
  providerOutputText: string | null;
  repairBaseViable: boolean;
  repairPending: boolean;
  result: TaskResult;
  submitAccepted: boolean;
  syncedFindings: TaskResult["findings"];
};

const emit = (
  request: JobRunRequest & { stageId: string },
  onProgress: ProgressListener | undefined,
  event: Omit<JobRunProgressEvent, "projectId" | "stageId">
): void => {
  onProgress?.({
    ...event,
    projectId: request.project.id,
    stageId: request.stageId
  });
};

const emitDebug = (
  request: JobRunRequest & { stageId: string },
  onDebug: DebugListener | undefined,
  event: Omit<JobProviderDebugEvent, "projectId" | "stageId" | "providerId" | "model">
): void => {
  onDebug?.({
    ...event,
    projectId: request.project.id,
    stageId: request.stageId,
    providerId: request.providerId,
    model: request.model
  });
};

/**
 * Provider output is not guaranteed to be raw JSON. Claude/Codex may wrap the
 * final object in a Markdown fence, prepend a short explanation, or return a
 * CLI JSON envelope whose `result` field contains the model text. Recover the
 * last valid object without trusting prose around it.
 */
const ANSI_PATTERN = new RegExp(
  String.raw`\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))`,
  "g"
);

const stripAnsi = (value: string): string => value.replace(ANSI_PATTERN, "");

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseJsonObjectText = (value: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * Extract complete JSON objects while respecting quoted strings and escapes.
 * This lets us recover `{...}` even when text follows it (for example ```).
 */
const extractJsonObjects = (text: string): string[] => {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return objects;
};

const unwrapProviderJsonEnvelope = (
  parsed: Record<string, unknown>
): Record<string, unknown> | null => {
  // Some provider versions may return a structured_output envelope. Prefer it
  // when present, while remaining compatible with plain --output-format json.
  if (
    typeof parsed.structured_output === "object" &&
    parsed.structured_output !== null &&
    !Array.isArray(parsed.structured_output)
  ) {
    return parsed.structured_output as Record<string, unknown>;
  }

  if (typeof parsed.structured_output === "string") {
    const nested = parseProviderText(parsed.structured_output);
    if (nested) {
      return nested;
    }
  }

  // Plain `--output-format json` places the textual response in `result`.
  if (typeof parsed.result === "string") {
    const nested = parseProviderText(parsed.result);
    if (nested) {
      return nested;
    }
  }

  return parsed;
};

const parseProviderText = (rawText: string): Record<string, unknown> | null => {
  const text = stripAnsi(rawText).trim();
  if (!text) {
    return null;
  }

  const whole = parseJsonObjectText(text);
  if (whole) {
    return unwrapProviderJsonEnvelope(whole);
  }

  // Prefer explicit fenced blocks first. A model often returns exactly this:
  // ```json\n{...}\n```
  const fencedPattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  const fencedMatches = [...text.matchAll(fencedPattern)];
  for (let index = fencedMatches.length - 1; index >= 0; index -= 1) {
    const fenced = fencedMatches[index]?.[1]?.trim();
    if (!fenced) {
      continue;
    }

    const direct = parseJsonObjectText(fenced);
    if (direct) {
      return unwrapProviderJsonEnvelope(direct);
    }

    const nestedObjects = extractJsonObjects(fenced);
    for (let nestedIndex = nestedObjects.length - 1; nestedIndex >= 0; nestedIndex -= 1) {
      const nestedObject = nestedObjects[nestedIndex];
      if (!nestedObject) {
        continue;
      }

      const parsed = parseJsonObjectText(nestedObject);
      if (parsed) {
        return unwrapProviderJsonEnvelope(parsed);
      }
    }
  }

  // Finally recover the last complete JSON object from arbitrary prose.
  const objects = extractJsonObjects(text);
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const object = objects[index];
    if (!object) {
      continue;
    }

    const parsed = parseJsonObjectText(object);
    if (parsed) {
      return unwrapProviderJsonEnvelope(parsed);
    }
  }

  return null;
};


const parseProviderTextObjects = (rawText: string): Record<string, unknown>[] => {
  const text = stripAnsi(rawText).trim();
  if (!text) return [];

  const candidates: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const add = (value: Record<string, unknown> | null): void => {
    if (!value) return;
    let key: string;
    try {
      key = JSON.stringify(value);
    } catch {
      return;
    }
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(value);
  };
  const addParsed = (jsonText: string): void => {
    const parsed = parseJsonObjectText(jsonText.trim());
    if (parsed) add(unwrapProviderJsonEnvelope(parsed));
  };

  const whole = parseJsonObjectText(text);
  if (whole) add(unwrapProviderJsonEnvelope(whole));

  const fencedPattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (const match of text.matchAll(fencedPattern)) {
    const fenced = match[1]?.trim();
    if (!fenced) continue;
    addParsed(fenced);
    for (const objectText of extractJsonObjects(fenced)) addParsed(objectText);
  }

  for (const objectText of extractJsonObjects(text)) addParsed(objectText);
  return candidates;
};

type ProviderStreamTextCandidate = {
  source: "claude-result" | "claude-assistant";
  text: string;
};

const parseJsonLines = (value: string): Record<string, unknown>[] =>
  stripAnsi(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseJsonObjectText(line))
    .filter((item): item is Record<string, unknown> => item !== null);

/**
 * Claude Code's terminal `type=result` event is not always a byte-for-byte copy
 * of the final assistant message. Large responses can arrive there as a tail
 * fragment even though the preceding assistant event contains the complete
 * JSON document. Keep both as candidates and let contract validation select
 * the authoritative root object. Tool-use/thinking content is never considered.
 */
const findProviderStreamTextCandidates = (
  chunks: ProviderOutputChunk[]
): ProviderStreamTextCandidate[] => {
  const stdout = chunks
    .filter((chunk) => chunk.stream === "stdout")
    .map((chunk) => chunk.text)
    .join("");
  const events = parseJsonLines(stdout);
  const resultCandidates: ProviderStreamTextCandidate[] = [];
  const assistantCandidates: ProviderStreamTextCandidate[] = [];
  const chronologicalAssistantText: string[] = [];

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) {
      continue;
    }

    if (event.type === "result") {
      if (typeof event.structured_output === "string" && event.structured_output.trim()) {
        resultCandidates.push({ source: "claude-result", text: event.structured_output });
      } else if (isJsonObject(event.structured_output)) {
        resultCandidates.push({
          source: "claude-result",
          text: JSON.stringify(event.structured_output)
        });
      }
      if (typeof event.result === "string" && event.result.trim()) {
        resultCandidates.push({ source: "claude-result", text: event.result });
      }
      continue;
    }

    if (event.type !== "assistant" || !isJsonObject(event.message)) {
      continue;
    }

    const content = Array.isArray(event.message.content) ? event.message.content : [];
    const visibleText = content
      .filter((block): block is Record<string, unknown> => isJsonObject(block))
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .filter((text) => text.trim().length > 0)
      .join("\n");

    if (visibleText) {
      assistantCandidates.push({ source: "claude-assistant", text: visibleText });
      chronologicalAssistantText.unshift(visibleText);
    }
  }

  // Claude may split one very large final JSON document across several
  // assistant events. Individual event parsing then sees only fragments while
  // the terminal result event may contain only the tail. Reassemble the visible
  // assistant text in chronological order so braces spanning event boundaries
  // can be parsed as one authoritative envelope.
  const combinedAssistant = chronologicalAssistantText.join("").trim();
  if (combinedAssistant) {
    assistantCandidates.unshift({ source: "claude-assistant", text: combinedAssistant });
  }

  return [...resultCandidates, ...assistantCandidates];
};

const safeJsonPreview = (value: unknown, maxLength = 1600): string | null => {
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > maxLength ? `${text.slice(0, maxLength)}\n…` : text;
  } catch {
    return null;
  }
};

const describeProviderStreamEvent = (event: Record<string, unknown>): { message: string; text: string | null } => {
  const type = typeof event.type === "string" ? event.type : "event";
  const subtype = typeof event.subtype === "string" ? event.subtype : null;

  if (type === "system" && subtype === "init") {
    const model = typeof event.model === "string" ? event.model : "unknown";
    const permissionMode = typeof event.permissionMode === "string" ? event.permissionMode : "unknown";
    return {
      message: `Claude initialized (model=${model}, permission=${permissionMode}).`,
      text: null
    };
  }

  if (type === "assistant" && isJsonObject(event.message)) {
    const content = Array.isArray(event.message.content) ? event.message.content : [];
    const visible: string[] = [];
    for (const block of content) {
      if (!isJsonObject(block)) {
        continue;
      }
      if (block.type === "tool_use") {
        const toolName = typeof block.name === "string" ? block.name : "tool";
        const input = safeJsonPreview(block.input, 1200);
        visible.push(input ? `TOOL ${toolName}\n${input}` : `TOOL ${toolName}`);
      } else if (block.type === "text" && typeof block.text === "string") {
        visible.push(block.text);
      }
      // Intentionally ignore thinking/redacted_thinking blocks.
    }
    return {
      message: "Claude assistant event.",
      text: visible.length > 0 ? visible.join("\n\n") : null
    };
  }

  if (type === "user") {
    return {
      message: "Claude tool/user event received.",
      text: null
    };
  }

  if (type === "result") {
    const turns = typeof event.num_turns === "number" ? event.num_turns : null;
    const isError = event.is_error === true;
    return {
      message: `Claude final result (${isError ? "error" : "success"}${turns !== null ? `, turns=${turns}` : ""}).`,
      text: typeof event.result === "string" ? event.result : null
    };
  }

  return {
    message: `Claude stream event: ${subtype ? `${type}/${subtype}` : type}.`,
    text: null
  };
};

type JsonSchema = Record<string, unknown>;

const resolveLocalSchemaRef = (root: JsonSchema, ref: string): JsonSchema | null => {
  if (!ref.startsWith("#/")) {
    return null;
  }

  let current: unknown = root;
  for (const rawSegment of ref.slice(2).split("/")) {
    const segment = rawSegment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isJsonObject(current) || !(segment in current)) {
      return null;
    }
    current = current[segment];
  }

  return isJsonObject(current) ? current : null;
};

const jsonValuesEqual = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const validateJsonSchemaValue = (
  value: unknown,
  schema: JsonSchema,
  root: JsonSchema,
  path = "$"
): string[] => {
  if (typeof schema.$ref === "string") {
    const resolved = resolveLocalSchemaRef(root, schema.$ref);
    return resolved
      ? validateJsonSchemaValue(value, resolved, root, path)
      : [`${path}: unresolved schema ref ${schema.$ref}`];
  }

  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf.filter(isJsonObject);
    if (branches.length > 0) {
      const branchErrors = branches.map((branch) => validateJsonSchemaValue(value, branch, root, path));
      if (!branchErrors.some((errors) => errors.length === 0)) {
        return [`${path}: value does not match any allowed schema`];
      }
    }
  }

  if ("const" in schema && !jsonValuesEqual(schema.const, value)) {
    return [`${path}: value does not match the required const`];
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => jsonValuesEqual(candidate, value))) {
    return [`${path}: value is not one of the allowed enum values`];
  }

  const expectedType = schema.type;
  if (typeof expectedType === "string") {
    const matches =
      expectedType === "object"
        ? isJsonObject(value)
        : expectedType === "array"
          ? Array.isArray(value)
          : expectedType === "string"
            ? typeof value === "string"
            : expectedType === "number"
              ? typeof value === "number" && Number.isFinite(value)
              : expectedType === "integer"
                ? typeof value === "number" && Number.isInteger(value)
                : expectedType === "boolean"
                  ? typeof value === "boolean"
                  : expectedType === "null"
                    ? value === null
                    : true;
    if (!matches) {
      return [`${path}: expected ${expectedType}`];
    }
  }

  const errors: string[] = [];

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push(`${path}: string is shorter than minLength ${schema.minLength}`);
    }
    if (schema.format === "date-time") {
      const isoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
      if (!isoDateTime.test(value) || Number.isNaN(Date.parse(value))) {
        errors.push(`${path}: string is not a valid date-time with timezone`);
      }
    }
    if (typeof schema.pattern === "string") {
      try {
        if (!new RegExp(schema.pattern).test(value)) {
          errors.push(`${path}: string does not match required pattern`);
        }
      } catch {
        errors.push(`${path}: schema contains an invalid pattern`);
      }
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`${path}: array has fewer than ${schema.minItems} items`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push(`${path}: array has more than ${schema.maxItems} items`);
    }
    if (isJsonObject(schema.items)) {
      value.forEach((item, index) => {
        errors.push(...validateJsonSchemaValue(item, schema.items as JsonSchema, root, `${path}[${index}]`));
      });
    }
  }

  if (isJsonObject(value)) {
    const required = Array.isArray(schema.required)
      ? schema.required.filter((entry): entry is string => typeof entry === "string")
      : [];
    for (const key of required) {
      if (!(key in value)) {
        errors.push(`${path}.${key}: required property is missing`);
      }
    }

    const properties = isJsonObject(schema.properties) ? schema.properties : {};
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (key in value && isJsonObject(propertySchema)) {
        errors.push(...validateJsonSchemaValue(value[key], propertySchema, root, `${path}.${key}`));
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          errors.push(`${path}.${key}: additional property is not allowed`);
        }
      }
    }
  }

  return errors;
};

export const validateOutputContract = (
  value: Record<string, unknown> | null,
  schema: Record<string, unknown> | null
): string[] => {
  if (!schema || value === null) {
    return value === null && schema ? ["$: provider did not return a JSON object"] : [];
  }
  return validateJsonSchemaValue(value, schema, schema);
};

type StructuralOutputRepair = {
  movedResultKeys: string[];
  value: Record<string, unknown> | null;
};

/**
 * A recurring provider formatting defect closes `result` too early and then
 * emits fields that the schema requires inside `$.result` at the envelope
 * root. This repair is deliberately structural only: it moves an existing
 * value without inventing, deleting, or rewriting semantic content.
 */
export const repairProviderOutputStructure = (
  value: Record<string, unknown> | null,
  schema: Record<string, unknown> | null
): StructuralOutputRepair => {
  if (!value || !schema || !isJsonObject(value.result)) {
    return { movedResultKeys: [], value };
  }

  const rootProperties = isJsonObject(schema.properties) ? schema.properties : null;
  const resultSchema = rootProperties && isJsonObject(rootProperties.result)
    ? rootProperties.result
    : null;
  const resultProperties = resultSchema && isJsonObject(resultSchema.properties)
    ? resultSchema.properties
    : null;

  if (!rootProperties || !resultProperties) {
    return { movedResultKeys: [], value };
  }

  const repairedRoot: Record<string, unknown> = { ...value };
  const repairedResult: Record<string, unknown> = { ...(value.result as Record<string, unknown>) };
  const movedResultKeys: string[] = [];

  for (const key of Object.keys(resultProperties)) {
    if (key in repairedResult || !(key in repairedRoot) || key in rootProperties) {
      continue;
    }

    repairedResult[key] = repairedRoot[key];
    delete repairedRoot[key];
    movedResultKeys.push(key);
  }

  if (movedResultKeys.length === 0) {
    return { movedResultKeys, value };
  }

  repairedRoot.result = repairedResult;
  return { movedResultKeys, value: repairedRoot };
};

type JsonPatchOperation = {
  from?: string;
  op: "add" | "move" | "remove" | "replace";
  path: string;
  value?: unknown;
};

type RepairPatchResponse = {
  patches: JsonPatchOperation[];
};

const REPAIR_PATCH_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["patches"],
  properties: {
    patches: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["op", "path"],
        properties: {
          op: { type: "string", enum: ["add", "replace", "remove", "move"] },
          path: { type: "string", minLength: 2 },
          from: { type: "string", minLength: 2 },
          value: {}
        }
      }
    }
  }
};

const deepCloneJsonObject = (value: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

const authorityFromSchema = (
  schema: Record<string, unknown> | null,
  current: RepairAuthority = {}
): RepairAuthority => {
  if (!schema || !isJsonObject(schema.properties)) return current;
  const properties = schema.properties;
  const next: RepairAuthority = { ...current };
  for (const key of ["schema_version", "substage"] as const) {
    const property = properties[key];
    if (isJsonObject(property) && typeof property.const === "string") {
      next[key] = property.const;
    }
  }
  return next;
};

const mergeAuthority = (
  authority: RepairAuthority,
  value: unknown,
  schema: Record<string, unknown> | null = null
): RepairAuthority => {
  const next = authorityFromSchema(schema, authority);
  if (!isJsonObject(value)) return next;
  if (typeof value.audit_id === "string" && value.audit_id.trim()) next.audit_id = value.audit_id;
  if (typeof value.workspace_hash === "string" && value.workspace_hash.trim()) {
    next.workspace_hash = value.workspace_hash;
  }
  if (typeof value.substage === "string" && value.substage.trim()) next.substage = value.substage;
  if (typeof value.schema_version === "string" && value.schema_version.trim()) {
    next.schema_version = value.schema_version;
  }
  return next;
};

const enforceAuthority = (
  value: Record<string, unknown>,
  authority: RepairAuthority
): { changedPaths: string[]; value: Record<string, unknown> } => {
  const next = deepCloneJsonObject(value);
  const changedPaths: string[] = [];
  for (const [key, expected] of Object.entries(authority)) {
    if (typeof expected !== "string" || !expected) continue;
    if (next[key] !== expected) {
      next[key] = expected;
      changedPaths.push(`$.${key}`);
    }
  }
  return { changedPaths, value: next };
};

const jsonPathTokens = (jsonPath: string): Array<string | number | "-"> | null => {
  if (jsonPath === "$") return [];
  if (!jsonPath.startsWith("$")) return null;
  const tokens: Array<string | number | "-"> = [];
  let index = 1;
  while (index < jsonPath.length) {
    if (jsonPath[index] === ".") {
      index += 1;
      const match = /^[A-Za-z0-9_-]+/.exec(jsonPath.slice(index));
      if (!match) return null;
      tokens.push(match[0]);
      index += match[0].length;
      continue;
    }
    if (jsonPath[index] === "[") {
      const close = jsonPath.indexOf("]", index + 1);
      if (close === -1) return null;
      const raw = jsonPath.slice(index + 1, close);
      if (raw === "-") tokens.push("-");
      else if (/^\d+$/.test(raw)) tokens.push(Number(raw));
      else return null;
      index = close + 1;
      continue;
    }
    return null;
  }
  return tokens;
};

const readJsonPath = (root: unknown, jsonPath: string): { found: boolean; value: unknown } => {
  const tokens = jsonPathTokens(jsonPath);
  if (!tokens) return { found: false, value: undefined };
  let current: unknown = root;
  for (const token of tokens) {
    if (typeof token === "number") {
      if (!Array.isArray(current) || token < 0 || token >= current.length) {
        return { found: false, value: undefined };
      }
      current = current[token];
      continue;
    }
    if (token === "-") return { found: false, value: undefined };
    if (!isJsonObject(current) || !(token in current)) return { found: false, value: undefined };
    current = current[token];
  }
  return { found: true, value: current };
};

const mutateJsonPath = (
  root: Record<string, unknown>,
  operation: JsonPatchOperation
): { applied: boolean; changedPath: string | null } => {
  const tokens = jsonPathTokens(operation.path);
  if (!tokens || tokens.length === 0) return { applied: false, changedPath: null };
  let parent: unknown = root;
  for (const token of tokens.slice(0, -1)) {
    if (typeof token === "number") {
      if (!Array.isArray(parent) || token < 0 || token >= parent.length) return { applied: false, changedPath: null };
      parent = parent[token];
    } else if (token === "-") {
      return { applied: false, changedPath: null };
    } else {
      if (!isJsonObject(parent) || !(token in parent)) return { applied: false, changedPath: null };
      parent = parent[token];
    }
  }

  const last = tokens.at(-1)!;
  let value = operation.value;
  if (operation.op === "move") {
    if (!operation.from) return { applied: false, changedPath: null };
    const source = readJsonPath(root, operation.from);
    if (!source.found) return { applied: false, changedPath: null };
    value = source.value;
  }

  const applyValue = (): boolean => {
    if (typeof last === "number") {
      if (!Array.isArray(parent)) return false;
      if (operation.op === "add") {
        if (last > parent.length) return false;
        parent.splice(last, 0, value);
        return true;
      }
      if (last < 0 || last >= parent.length) return false;
      if (operation.op === "remove") parent.splice(last, 1);
      else parent[last] = value;
      return true;
    }
    if (last === "-") {
      if (!Array.isArray(parent) || operation.op !== "add") return false;
      parent.push(value);
      return true;
    }
    if (!isJsonObject(parent)) return false;
    if (operation.op === "remove") {
      if (!(last in parent)) return false;
      delete parent[last];
      return true;
    }
    parent[last] = value;
    return true;
  };

  if (!applyValue()) return { applied: false, changedPath: null };

  if (operation.op === "move" && operation.from && operation.from !== operation.path) {
    const fromTokens = jsonPathTokens(operation.from);
    if (fromTokens && fromTokens.length > 0) {
      let fromParent: unknown = root;
      for (const token of fromTokens.slice(0, -1)) {
        if (typeof token === "number") {
          if (!Array.isArray(fromParent) || token >= fromParent.length) return { applied: true, changedPath: operation.path };
          fromParent = fromParent[token];
        } else if (token === "-") {
          return { applied: true, changedPath: operation.path };
        } else {
          if (!isJsonObject(fromParent) || !(token in fromParent)) return { applied: true, changedPath: operation.path };
          fromParent = fromParent[token];
        }
      }
      const fromLast = fromTokens.at(-1)!;
      if (typeof fromLast === "number" && Array.isArray(fromParent) && fromLast < fromParent.length) {
        fromParent.splice(fromLast, 1);
      } else if (typeof fromLast === "string" && fromLast !== "-" && isJsonObject(fromParent)) {
        delete fromParent[fromLast];
      }
    }
  }

  return { applied: true, changedPath: operation.path };
};

const errorJsonPath = (error: string): string | null => {
  const match = /^(\$(?:\.[A-Za-z0-9_-]+|\[\d+\])*)\s*:/.exec(error.trim());
  return match?.[1] ?? null;
};

const findRecordIndexById = (
  working: Record<string, unknown>,
  collection: string,
  id: string
): number | null => {
  const result = isJsonObject(working.result) ? working.result : null;
  const items = result && Array.isArray(result[collection]) ? result[collection] : [];
  const index = items.findIndex((item) => isJsonObject(item) && item.id === id);
  return index >= 0 ? index : null;
};

const localErrorPath = (error: string, working: Record<string, unknown>): string | null => {
  const checkId = /\b(?:OV|AR|DB|DI|BE)-\d{3}\b/.exec(error)?.[0];
  if (checkId) {
    const result = isJsonObject(working.result) ? working.result : null;
    const checklist = result && Array.isArray(result.checklist) ? result.checklist : [];
    const index = checklist.findIndex((item) => isJsonObject(item) && item.check_id === checkId);
    if (index >= 0) return `$.result.checklist[${index}]`;
    return "$.result.checklist";
  }

  for (const [pattern, collection] of [
    [/\b(?:D05|AR|DB|DI|BE)-F\d{2,3}\b/, "findings"],
    [/\b(?:D05|AR|DB|DI|BE)-S\d{2,3}\b/, "strengths"],
    [/\b(?:D05|AR|DB|DI|BE)-U\d{2,3}\b/, "unknowns"],
    [/\b(?:D05|AR|DB|DI|BE)-C\d{2,3}\b/, "contradictions"]
  ] as const) {
    const id = pattern.exec(error)?.[0];
    if (!id) continue;
    const index = findRecordIndexById(working, collection, id);
    return index === null ? `$.result.${collection}` : `$.result.${collection}[${index}]`;
  }

  if (/audit_id/i.test(error)) return "$.audit_id";
  if (/workspace_hash/i.test(error)) return "$.workspace_hash";
  if (/schema_version/i.test(error)) return "$.schema_version";
  if (/completed_at/i.test(error)) return "$.completed_at";
  if (/substage/i.test(error)) return "$.substage";
  if (/checklist/i.test(error)) return "$.result.checklist";
  if (/finding/i.test(error)) return "$.result.findings";
  if (/strength/i.test(error)) return "$.result.strengths";
  if (/unknown/i.test(error)) return "$.result.unknowns";
  if (/contradiction/i.test(error)) return "$.result.contradictions";
  if (/evidence/i.test(error)) return "$.result";
  return "$.result";
};

const allowedRepairPaths = (
  errors: string[],
  working: Record<string, unknown>
): string[] =>
  [...new Set(errors.map((error) => errorJsonPath(error) ?? localErrorPath(error, working)).filter((value): value is string => Boolean(value)))];

const pathIsAllowed = (candidate: string, allowed: string[]): boolean =>
  allowed.some(
    (base) =>
      candidate === base ||
      candidate.startsWith(`${base}.`) ||
      candidate.startsWith(`${base}[`)
  );

const jsonContainsSnapshot = (candidate: unknown, original: unknown): boolean => {
  if (Array.isArray(original)) {
    if (!Array.isArray(candidate) || candidate.length < original.length) return false;
    return original.every((item, index) => jsonContainsSnapshot(candidate[index], item));
  }
  if (isJsonObject(original)) {
    if (!isJsonObject(candidate)) return false;
    return Object.entries(original).every(
      ([key, value]) => key in candidate && jsonContainsSnapshot(candidate[key], value)
    );
  }
  return jsonValuesEqual(candidate, original);
};

const patchPreservesExistingContainer = (
  working: Record<string, unknown>,
  patch: JsonPatchOperation
): boolean => {
  const current = readJsonPath(working, patch.path);
  if (!current.found) return true;
  if (!Array.isArray(current.value) && !isJsonObject(current.value)) return true;
  if (patch.op === "remove") return false;
  if (patch.op === "move") return false;
  return jsonContainsSnapshot(patch.value, current.value);
};

const applyRepairPatches = (
  working: Record<string, unknown>,
  response: RepairPatchResponse,
  allowedPaths: string[],
  authority: RepairAuthority
): { changedPaths: string[]; value: Record<string, unknown> } => {
  const next = deepCloneJsonObject(working);
  const changedPaths: string[] = [];
  const protectedPaths = new Set(
    Object.keys(authority).map((key) => `$.${key}`)
  );

  for (const patch of response.patches.slice(0, 24)) {
    if (!pathIsAllowed(patch.path, allowedPaths)) continue;
    if (protectedPaths.has(patch.path) && !allowedPaths.includes(patch.path)) continue;
    if (patch.op === "move") {
      if (!patch.from || !pathIsAllowed(patch.from, allowedPaths)) continue;
      if (protectedPaths.has(patch.from)) continue;
    }
    if (!patchPreservesExistingContainer(next, patch)) continue;
    const result = mutateJsonPath(next, patch);
    if (result.applied && result.changedPath) changedPaths.push(result.changedPath);
  }

  const authoritative = enforceAuthority(next, authority);
  return {
    changedPaths: [...new Set([...changedPaths, ...authoritative.changedPaths])],
    value: authoritative.value
  };
};

const parseRepairPatchResponse = (value: Record<string, unknown> | null): RepairPatchResponse | null => {
  if (!value || !Array.isArray(value.patches)) return null;
  const patches: JsonPatchOperation[] = [];
  for (const raw of value.patches) {
    if (!isJsonObject(raw)) return null;
    if (!["add", "replace", "remove", "move"].includes(String(raw.op)) || typeof raw.path !== "string") {
      return null;
    }
    patches.push({
      op: raw.op as JsonPatchOperation["op"],
      path: raw.path,
      ...(typeof raw.from === "string" ? { from: raw.from } : {}),
      ...(Object.prototype.hasOwnProperty.call(raw, "value") ? { value: raw.value } : {})
    });
  }
  return { patches };
};

const createRepairPrompt = (
  working: Record<string, unknown>,
  schema: Record<string, unknown>,
  errors: string[],
  allowedPaths: string[]
): string =>
  [
    "ForgePilot JSON PATCH REPAIR.",
    "This is NOT a new audit. Repository access is forbidden and no repository tools are available.",
    "Do not regenerate or summarize the audit. Preserve every value outside the allowed target paths exactly.",
    "Return ONLY one JSON object with shape: {\\\"patches\\\":[{\\\"op\\\":\\\"add|replace|remove|move\\\",\\\"path\\\":\\\"$.path\\\",\\\"from\\\":\\\"$.optional.source\\\",\\\"value\\\":...}]}.",
    "Use the minimum number of patches. If a value already exists at the wrong location, use move instead of recreating it.",
    "Never change audit_id, workspace_hash, substage, or schema_version unless that exact path is explicitly listed in allowed_target_paths.",
    "If the supplied information cannot safely fix the error, return {\\\"patches\\\":[]}.",
    `allowed_target_paths=${JSON.stringify(allowedPaths)}`,
    `validation_errors=${JSON.stringify(errors)}`,
    `current_json=${JSON.stringify(working)}`,
    `target_schema=${JSON.stringify(schema)}`
  ].join("\\n");

/**
 * Providers occasionally wrap the requested semantic object even when the
 * prompt asks for raw JSON (for example `{ proposal: {...} }`).  Contract
 * validation must target the semantic payload, not the provider/container
 * envelope.  Prefer an exact top-level match, then inspect only well-known
 * wrapper fields.  Never manufacture missing contract fields.
 */
const selectContractOutput = (
  value: Record<string, unknown> | null,
  schema: Record<string, unknown> | null
): Record<string, unknown> | null => {
  if (!value || !schema) {
    return value;
  }

  if (validateOutputContract(value, schema).length === 0) {
    return value;
  }

  const wrapperKeys = [
    "proposal",
    "scope_proposal",
    "scope",
    "output",
    "data",
    "result",
    "structured_output"
  ] as const;

  for (const key of wrapperKeys) {
    const nested = value[key];
    if (isJsonObject(nested) && validateOutputContract(nested, schema).length === 0) {
      return nested;
    }
    if (typeof nested === "string") {
      const parsed = parseProviderText(nested);
      if (parsed && validateOutputContract(parsed, schema).length === 0) {
        return parsed;
      }
    }
  }

  return value;
};

type ParsedProviderJsonSelection = {
  source: "claude-result" | "claude-assistant" | "plain-output" | null;
  value: Record<string, unknown> | null;
};

const requiredStringKeys = (schema: Record<string, unknown> | null): string[] =>
  schema && Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === "string")
    : [];

const candidateFitness = (
  value: Record<string, unknown>,
  schema: Record<string, unknown> | null
): [number, number, number, number, number] => {
  if (!schema) {
    let size = 0;
    try { size = JSON.stringify(value).length; } catch { size = 0; }
    return [0, 0, 0, 0, size];
  }

  const rootRequired = requiredStringKeys(schema);
  const rootPresent = rootRequired.filter((key) => key in value).length;
  const rootProperties = isJsonObject(schema.properties) ? schema.properties : null;
  const resultSchema = rootProperties && isJsonObject(rootProperties.result)
    ? rootProperties.result as Record<string, unknown>
    : null;
  const resultObject = isJsonObject(value.result) ? value.result : null;
  const resultRequired = requiredStringKeys(resultSchema);
  const resultPresent = resultObject
    ? resultRequired.filter((key) => key in resultObject).length
    : 0;
  const errors = validateOutputContract(value, schema).length;
  let size = 0;
  try { size = JSON.stringify(value).length; } catch { size = 0; }
  return [rootPresent, resultObject ? 1 : 0, resultPresent, -errors, size];
};

const fitnessIsBetter = (
  next: [number, number, number, number, number],
  current: [number, number, number, number, number] | null
): boolean => {
  if (!current) return true;
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] !== current[index]) return next[index]! > current[index]!;
  }
  return false;
};

export const isRepairBaseViable = (
  value: Record<string, unknown> | null,
  schema: Record<string, unknown> | null
): boolean => {
  if (!value || !schema) return false;
  const rootRequired = requiredStringKeys(schema);
  if (rootRequired.includes("result") && !isJsonObject(value.result)) return false;

  const rootProperties = isJsonObject(schema.properties) ? schema.properties : null;
  const resultSchema = rootProperties && isJsonObject(rootProperties.result)
    ? rootProperties.result as Record<string, unknown>
    : null;
  if (resultSchema && isJsonObject(value.result)) {
    const required = requiredStringKeys(resultSchema);
    if (required.length >= 4) {
      const present = required.filter((key) => key in (value.result as Record<string, unknown>)).length;
      if (present < 2) return false;
    }
  }
  return true;
};

const parseProviderJsonSelection = (
  chunks: ProviderOutputChunk[],
  providerId?: string,
  schema: Record<string, unknown> | null = null
): ParsedProviderJsonSelection => {
  const textCandidates =
    providerId === PROVIDER_IDS.claudeCode
      ? findProviderStreamTextCandidates(chunks)
      : [
          {
            source: "plain-output" as const,
            text: chunks.map((chunk) => chunk.text).join("")
          }
        ];

  let fallback: ParsedProviderJsonSelection = { source: null, value: null };
  let fallbackFitness: [number, number, number, number, number] | null = null;

  for (const candidate of textCandidates) {
    const parsedObjects = parseProviderTextObjects(candidate.text);
    for (const parsed of parsedObjects) {
      if (schema) {
        const semanticCandidate = selectContractOutput(parsed, schema);
        if (semanticCandidate && validateOutputContract(semanticCandidate, schema).length === 0) {
          return { source: candidate.source, value: parsed };
        }
      }

      const fitness = candidateFitness(parsed, schema);
      if (fitnessIsBetter(fitness, fallbackFitness)) {
        fallback = { source: candidate.source, value: parsed };
        fallbackFitness = fitness;
      }
    }
  }

  return fallback;
};

export const parseLastJsonObject = (
  chunks: ProviderOutputChunk[],
  providerId?: string,
  schema: Record<string, unknown> | null = null
): Record<string, unknown> | null =>
  parseProviderJsonSelection(chunks, providerId, schema).value;

const describeJsonShape = (value: Record<string, unknown> | null): string => {
  if (!value) {
    return "no JSON object";
  }
  const keys = Object.keys(value).slice(0, 12);
  return keys.length > 0 ? `top-level keys: ${keys.join(", ")}` : "empty JSON object";
};

const providerFailureDetail = (chunks: ProviderOutputChunk[]): string | null => {
  const stderr = chunks
    .filter((chunk) => chunk.stream === "stderr")
    .map((chunk) => stripAnsi(chunk.text))
    .join("\n")
    .trim();
  if (!stderr) {
    return null;
  }
  const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(-3).join(" | ").slice(0, 700) || null;
};

const providerFailureText = (chunks: ProviderOutputChunk[]): string =>
  stripAnsi(chunks.map((chunk) => chunk.text).join("\n")).toLowerCase();

export const isRetryableProviderFailure = (
  result: Pick<TaskResult, "status" | "exitCode">,
  chunks: ProviderOutputChunk[]
): boolean => {
  if (result.status === "timeout") return true;
  if (result.status !== "failed") return false;

  const text = providerFailureText(chunks);
  return RETRYABLE_PROVIDER_FAILURE_PATTERNS.some((pattern) => text.includes(pattern));
};

const formatRetryDelay = (delayMs: number): string => {
  if (delayMs % 60_000 === 0) {
    const minutes = delayMs / 60_000;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const seconds = Math.max(1, Math.round(delayMs / 1000));
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
};

export const createStageExecutionService = (
  options: StageExecutionServiceOptions = {}
): StageExecutionService => {
  const createClient = options.createClient ?? ((serverUrl: string) => createHttpClient(serverUrl));
  const localOperations = options.localOperationRegistry ?? createLocalOperationRegistry();
  const taskExecutionService = options.taskExecutionService ?? createTaskExecutionService();
  const createJournal = options.createJournal ?? createStageExecutionJournal;
  const createRepairStore = options.createRepairStore ?? createStageRepairStore;
  const providerRetryDelaysMs = options.providerRetryDelaysMs ?? PROVIDER_FAST_RETRY_DELAYS_MS;
  const providerWatchIntervalMs = options.providerWatchIntervalMs ?? PROVIDER_WATCH_RETRY_INTERVAL_MS;

  type ProviderRetryWakeReason = "timer" | "manual";
  type ProviderRetryWaiter = {
    finish: (reason: ProviderRetryWakeReason) => void;
    timer: NodeJS.Timeout;
  };
  const providerRetryWaiters = new Map<string, ProviderRetryWaiter>();
  const providerRetryKey = (projectId: string, stageId: string): string => `${projectId}:${stageId}`;

  const waitForProviderRetry = async (
    projectId: string,
    stageId: string,
    delayMs: number
  ): Promise<ProviderRetryWakeReason> =>
    new Promise<ProviderRetryWakeReason>((resolve) => {
      const key = providerRetryKey(projectId, stageId);
      let settled = false;
      const finish = (reason: ProviderRetryWakeReason): void => {
        if (settled) return;
        settled = true;
        const waiter = providerRetryWaiters.get(key);
        if (waiter) clearTimeout(waiter.timer);
        providerRetryWaiters.delete(key);
        resolve(reason);
      };
      const timer = setTimeout(() => finish("timer"), Math.max(0, delayMs));
      providerRetryWaiters.set(key, { finish, timer });
    });

  const retryProviderNow = (
    projectId: string,
    stageId: string
  ): { accepted: boolean; message: string } => {
    const waiter = providerRetryWaiters.get(providerRetryKey(projectId, stageId));
    if (!waiter) {
      return {
        accepted: false,
        message: "Provider is not currently waiting between retry attempts."
      };
    }
    waiter.finish("manual");
    return {
      accepted: true,
      message: "Provider retry requested now."
    };
  };

  const runRepairProviderTask = async (
    request: JobRunRequest & { stageId: string },
    working: Record<string, unknown>,
    schema: Record<string, unknown>,
    errors: string[],
    attemptLabel: string,
    onDebug?: DebugListener
  ): Promise<RepairPatchResponse | null> => {
    const allowedPaths = allowedRepairPaths(errors, working);
    if (allowedPaths.length === 0) return null;

    const observedOutput: Array<{ taskId: string; chunk: ProviderOutputChunk }> = [];
    const observedExits = new Map<string, { exitCode: number | null; finishedAt: string; signal: string | null }>();
    let resolveExit: ((exit: { exitCode: number | null; finishedAt: string; signal: string | null }) => void) | null = null;
    let expectedTaskId: string | null = null;
    const removeOutput = taskExecutionService.onOutput((event) => {
      observedOutput.push({ taskId: event.taskId, chunk: event.chunk });
    });
    const removeExit = taskExecutionService.onExit((event) => {
      observedExits.set(event.taskId, event.exitInfo);
      if (event.taskId === expectedTaskId && resolveExit) {
        resolveExit(event.exitInfo);
        resolveExit = null;
      }
    });

    try {
      const started = await taskExecutionService.start({
        instructions: {
          body: createRepairPrompt(working, schema, errors, allowedPaths),
          format: "plain-text",
          metadata: {
            repairAttempt: attemptLabel,
            toolPolicy: "no-repository-tools"
          }
        },
        mode: "provider",
        model: request.model,
        outputJsonSchema: REPAIR_PATCH_SCHEMA,
        projectRootPath: request.project.rootPath,
        providerId: request.providerId,
        timeoutMs: Math.min(request.timeoutMs, 120_000)
      });
      expectedTaskId = started.handle.id;
      emitDebug(request, onDebug, {
        kind: "provider-start",
        taskId: started.handle.id,
        processId: started.handle.processId,
        message: `JSON patch repair provider started (${attemptLabel}); repository tools disabled.`,
        text: [started.command, ...started.args.map((arg) => JSON.stringify(arg))].join(" "),
        exitCode: null,
        signal: null,
        timestamp: started.startedAt
      });

      const alreadyExited = observedExits.get(started.handle.id);
      const exitInfo =
        alreadyExited ??
        (await new Promise<{ exitCode: number | null; finishedAt: string; signal: string | null }>((resolve) => {
          resolveExit = resolve;
        }));
      const chunks = observedOutput
        .filter((entry) => entry.taskId === started.handle.id)
        .map((entry) => entry.chunk);

      emitDebug(request, onDebug, {
        kind: "provider-exit",
        taskId: started.handle.id,
        processId: started.handle.processId,
        message: `JSON patch repair provider exited (${attemptLabel}).`,
        text: null,
        exitCode: exitInfo.exitCode,
        signal: exitInfo.signal,
        timestamp: exitInfo.finishedAt
      });

      if (exitInfo.exitCode !== 0 || exitInfo.signal) return null;
      const parsed = parseLastJsonObject(chunks, request.providerId, REPAIR_PATCH_SCHEMA);
      const repair = parseRepairPatchResponse(parsed);
      emitDebug(request, onDebug, {
        kind: "parser",
        taskId: started.handle.id,
        processId: started.handle.processId,
        message: repair
          ? `JSON patch repair parsed (${repair.patches.length} patch operations).`
          : "JSON patch repair did not return a valid patch payload.",
        text: repair ? JSON.stringify(repair) : null,
        exitCode: null,
        signal: null,
        timestamp: new Date().toISOString()
      });
      return repair;
    } finally {
      removeOutput();
      removeExit();
    }
  };

  const executeProvider = async (
    request: JobRunRequest & { stageId: string },
    directive: ProviderExecutionDirective,
    client: HttpClient,
    authority: RepairAuthority,
    onProgress?: ProgressListener,
    onDebug?: DebugListener
  ): Promise<ProviderExecutionResult> => {
    const job = directive.job;
    const task = await client.get(`/jobs/${encodeURIComponent(job.id)}`, getTaskResponseSchema);
    const observedOutput: Array<{ taskId: string; chunk: ProviderOutputChunk; debugged: boolean }> = [];
    const observedExits = new Map<
      string,
      { exitCode: number | null; finishedAt: string; signal: string | null }
    >();
    let resolveExpectedExit:
      | ((exit: { exitCode: number | null; finishedAt: string; signal: string | null }) => void)
      | null = null;
    let expectedTaskId: string | null = null;
    const streamLineBuffers = new Map<string, string>();
    const publishStreamEventDebug = (taskId: string, line: string, timestamp: string): boolean => {
      const event = parseJsonObjectText(line.trim());
      if (!event || typeof event.type !== "string") {
        return false;
      }
      const summary = describeProviderStreamEvent(event);
      emitDebug(request, onDebug, {
        kind: event.type === "result" ? "provider-result" : "provider-event",
        taskId,
        processId: null,
        message: summary.message,
        text: summary.text,
        exitCode: null,
        signal: null,
        timestamp
      });
      return true;
    };
    const publishOutputDebug = (taskId: string, chunk: ProviderOutputChunk): void => {
      if (chunk.stream === "stderr" || request.providerId !== PROVIDER_IDS.claudeCode) {
        emitDebug(request, onDebug, {
          kind: chunk.stream,
          taskId,
          processId: null,
          message: chunk.stream === "stderr" ? "Provider STDERR" : "Provider STDOUT",
          text: chunk.text,
          exitCode: null,
          signal: null,
          timestamp: chunk.timestamp
        });
      }

      if (chunk.stream !== "stdout" || request.providerId !== PROVIDER_IDS.claudeCode) {
        return;
      }

      // Claude stream-json can contain internal thinking blocks. Never expose raw
      // JSONL in the admin UI; emit only sanitized visible text/tool metadata.
      const combined = `${streamLineBuffers.get(taskId) ?? ""}${stripAnsi(chunk.text)}`;
      const lines = combined.split(/\r?\n/);
      streamLineBuffers.set(taskId, lines.pop() ?? "");
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        const parsed = publishStreamEventDebug(taskId, line, chunk.timestamp);
        if (!parsed) {
          emitDebug(request, onDebug, {
            kind: "stdout",
            taskId,
            processId: null,
            message: "Provider STDOUT (non-JSON stream line)",
            text: line,
            exitCode: null,
            signal: null,
            timestamp: chunk.timestamp
          });
        }
      }
    };
    const removeOutput = taskExecutionService.onOutput((event) => {
      const entry = { taskId: event.taskId, chunk: event.chunk, debugged: false };
      observedOutput.push(entry);
      if (event.taskId === expectedTaskId) {
        entry.debugged = true;
        publishOutputDebug(event.taskId, event.chunk);
      }
    });
    const removeExit = taskExecutionService.onExit((event) => {
      observedExits.set(event.taskId, event.exitInfo);
      if (event.taskId === expectedTaskId && resolveExpectedExit) {
        resolveExpectedExit(event.exitInfo);
        resolveExpectedExit = null;
      }
    });
    let heartbeat: NodeJS.Timeout | undefined;

    emit(request, onProgress, {
      message: directive.messageStarted,
      progress: directive.progressStarted,
      status: "started",
      stepId: directive.id
    });

    try {
      let started!: TaskStartResponse;
      let exitInfo!: { exitCode: number | null; finishedAt: string; signal: string | null };
      let outputChunks: ProviderOutputChunk[] = [];
      let result!: TaskResult;
      let fastRetryCount = 0;
      let watchRetryCount = 0;

      while (true) {
        started = await taskExecutionService.start({
          instructions: task.instructions,
          mode: "provider",
          model: request.model,
          outputJsonSchema: directive.outputSchema,
          projectRootPath: request.project.rootPath,
          providerId: request.providerId,
          timeoutMs: Math.min(request.timeoutMs, task.timeoutMs)
        });

        if (!heartbeat) {
          heartbeat = setInterval(() => {
            void client
              .post(
                `/jobs/${encodeURIComponent(job.id)}/heartbeat`,
                { jobId: job.id, timestamp: new Date().toISOString() },
                syncFindingsResponseSchema
              )
              .catch(() => undefined);
          }, HEARTBEAT_INTERVAL_MS);
        }

        expectedTaskId = started.handle.id;
        const commandPreview = [started.command, ...started.args.map((arg) => JSON.stringify(arg))].join(" ");
        emitDebug(request, onDebug, {
          kind: "provider-start",
          taskId: started.handle.id,
          processId: started.handle.processId,
          message:
            fastRetryCount > 0 || watchRetryCount > 0
              ? `Provider retry process started (fast=${fastRetryCount}/${providerRetryDelaysMs.length}, watch=${watchRetryCount}).`
              : "Provider process started.",
          text: commandPreview,
          exitCode: null,
          signal: null,
          timestamp: started.startedAt
        });
        for (const entry of observedOutput) {
          if (entry.taskId === started.handle.id && !entry.debugged) {
            entry.debugged = true;
            publishOutputDebug(entry.taskId, entry.chunk);
          }
        }
        const alreadyExited = observedExits.get(started.handle.id);
        exitInfo =
          alreadyExited ??
          (await new Promise<{ exitCode: number | null; finishedAt: string; signal: string | null }>(
            (resolve) => {
              resolveExpectedExit = resolve;
            }
          ));
        const trailingStreamLine = streamLineBuffers.get(started.handle.id)?.trim();
        if (trailingStreamLine) {
          const parsed = publishStreamEventDebug(started.handle.id, trailingStreamLine, exitInfo.finishedAt);
          if (!parsed && request.providerId === PROVIDER_IDS.claudeCode) {
            emitDebug(request, onDebug, {
              kind: "stdout",
              taskId: started.handle.id,
              processId: started.handle.processId,
              message: "Provider STDOUT (non-JSON trailing line)",
              text: trailingStreamLine,
              exitCode: null,
              signal: null,
              timestamp: exitInfo.finishedAt
            });
          }
        }
        streamLineBuffers.delete(started.handle.id);
        emitDebug(request, onDebug, {
          kind: "provider-exit",
          taskId: started.handle.id,
          processId: started.handle.processId,
          message: "Provider process exited.",
          text: null,
          exitCode: exitInfo.exitCode,
          signal: exitInfo.signal,
          timestamp: exitInfo.finishedAt
        });
        outputChunks = observedOutput
          .filter((entry) => entry.taskId === started.handle.id)
          .map((entry) => entry.chunk);
        result = {
          exitCode: exitInfo.exitCode,
          findings: [],
          finishedAt: exitInfo.finishedAt,
          jobId: job.id,
          outputChunks,
          providerId: request.providerId,
          startedAt: started.startedAt,
          status:
            exitInfo.signal === "timeout"
              ? "timeout"
              : exitInfo.exitCode === 0
                ? "completed"
                : "failed",
          taskId: started.handle.id
        };

        if (result.status === "completed" || !isRetryableProviderFailure(result, outputChunks)) {
          break;
        }

        const isFastRetry = fastRetryCount < providerRetryDelaysMs.length;
        const retryNumber = isFastRetry ? fastRetryCount + 1 : watchRetryCount + 1;
        const retryDelayMs = isFastRetry
          ? providerRetryDelaysMs[fastRetryCount]!
          : providerWatchIntervalMs;
        if (isFastRetry) {
          fastRetryCount += 1;
        } else {
          watchRetryCount += 1;
        }
        const failureDetail = providerFailureDetail(outputChunks);
        const waitMessage = isFastRetry
          ? `Provider connection/API failure detected${failureDetail ? `: ${failureDetail}` : "."} Retry ${retryNumber}/${providerRetryDelaysMs.length} in ${formatRetryDelay(retryDelayMs)}. The stage stays running; Retry provider now can run it immediately.`
          : `Provider is still unavailable after ${providerRetryDelaysMs.length} fast retries. The stage stays running and will retry every ${formatRetryDelay(providerWatchIntervalMs)} until the provider returns. Next background retry in ${formatRetryDelay(retryDelayMs)}; Retry provider now is available.`;
        emitDebug(request, onDebug, {
          kind: "parser",
          taskId: started.handle.id,
          processId: started.handle.processId,
          message: waitMessage,
          text: null,
          exitCode: result.exitCode,
          signal: exitInfo.signal,
          timestamp: new Date().toISOString()
        });
        const retryWake = waitForProviderRetry(
          request.project.id,
          request.stageId,
          retryDelayMs
        );
        emit(request, onProgress, {
          message: waitMessage,
          progress: Math.max(directive.progressStarted, directive.progressCompleted - 3),
          status: "started",
          stepId: `provider-retry-wait:${directive.id}`
        });

        const wakeReason = await retryWake;
        emit(request, onProgress, {
          message:
            wakeReason === "manual"
              ? `Retry provider now requested. Starting provider ${isFastRetry ? `retry ${retryNumber}/${providerRetryDelaysMs.length}` : `background retry ${retryNumber}`} immediately.`
              : `Provider ${isFastRetry ? `retry ${retryNumber}/${providerRetryDelaysMs.length}` : `background retry ${retryNumber}`} starting now.`,
          progress: Math.max(directive.progressStarted, directive.progressCompleted - 3),
          status: "started",
          stepId: `provider-retry-attempt:${directive.id}`
        });
      }

      if (result.status === "completed" && (fastRetryCount > 0 || watchRetryCount > 0)) {
        emit(request, onProgress, {
          message: `Provider connection recovered. Continuing ${request.stageId} without marking the stage failed.`,
          progress: Math.max(directive.progressStarted, directive.progressCompleted - 2),
          status: "completed",
          stepId: `provider-retry-recovered:${directive.id}`
        });
      }
      const submit = await client.post(
        `/jobs/${encodeURIComponent(job.id)}/result`,
        result,
        submitResultResponseSchema
      );
      const sync = await client.post(
        "/findings/sync",
        { findings: submit.findings, runId: job.runId },
        syncFindingsResponseSchema
      );

      if (result.status !== "completed") {
        const timeoutSeconds = Math.round(Math.min(request.timeoutMs, task.timeoutMs) / 1000);
        const failureDetail = providerFailureDetail(outputChunks);
        const failureMessage =
          result.status === "timeout"
            ? `Provider timed out after ${timeoutSeconds} seconds before emitting a final result.`
            : `Provider process failed${failureDetail ? `: ${failureDetail}` : "."}`;

        emitDebug(request, onDebug, {
          kind: "parser",
          taskId: started.handle.id,
          processId: started.handle.processId,
          message:
            result.status === "timeout"
              ? "Provider timed out; final-result parsing and output-contract validation were skipped."
              : "Provider did not complete successfully; final-result parsing and output-contract validation were skipped.",
          text: null,
          exitCode: result.exitCode,
          signal: exitInfo.signal,
          timestamp: new Date().toISOString()
        });

        emit(request, onProgress, {
          message: failureMessage,
          progress: directive.progressCompleted,
          status: "failed",
          stepId: directive.id
        });

        return {
          autoRepairAttempts: 0,
          changedPaths: [],
          job,
          originalOutput: null,
          outputContractErrors: [],
          parsedOutput: null,
          providerOutputText: outputChunks.map((chunk) => chunk.text).join(""),
          repairBaseViable: false,
          repairPending: false,
          result,
          submitAccepted: submit.accepted,
          syncedFindings: sync.accepted ? submit.findings : []
        };
      }

      const rawOutputText = outputChunks.map((chunk) => chunk.text).join("");
      emitDebug(request, onDebug, {
        kind: "parser",
        taskId: started.handle.id,
        processId: started.handle.processId,
        message: `Parsing provider output (${outputChunks.length} chunks, ${rawOutputText.length} chars).`,
        text: null,
        exitCode: null,
        signal: null,
        timestamp: new Date().toISOString()
      });
      const parsedSelection = parseProviderJsonSelection(
        outputChunks,
        request.providerId,
        directive.mode === "semantic" ? directive.outputSchema : null
      );
      const originalOutput = parsedSelection.value;
      let rawParsedOutput = originalOutput;
      const changedPaths: string[] = [];
      let autoRepairAttempts = 0;

      if (directive.mode === "semantic" && rawParsedOutput) {
        const structuralRepair = repairProviderOutputStructure(
          rawParsedOutput,
          directive.outputSchema
        );
        rawParsedOutput = structuralRepair.value;
        for (const key of structuralRepair.movedResultKeys) {
          changedPaths.push(`$.result.${key}`);
        }

        if (structuralRepair.movedResultKeys.length > 0) {
          const message =
            `Provider output structural auto-repair applied: moved ${structuralRepair.movedResultKeys.join(", ")} into $.result.`;
          emitDebug(request, onDebug, {
            kind: "contract",
            taskId: started.handle.id,
            processId: started.handle.processId,
            message,
            text: null,
            exitCode: null,
            signal: null,
            timestamp: new Date().toISOString()
          });
          emit(request, onProgress, {
            message,
            progress: Math.max(directive.progressStarted, directive.progressCompleted - 2),
            status: "completed",
            stepId: `repair-structural:${directive.id}`
          });
        }

        if (rawParsedOutput) {
          const authoritative = enforceAuthority(rawParsedOutput, authorityFromSchema(directive.outputSchema, authority));
          rawParsedOutput = authoritative.value;
          changedPaths.push(...authoritative.changedPaths);
        }
      }

      let parsedOutput =
        directive.mode === "semantic"
          ? selectContractOutput(rawParsedOutput, directive.outputSchema)
          : rawParsedOutput;
      emitDebug(request, onDebug, {
        kind: "parser",
        taskId: started.handle.id,
        processId: started.handle.processId,
        message: rawParsedOutput
          ? `JSON object extracted from ${parsedSelection.source ?? "provider output"} (${describeJsonShape(rawParsedOutput)}).`
          : "Parser could not extract a valid JSON object.",
        text: null,
        exitCode: null,
        signal: null,
        timestamp: new Date().toISOString()
      });

      let outputContractErrors =
        directive.mode === "semantic"
          ? validateOutputContract(parsedOutput, directive.outputSchema)
          : [];

      const repairBaseViable =
        directive.mode === "semantic" &&
        parsedOutput !== null &&
        directive.outputSchema !== null &&
        isRepairBaseViable(parsedOutput, directive.outputSchema);

      if (
        directive.mode === "semantic" &&
        parsedOutput &&
        directive.outputSchema &&
        outputContractErrors.length > 0 &&
        repairBaseViable
      ) {
        let working = deepCloneJsonObject(parsedOutput);
        const repairAuthority = authorityFromSchema(directive.outputSchema, authority);

        for (
          let attempt = 1;
          attempt <= MAX_AUTO_REPAIR_ATTEMPTS && outputContractErrors.length > 0;
          attempt += 1
        ) {
          autoRepairAttempts = attempt;
          emit(request, onProgress, {
            message: `Automatic JSON patch repair ${attempt}/${MAX_AUTO_REPAIR_ATTEMPTS}: ${outputContractErrors[0]}`,
            progress: Math.max(directive.progressStarted, directive.progressCompleted - 1),
            status: "started",
            stepId: `repair-auto:${directive.id}:${attempt}`
          });

          const patchResponse = await runRepairProviderTask(
            request,
            working,
            directive.outputSchema,
            outputContractErrors,
            `auto ${attempt}/${MAX_AUTO_REPAIR_ATTEMPTS}`,
            onDebug
          );

          if (patchResponse) {
            const allowed = allowedRepairPaths(outputContractErrors, working);
            const applied = applyRepairPatches(working, patchResponse, allowed, repairAuthority);
            working = applied.value;
            changedPaths.push(...applied.changedPaths);
          }

          outputContractErrors = validateOutputContract(working, directive.outputSchema);
          emit(request, onProgress, {
            message:
              outputContractErrors.length === 0
                ? `Automatic JSON patch repair ${attempt}/${MAX_AUTO_REPAIR_ATTEMPTS} passed validation.`
                : `Automatic JSON patch repair ${attempt}/${MAX_AUTO_REPAIR_ATTEMPTS} finished; ${outputContractErrors.length} validation error(s) remain.`,
            progress: Math.max(directive.progressStarted, directive.progressCompleted - 1),
            status: "completed",
            stepId: `repair-auto:${directive.id}:${attempt}`
          });
        }

        parsedOutput = working;
        rawParsedOutput = working;
      }

      if (
        directive.mode === "semantic" &&
        parsedOutput &&
        directive.outputSchema &&
        outputContractErrors.length > 0 &&
        !repairBaseViable
      ) {
        const message =
          "Provider output looks like an incomplete nested fragment, not a full stage envelope. Automatic AI repair was skipped to prevent inventing/replacing audit content. Load/paste the full original provider JSON into the Repair workspace instead.";
        emitDebug(request, onDebug, {
          kind: "contract",
          taskId: started.handle.id,
          processId: started.handle.processId,
          message,
          text: null,
          exitCode: null,
          signal: null,
          timestamp: new Date().toISOString()
        });
        emit(request, onProgress, {
          message,
          progress: Math.max(directive.progressStarted, directive.progressCompleted - 1),
          status: "blocked",
          stepId: `repair-fragment:${directive.id}`
        });
      }

      if (directive.mode === "semantic") {
        emitDebug(request, onDebug, {
          kind: "contract",
          taskId: started.handle.id,
          processId: started.handle.processId,
          message:
            outputContractErrors.length === 0
              ? "Provider output contract passed."
              : `Provider output contract failed after ${autoRepairAttempts} automatic repair attempt(s): ${outputContractErrors[0]}`,
          text: null,
          exitCode: null,
          signal: null,
          timestamp: new Date().toISOString()
        });
      }

      const repairPending =
        result.status === "completed" &&
        directive.mode === "semantic" &&
        parsedOutput !== null &&
        outputContractErrors.length > 0;
      const directiveSucceeded =
        result.status === "completed" &&
        (directive.mode !== "semantic" || parsedOutput !== null) &&
        outputContractErrors.length === 0 &&
        (!directive.requireOk || parsedOutput?.ok === true);
      const failureDetail = providerFailureDetail(outputChunks);
      const failureMessage =
        result.status !== "completed"
          ? `Provider process failed${failureDetail ? `: ${failureDetail}` : "."}`
          : parsedOutput === null
            ? "Provider did not return a valid final JSON object."
            : outputContractErrors.length > 0
              ? `Provider output still has ${outputContractErrors.length} validation error(s) after automatic repair.`
              : "Provider verification returned ok != true.";

      emit(request, onProgress, {
        message: directiveSucceeded
          ? directive.messageCompleted
          : repairPending
            ? repairBaseViable
              ? `Automatic repair stopped after ${MAX_AUTO_REPAIR_ATTEMPTS} attempts. Manual Repair is available; the original provider JSON was preserved.`
              : "Automatic AI repair was skipped because the selected provider output is only an incomplete JSON fragment. The fragment was preserved; load/paste the full provider JSON in Repair workspace."
            : failureMessage,
        progress: directive.progressCompleted,
        status: directiveSucceeded ? "completed" : repairPending ? "blocked" : "failed",
        stepId: directive.id
      });

      return {
        autoRepairAttempts,
        changedPaths: [...new Set(changedPaths)],
        job,
        originalOutput,
        outputContractErrors,
        parsedOutput,
        providerOutputText: rawOutputText,
        repairBaseViable,
        repairPending,
        result,
        submitAccepted: submit.accepted,
        syncedFindings: sync.accepted ? submit.findings : []
      };
    } catch (error) {
      await client
        .post(
          `/jobs/${encodeURIComponent(job.id)}/fail`,
          {
            jobId: job.id,
            message: error instanceof Error ? error.message : "Unknown client error.",
            reason: "client-error"
          },
          syncFindingsResponseSchema
        )
        .catch(() => undefined);
      throw error;
    } finally {
      if (heartbeat) {
        clearInterval(heartbeat);
      }
      removeOutput();
      removeExit();
    }
  };

  type SemanticRepairContext = {
    authority: RepairAuthority;
    autoAttempts: number;
    changedPaths: string[];
    originalOutput: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    providerOutputText?: string;
    workingOutput: Record<string, unknown>;
  };

  const repairBlockedResponse = (
    request: JobRunRequest & { stageId: string },
    executionId: string,
    lastJob: Job | null,
    lastResult: TaskResult | null,
    submitAccepted: boolean,
    syncedFindings: TaskResult["findings"],
    message: string,
    progress: number
  ): JobRunResponse => ({
    job: lastJob,
    result: lastResult,
    stageOutcome: {
      executionId,
      message,
      progress,
      stageId: request.stageId,
      status: "blocked"
    },
    submitAccepted,
    syncedFindings
  });

  const persistRepair = async (
    store: StageRepairStore,
    request: JobRunRequest & { stageId: string },
    executionId: string,
    directiveId: string,
    pending: StageRepairRecord["pending"],
    context: SemanticRepairContext,
    validationErrors: string[],
    manualAttempts = 0
  ): Promise<void> => {
    await store.save({
      authority: context.authority,
      autoAttempts: context.autoAttempts,
      changedPaths: [...new Set(context.changedPaths)],
      directiveId,
      executionId,
      manualAttempts,
      maxAutoAttempts: MAX_AUTO_REPAIR_ATTEMPTS,
      originalOutput: context.originalOutput,
      outputSchema: context.outputSchema,
      ...(context.providerOutputText ? { providerOutputText: context.providerOutputText } : {}),
      pending,
      schemaVersion: 1,
      stageId: request.stageId,
      updatedAt: new Date().toISOString(),
      validationErrors,
      workingOutput: context.workingOutput
    });
  };

  const executeLoop = async (
    request: JobRunRequest & { stageId: string },
    initialExecutionId: string | null,
    initialPrevious: ExecutionPreviousResult | null,
    initialSemanticContext: SemanticRepairContext | null,
    allowAutoRepair: boolean,
    onProgress?: ProgressListener,
    onDebug?: DebugListener
  ): Promise<JobRunResponse> => {
    const client = createClient(request.serverUrl);
    const journal = createJournal(request.project.rootPath);
    const repairStore = createRepairStore(request.project.rootPath);
    let executionId = initialExecutionId;
    let previous = initialPrevious;
    let semanticContext = initialSemanticContext;
    let authority: RepairAuthority = initialSemanticContext?.authority ?? {};
    let lastJob: Job | null = null;
    let lastResult: TaskResult | null = null;
    let submitAccepted = false;
    let syncedFindings: TaskResult["findings"] = [];
    let resumeRetryAvailable = executionId !== null && initialPrevious === null;

    for (let attempt = 0; attempt < MAX_DIRECTIVES_PER_RUN; attempt += 1) {
      const payload: StageExecutionNextRequest = {
        capabilities: [...SUPPORTED_CAPABILITIES],
        executionId,
        localOperations: localOperations.list(),
        newRun: request.newRun,
        previous,
        project: request.project,
        providerId: request.providerId,
        outputLanguage: request.outputLanguage,
        timeoutMs: request.timeoutMs,
        stageId: request.stageId
      };

      let next: StageExecutionNextResponse;
      try {
        next = await client.post("/executions/next", payload, stageExecutionNextResponseSchema);
      } catch (error) {
        const staleExecution = error instanceof Error && error.message.includes("HTTP 404");
        if (resumeRetryAvailable && previous === null && staleExecution) {
          resumeRetryAvailable = false;
          executionId = null;
          await journal.clearStage(request.stageId);
          continue;
        }
        if (staleExecution && executionId === null) {
          throw new Error(
            "Cloud execution API is unavailable. The connected server does not expose " +
              "POST /executions/next required by protocol v2. Start the server bundled " +
              "with this ForgePilot build."
          );
        }
        throw error;
      }

      executionId = next.executionId;
      await journal.setExecutionId(request.stageId, executionId);
      const directive = next.directive;
      previous = null;

      if (directive.kind === "terminal") {
        const progressStatus =
          directive.outcome === "completed"
            ? "completed"
            : directive.outcome === "blocked"
              ? "blocked"
              : "failed";
        emit(request, onProgress, {
          message: directive.message,
          progress: directive.progress,
          status: progressStatus,
          stepId: `stage:${request.stageId}`
        });
        await journal.clearStage(request.stageId);
        if (directive.outcome === "completed") await repairStore.clear(request.stageId);

        return {
          job: lastJob,
          result: lastResult,
          stageOutcome: {
            executionId,
            message: directive.message,
            progress: directive.progress,
            stageId: request.stageId,
            status: directive.outcome
          },
          submitAccepted,
          syncedFindings
        };
      }

      if (directive.kind === "local") {
        emit(request, onProgress, {
          message: directive.messageStarted,
          progress: directive.progressStarted,
          status: "started",
          stepId: directive.id
        });

        const cached = await journal.getLocalResult(
          request.stageId,
          executionId,
          directive.id,
          directive.operation
        );

        try {
          const effectiveInputs =
            semanticContext && directive.operation.startsWith("discovery.save-")
              ? { ...directive.inputs, result: semanticContext.workingOutput }
              : directive.inputs;
          const output = cached.found
            ? cached.output
            : await localOperations.execute(
                directive.operation,
                request.project.rootPath,
                effectiveInputs
              );

          if (!cached.found) {
            await journal.saveLocalResult(
              request.stageId,
              executionId,
              directive.id,
              directive.operation,
              output
            );
          }
          authority = mergeAuthority(authority, output, semanticContext?.outputSchema ?? null);

          emit(request, onProgress, {
            message: cached.found
              ? `${directive.messageCompleted} (recovered from journal)`
              : directive.messageCompleted,
            progress: directive.progressCompleted,
            status: cached.found ? "skipped" : "completed",
            stepId: directive.id
          });
          previous = {
            directiveId: directive.id,
            message: cached.found ? "Recovered completed local operation from journal." : null,
            output,
            status: "completed"
          };
          continue;
        } catch (error) {
          let validationErrors = [error instanceof Error ? error.message : "Local operation failed."];
          const isDiscoverySave =
            directive.operation.startsWith("discovery.save-") && semanticContext !== null;

          if (isDiscoverySave && semanticContext && allowAutoRepair) {
            let working = semanticContext.workingOutput;
            let savedOutput: unknown = null;
            let saved = false;
            const remainingAttempts = Math.max(
              0,
              MAX_AUTO_REPAIR_ATTEMPTS - semanticContext.autoAttempts
            );

            for (let index = 0; index < remainingAttempts && !saved; index += 1) {
              const repairNumber = semanticContext.autoAttempts + 1;
              semanticContext.autoAttempts = repairNumber;
              emit(request, onProgress, {
                message: `Automatic JSON patch repair ${repairNumber}/${MAX_AUTO_REPAIR_ATTEMPTS}: ${validationErrors[0]}`,
                progress: directive.progressStarted,
                status: "started",
                stepId: `repair-auto-local:${directive.id}:${repairNumber}`
              });
              const patchResponse = await runRepairProviderTask(
                request,
                working,
                semanticContext.outputSchema,
                validationErrors,
                `auto ${repairNumber}/${MAX_AUTO_REPAIR_ATTEMPTS}`,
                onDebug
              );
              if (patchResponse) {
                const allowed = allowedRepairPaths(validationErrors, working);
                const applied = applyRepairPatches(
                  working,
                  patchResponse,
                  allowed,
                  semanticContext.authority
                );
                working = applied.value;
                semanticContext.changedPaths.push(...applied.changedPaths);
              }

              const contractErrors = validateOutputContract(working, semanticContext.outputSchema);
              if (contractErrors.length > 0) {
                validationErrors = contractErrors;
              } else {
                try {
                  savedOutput = await localOperations.execute(
                    directive.operation,
                    request.project.rootPath,
                    { ...directive.inputs, result: working }
                  );
                  saved = true;
                } catch (saveError) {
                  validationErrors = [
                    saveError instanceof Error ? saveError.message : "Local validation failed."
                  ];
                }
              }

              emit(request, onProgress, {
                message: saved
                  ? `Automatic JSON patch repair ${repairNumber}/${MAX_AUTO_REPAIR_ATTEMPTS} passed deterministic save validation.`
                  : `Automatic JSON patch repair ${repairNumber}/${MAX_AUTO_REPAIR_ATTEMPTS} finished; validation still reports: ${validationErrors[0]}`,
                progress: directive.progressStarted,
                status: "completed",
                stepId: `repair-auto-local:${directive.id}:${repairNumber}`
              });
            }

            semanticContext.workingOutput = working;
            if (saved) {
              await journal.saveLocalResult(
                request.stageId,
                executionId,
                directive.id,
                directive.operation,
                savedOutput
              );
              emit(request, onProgress, {
                message: `${directive.messageCompleted} (after JSON patch repair)`,
                progress: directive.progressCompleted,
                status: "completed",
                stepId: directive.id
              });
              previous = {
                directiveId: directive.id,
                message: "Local save passed after JSON patch repair.",
                output: savedOutput,
                status: "completed"
              };
              continue;
            }
          }

          if (isDiscoverySave && semanticContext) {
            await persistRepair(
              repairStore,
              request,
              executionId,
              directive.id,
              { kind: "local", operation: directive.operation },
              semanticContext,
              validationErrors
            );
            const message =
              `Automatic repair is paused. ${validationErrors[0]} Manual Repair can patch the preserved JSON; Save stays disabled until validation is clean.`;
            emit(request, onProgress, {
              message,
              progress: directive.progressCompleted,
              status: "blocked",
              stepId: directive.id
            });
            return repairBlockedResponse(
              request,
              executionId,
              lastJob,
              lastResult,
              submitAccepted,
              syncedFindings,
              message,
              directive.progressCompleted
            );
          }

          const message = validationErrors[0];
          emit(request, onProgress, {
            message,
            progress: directive.progressCompleted,
            status: "failed",
            stepId: directive.id
          });
          previous = {
            directiveId: directive.id,
            message,
            output: null,
            status: "failed"
          };
          continue;
        }
      }

      try {
        const provider = await executeProvider(
          request,
          directive,
          client,
          authority,
          onProgress,
          onDebug
        );
        lastJob = provider.job;
        lastResult = provider.result;
        submitAccepted = provider.submitAccepted;
        syncedFindings = provider.syncedFindings;

        const processSucceeded = provider.result.status === "completed";
        const semanticOutputPresent =
          directive.mode !== "semantic" || provider.parsedOutput !== null;
        const outputContractPassed = provider.outputContractErrors.length === 0;
        const verificationPassed = !directive.requireOk || provider.parsedOutput?.ok === true;
        const succeeded =
          processSucceeded && semanticOutputPresent && outputContractPassed && verificationPassed;
        const failureDetail = providerFailureDetail(provider.result.outputChunks);

        if (
          directive.mode === "semantic" &&
          provider.parsedOutput &&
          directive.outputSchema
        ) {
          semanticContext = {
            authority: authorityFromSchema(directive.outputSchema, authority),
            autoAttempts: provider.autoRepairAttempts,
            changedPaths: [...provider.changedPaths],
            originalOutput: provider.originalOutput ?? provider.parsedOutput,
            outputSchema: directive.outputSchema,
            providerOutputText: provider.providerOutputText ?? undefined,
            workingOutput: provider.parsedOutput
          };
        }

        if (provider.repairPending && semanticContext) {
          await persistRepair(
            repairStore,
            request,
            executionId,
            directive.id,
            { kind: "provider" },
            semanticContext,
            provider.outputContractErrors
          );
          const message = provider.repairBaseViable
            ? `Automatic repair exhausted ${provider.autoRepairAttempts}/${MAX_AUTO_REPAIR_ATTEMPTS} attempts. Manual Repair is available; no repository rescan will occur.`
            : "Provider output was preserved as an incomplete JSON fragment. Automatic/Manual AI repair is disabled for this fragment to prevent replacing audit content; load/paste the full provider JSON and validate it. No repository rescan will occur.";
          return repairBlockedResponse(
            request,
            executionId,
            lastJob,
            lastResult,
            submitAccepted,
            syncedFindings,
            message,
            directive.progressCompleted
          );
        }

        previous = {
          directiveId: directive.id,
          message: succeeded
            ? null
            : !processSucceeded
              ? `Provider process failed${failureDetail ? `: ${failureDetail}` : "."}`
              : !semanticOutputPresent
                ? "Provider did not return a valid final JSON object."
                : !outputContractPassed
                  ? `Provider output contract failed: ${provider.outputContractErrors.join(" | ")}`
                  : "Provider verification returned ok != true.",
          output: provider.parsedOutput,
          status: succeeded ? "completed" : "failed"
        };
      } catch (error) {
        previous = {
          directiveId: directive.id,
          message: error instanceof Error ? error.message : "Provider execution failed.",
          output: null,
          status: "failed"
        };
      }
    }

    throw new Error(`Stage execution exceeded ${MAX_DIRECTIVES_PER_RUN} directives.`);
  };

  const run = async (
    request: JobRunRequest & { stageId: string },
    onProgress?: ProgressListener,
    onDebug?: DebugListener
  ): Promise<JobRunResponse> => {
    const journal = createJournal(request.project.rootPath);
    const repairStore = createRepairStore(request.project.rootPath);
    if (request.newRun) {
      await journal.clearStage(request.stageId);
      await repairStore.clear(request.stageId);
    }
    const executionId = request.newRun ? null : await journal.getExecutionId(request.stageId);
    return executeLoop(request, executionId, null, null, true, onProgress, onDebug);
  };

  const getRepairState = async (
    projectRootPath: string,
    stageId: string
  ): Promise<StageRepairState> => createRepairStore(projectRootPath).toPublicState(stageId);

  const importRepairJson = async (
    request: JobRunRequest & { stageId: string; workingJson: string },
    onProgress?: ProgressListener,
    onDebug?: DebugListener
  ): Promise<StageRepairState> => {
    const imported = parseProviderText(request.workingJson);
    if (!imported) {
      throw new Error("Existing repair JSON must contain one valid JSON object.");
    }

    const client = createClient(request.serverUrl);
    const journal = createJournal(request.project.rootPath);
    const repairStore = createRepairStore(request.project.rootPath);
    await journal.clearStage(request.stageId);
    await repairStore.clear(request.stageId);

    let executionId: string | null = null;
    let previous: ExecutionPreviousResult | null = null;
    let authority: RepairAuthority = {};

    emit(request, onProgress, {
      message: "Preparing existing JSON for repair; provider audit will not run.",
      progress: 18,
      status: "started",
      stepId: `repair-import:${request.stageId}`
    });

    for (let attempt = 0; attempt < MAX_DIRECTIVES_PER_RUN; attempt += 1) {
      const next = await client.post(
        "/executions/next",
        {
          capabilities: [...SUPPORTED_CAPABILITIES],
          executionId,
          localOperations: localOperations.list(),
          newRun: false,
          previous,
          project: request.project,
          providerId: request.providerId,
          outputLanguage: request.outputLanguage,
          timeoutMs: request.timeoutMs,
          stageId: request.stageId
        } satisfies StageExecutionNextRequest,
        stageExecutionNextResponseSchema
      );
      executionId = next.executionId;
      await journal.setExecutionId(request.stageId, executionId);
      previous = null;
      const directive = next.directive;

      if (directive.kind === "terminal") {
        throw new Error(
          `Cloud did not expose a recoverable provider step for ${request.stageId}: ${directive.message}`
        );
      }

      if (directive.kind === "local") {
        if (directive.operation.startsWith("discovery.save-")) {
          throw new Error("Repair import reached a save step before the provider step.");
        }
        emit(request, onProgress, {
          message: `${directive.messageStarted} (repair preparation)`,
          progress: directive.progressStarted,
          status: "started",
          stepId: directive.id
        });
        const output = await localOperations.execute(
          directive.operation,
          request.project.rootPath,
          directive.inputs
        );
        authority = mergeAuthority(authority, output);
        await journal.saveLocalResult(
          request.stageId,
          executionId,
          directive.id,
          directive.operation,
          output
        );
        emit(request, onProgress, {
          message: `${directive.messageCompleted} (repair preparation)`,
          progress: directive.progressCompleted,
          status: "completed",
          stepId: directive.id
        });
        previous = {
          directiveId: directive.id,
          message: "Local preparation completed for existing JSON recovery.",
          output,
          status: "completed"
        };
        continue;
      }

      if (directive.mode !== "semantic" || !directive.outputSchema) {
        throw new Error("Existing JSON recovery requires a semantic provider directive with an output schema.");
      }

      const originalOutput = deepCloneJsonObject(imported);
      const structural = repairProviderOutputStructure(imported, directive.outputSchema);
      let workingOutput = structural.value;
      const repairAuthority = authorityFromSchema(directive.outputSchema, authority);
      const authoritative = enforceAuthority(workingOutput, repairAuthority);
      workingOutput = authoritative.value;
      const validationErrors = validateOutputContract(workingOutput, directive.outputSchema);
      const changedPaths = [
        ...structural.movedResultKeys.map((key) => `$.result.${key}`),
        ...authoritative.changedPaths
      ];

      await persistRepair(
        repairStore,
        request,
        executionId,
        directive.id,
        {
          kind: "provider",
          jobId: directive.job.id,
          providerResultSubmitted: false,
          taskId: directive.job.task.id
        },
        {
          authority: repairAuthority,
          autoAttempts: 0,
          changedPaths,
          originalOutput,
          outputSchema: directive.outputSchema,
          workingOutput
        },
        validationErrors
      );

      emitDebug(request, onDebug, {
        kind: "contract",
        taskId: directive.job.task.id,
        processId: null,
        message:
          validationErrors.length === 0
            ? "Existing JSON loaded and provider contract passed; ready to save without rerunning the audit."
            : `Existing JSON loaded with ${validationErrors.length} validation error(s); Manual Repair/editing is available without rerunning the audit.`,
        text: null,
        exitCode: null,
        signal: null,
        timestamp: new Date().toISOString()
      });
      emit(request, onProgress, {
        message:
          validationErrors.length === 0
            ? "Existing JSON is valid. Save repaired result is ready; provider audit was not rerun."
            : "Existing JSON loaded into Repair workspace. Fix only the reported paths; provider audit was not rerun.",
        progress: directive.progressStarted,
        status: "blocked",
        stepId: `repair-import:${directive.id}`
      });
      return repairStore.toPublicState(request.stageId);
    }

    throw new Error(`Repair import exceeded ${MAX_DIRECTIVES_PER_RUN} directives.`);
  };

  const validateRepairJson = async (
    projectRootPath: string,
    stageId: string,
    workingJson: string
  ): Promise<StageRepairState> => {
    const store = createRepairStore(projectRootPath);
    const record = await store.get(stageId);
    if (!record) throw new Error("No preserved repair session exists for this stage.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(workingJson) as unknown;
    } catch (error) {
      record.validationErrors = [
        `Manual JSON is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
      ];
      await store.save(record);
      return store.toPublicState(stageId);
    }
    if (!isJsonObject(parsed)) {
      record.validationErrors = ["Manual JSON must be one JSON object."];
      await store.save(record);
      return store.toPublicState(stageId);
    }

    const structural = repairProviderOutputStructure(parsed, record.outputSchema);
    const authoritative = enforceAuthority(structural.value ?? parsed, record.authority);
    record.workingOutput = authoritative.value;
    record.changedPaths = [
      ...new Set([
        ...record.changedPaths,
        ...structural.movedResultKeys.map((key) => `$.result.${key}`),
        ...authoritative.changedPaths
      ])
    ];
    record.validationErrors = validateOutputContract(record.workingOutput, record.outputSchema);
    await store.save(record);
    return store.toPublicState(stageId);
  };

  const manualRepair = async (
    request: JobRunRequest & { stageId: string },
    onProgress?: ProgressListener,
    onDebug?: DebugListener
  ): Promise<StageRepairState> => {
    const store = createRepairStore(request.project.rootPath);
    const record = await store.get(request.stageId);
    if (!record) throw new Error("No preserved repair session exists for this stage.");
    if (record.validationErrors.length === 0) return store.toPublicState(request.stageId);
    if (!isRepairBaseViable(record.workingOutput, record.outputSchema)) {
      emit(request, onProgress, {
        message: "Manual AI Repair was not started because Working JSON is only a fragment. Paste/load the full original provider JSON and use Validate edited JSON; repository discovery will not rerun.",
        progress: 96,
        status: "blocked",
        stepId: `repair-manual-fragment:${record.manualAttempts + 1}`
      });
      return store.toPublicState(request.stageId);
    }

    emit(request, onProgress, {
      message: "Manual Repair is sending only the preserved JSON + current errors to AI. Repository rescan is disabled.",
      progress: 96,
      status: "started",
      stepId: `repair-manual:${record.manualAttempts + 1}`
    });
    const patchResponse = await runRepairProviderTask(
      request,
      record.workingOutput,
      record.outputSchema,
      record.validationErrors,
      `manual ${record.manualAttempts + 1}`,
      onDebug
    );
    record.manualAttempts += 1;
    if (patchResponse) {
      const allowed = allowedRepairPaths(record.validationErrors, record.workingOutput);
      const applied = applyRepairPatches(
        record.workingOutput,
        patchResponse,
        allowed,
        record.authority
      );
      record.workingOutput = applied.value;
      record.changedPaths = [...new Set([...record.changedPaths, ...applied.changedPaths])];
    }
    record.validationErrors = validateOutputContract(record.workingOutput, record.outputSchema);
    await store.save(record);
    emit(request, onProgress, {
      message:
        record.validationErrors.length === 0
          ? "Manual Repair produced schema-valid JSON. Review it, then use Save repaired result."
          : `Manual Repair finished; ${record.validationErrors.length} contract error(s) remain.`,
      progress: 97,
      status: "completed",
      stepId: `repair-manual:${record.manualAttempts}`
    });
    return store.toPublicState(request.stageId);
  };

  const saveRepair = async (
    request: JobRunRequest & { stageId: string },
    onProgress?: ProgressListener,
    onDebug?: DebugListener
  ): Promise<JobRunResponse> => {
    const store = createRepairStore(request.project.rootPath);
    const record = await store.get(request.stageId);
    if (!record) throw new Error("No preserved repair session exists for this stage.");
    if (record.validationErrors.length > 0) {
      throw new Error("Repaired JSON still has validation errors. Save is disabled until validation passes.");
    }

    const semanticContext: SemanticRepairContext = {
      authority: record.authority,
      autoAttempts: record.autoAttempts,
      changedPaths: record.changedPaths,
      originalOutput: record.originalOutput,
      outputSchema: record.outputSchema,
      workingOutput: record.workingOutput
    };
    let previous: ExecutionPreviousResult;

    if (record.pending.kind === "local") {
      try {
        const output = await localOperations.execute(
          record.pending.operation,
          request.project.rootPath,
          { result: record.workingOutput }
        );
        previous = {
          directiveId: record.directiveId,
          message: "Manually repaired JSON passed deterministic save validation.",
          output,
          status: "completed"
        };
      } catch (error) {
        record.validationErrors = [
          error instanceof Error ? error.message : "Deterministic save validation failed."
        ];
        await store.save(record);
        const message = `Save blocked: ${record.validationErrors[0]}`;
        emit(request, onProgress, {
          message,
          progress: 98,
          status: "blocked",
          stepId: "repair-save"
        });
        return repairBlockedResponse(
          request,
          record.executionId,
          null,
          null,
          false,
          [],
          message,
          98
        );
      }
    } else {
      if (
        record.pending.providerResultSubmitted === false &&
        record.pending.jobId &&
        record.pending.taskId
      ) {
        const now = new Date().toISOString();
        const client = createClient(request.serverUrl);
        await client.post(
          `/jobs/${encodeURIComponent(record.pending.jobId)}/result`,
          {
            taskId: record.pending.taskId,
            jobId: record.pending.jobId,
            providerId: request.providerId,
            status: "completed",
            exitCode: 0,
            outputChunks: [
              { stream: "stdout", text: `${JSON.stringify(record.workingOutput)}\n`, timestamp: now }
            ],
            findings: [],
            startedAt: now,
            finishedAt: now
          },
          submitResultResponseSchema
        );
        record.pending.providerResultSubmitted = true;
        await store.save(record);
      }
      previous = {
        directiveId: record.directiveId,
        message: "Validated repaired provider output supplied without rerunning the audit.",
        output: record.workingOutput,
        status: "completed"
      };
    }

    emit(request, onProgress, {
      message: "Saving the validated repaired JSON without rerunning repository discovery.",
      progress: 98,
      status: "started",
      stepId: "repair-save"
    });
    const response = await executeLoop(
      request,
      record.executionId,
      previous,
      semanticContext,
      false,
      onProgress,
      onDebug
    );
    if (response.stageOutcome.status === "completed") await store.clear(request.stageId);
    return response;
  };

  return {
    getRepairState,
    importRepairJson,
    manualRepair,
    retryProviderNow,
    run,
    saveRepair,
    validateRepairJson
  };
};
