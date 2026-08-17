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
import type { Job, JobProviderDebugEvent, ProviderOutputChunk, TaskResult } from "@shared/schemas/job";

import { createHttpClient, type HttpClient } from "../api/httpClient";
import { createTaskExecutionService, type TaskExecutionService } from "../tasks/taskExecutionService";

import { createLocalOperationRegistry, type LocalOperationRegistry } from "./localOperationRegistry";
import { createStageExecutionJournal, type StageExecutionJournal } from "./stageExecutionJournal";

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_DIRECTIVES_PER_RUN = 100;

type ProgressListener = (event: JobRunProgressEvent) => void;
type DebugListener = (event: JobProviderDebugEvent) => void;

type StageExecutionServiceOptions = {
  createClient?: (serverUrl: string) => HttpClient;
  localOperationRegistry?: LocalOperationRegistry;
  taskExecutionService?: TaskExecutionService;
  createJournal?: (projectRootPath: string) => StageExecutionJournal;
};

export type StageExecutionService = {
  run: (
    request: JobRunRequest & { stageId: string },
    onProgress?: ProgressListener,
    onDebug?: DebugListener
  ) => Promise<JobRunResponse>;
};

type ProviderExecutionResult = {
  job: Job;
  outputContractErrors: string[];
  parsedOutput: Record<string, unknown> | null;
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
    }
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
  let fallbackSize = -1;

  for (const candidate of textCandidates) {
    const parsed = parseProviderText(candidate.text);
    if (!parsed) {
      continue;
    }

    // Keep the largest parseable candidate as the diagnostic fallback. This is
    // important for truncated Claude result events: their tail may contain a
    // valid nested object (for example `handoff`) while the complete assistant
    // event contains the actual audit envelope.
    let serializedSize = 0;
    try {
      serializedSize = JSON.stringify(parsed).length;
    } catch {
      serializedSize = 0;
    }
    if (serializedSize > fallbackSize) {
      fallback = { source: candidate.source, value: parsed };
      fallbackSize = serializedSize;
    }

    if (!schema) {
      continue;
    }

    const semanticCandidate = selectContractOutput(parsed, schema);
    if (validateOutputContract(semanticCandidate, schema).length === 0) {
      return { source: candidate.source, value: parsed };
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

export const createStageExecutionService = (
  options: StageExecutionServiceOptions = {}
): StageExecutionService => {
  const createClient = options.createClient ?? ((serverUrl: string) => createHttpClient(serverUrl));
  const localOperations = options.localOperationRegistry ?? createLocalOperationRegistry();
  const taskExecutionService = options.taskExecutionService ?? createTaskExecutionService();
  const createJournal = options.createJournal ?? createStageExecutionJournal;

  const executeProvider = async (
    request: JobRunRequest & { stageId: string },
    directive: ProviderExecutionDirective,
    client: HttpClient,
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
      const started = await taskExecutionService.start({
        instructions: task.instructions,
        mode: "provider",
        model: request.model,
        outputJsonSchema: directive.outputSchema,
        projectRootPath: request.project.rootPath,
        providerId: request.providerId,
        timeoutMs: Math.min(request.timeoutMs, task.timeoutMs)
      });

      heartbeat = setInterval(() => {
        void client
          .post(
            `/jobs/${encodeURIComponent(job.id)}/heartbeat`,
            { jobId: job.id, timestamp: new Date().toISOString() },
            syncFindingsResponseSchema
          )
          .catch(() => undefined);
      }, HEARTBEAT_INTERVAL_MS);

      expectedTaskId = started.handle.id;
      const commandPreview = [started.command, ...started.args.map((arg) => JSON.stringify(arg))].join(" ");
      emitDebug(request, onDebug, {
        kind: "provider-start",
        taskId: started.handle.id,
        processId: started.handle.processId,
        message: "Provider process started.",
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
      const exitInfo =
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
      const outputChunks = observedOutput
        .filter((entry) => entry.taskId === started.handle.id)
        .map((entry) => entry.chunk);
      const result: TaskResult = {
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
          job,
          outputContractErrors: [],
          parsedOutput: null,
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
      const rawParsedOutput = parsedSelection.value;
      const parsedOutput =
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
      const outputContractErrors =
        directive.mode === "semantic"
          ? validateOutputContract(parsedOutput, directive.outputSchema)
          : [];
      if (directive.mode === "semantic") {
        emitDebug(request, onDebug, {
          kind: "contract",
          taskId: started.handle.id,
          processId: started.handle.processId,
          message:
            outputContractErrors.length === 0
              ? "Provider output contract passed."
              : `Provider output contract failed: ${outputContractErrors[0]}`,
          text: null,
          exitCode: null,
          signal: null,
          timestamp: new Date().toISOString()
        });
      }
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
              ? `Provider output contract failed: ${outputContractErrors[0]} (${describeJsonShape(rawParsedOutput)})`
              : "Provider verification returned ok != true.";

      emit(request, onProgress, {
        message: directiveSucceeded ? directive.messageCompleted : failureMessage,
        progress: directive.progressCompleted,
        status: directiveSucceeded ? "completed" : "failed",
        stepId: directive.id
      });

      return {
        job,
        outputContractErrors,
        parsedOutput,
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

  const run = async (
    request: JobRunRequest & { stageId: string },
    onProgress?: ProgressListener,
    onDebug?: DebugListener
  ): Promise<JobRunResponse> => {
    const client = createClient(request.serverUrl);
    const journal = createJournal(request.project.rootPath);

    if (request.newRun) {
      await journal.clearStage(request.stageId);
    }

    let executionId = request.newRun ? null : await journal.getExecutionId(request.stageId);
    let previous: ExecutionPreviousResult | null = null;
    let lastJob: Job | null = null;
    let lastResult: TaskResult | null = null;
    let submitAccepted = false;
    let syncedFindings: TaskResult["findings"] = [];
    let resumeRetryAvailable = executionId !== null;

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
        const staleExecution =
          error instanceof Error && error.message.includes("HTTP 404");

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
          const output = cached.found
            ? cached.output
            : await localOperations.execute(
                directive.operation,
                request.project.rootPath,
                directive.inputs
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
        } catch (error) {
          const message = error instanceof Error ? error.message : "Local operation failed.";
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
        }
        continue;
      }

      try {
        const provider = await executeProvider(request, directive, client, onProgress, onDebug);
        lastJob = provider.job;
        lastResult = provider.result;
        submitAccepted = provider.submitAccepted;
        syncedFindings = provider.syncedFindings;

        const processSucceeded = provider.result.status === "completed";
        const semanticOutputPresent =
          directive.mode !== "semantic" || provider.parsedOutput !== null;
        const outputContractPassed = provider.outputContractErrors.length === 0;
        const verificationPassed =
          !directive.requireOk || provider.parsedOutput?.ok === true;
        const succeeded =
          processSucceeded && semanticOutputPresent && outputContractPassed && verificationPassed;
        const failureDetail = providerFailureDetail(provider.result.outputChunks);

        previous = {
          directiveId: directive.id,
          message: succeeded
            ? null
            : !processSucceeded
              ? `Provider process failed${failureDetail ? `: ${failureDetail}` : "."}`
              : !semanticOutputPresent
                ? "Provider did not return a valid final JSON object."
                : !outputContractPassed
                  ? `Provider output contract failed: ${provider.outputContractErrors[0]}`
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

  return { run };
};
