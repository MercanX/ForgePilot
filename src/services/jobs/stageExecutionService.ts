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
import type { Job, ProviderOutputChunk, TaskResult } from "@shared/schemas/job";

import { createHttpClient, type HttpClient } from "../api/httpClient";
import { createTaskExecutionService, type TaskExecutionService } from "../tasks/taskExecutionService";

import { createLocalOperationRegistry, type LocalOperationRegistry } from "./localOperationRegistry";
import { createStageExecutionJournal, type StageExecutionJournal } from "./stageExecutionJournal";

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_DIRECTIVES_PER_RUN = 100;

type ProgressListener = (event: JobRunProgressEvent) => void;

type StageExecutionServiceOptions = {
  createClient?: (serverUrl: string) => HttpClient;
  localOperationRegistry?: LocalOperationRegistry;
  taskExecutionService?: TaskExecutionService;
  createJournal?: (projectRootPath: string) => StageExecutionJournal;
};

export type StageExecutionService = {
  run: (
    request: JobRunRequest & { stageId: string },
    onProgress?: ProgressListener
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

export const parseLastJsonObject = (
  chunks: ProviderOutputChunk[]
): Record<string, unknown> | null => parseProviderText(chunks.map((chunk) => chunk.text).join(""));

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

const validateOutputContract = (
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
    onProgress?: ProgressListener
  ): Promise<ProviderExecutionResult> => {
    const job = directive.job;
    const task = await client.get(`/jobs/${encodeURIComponent(job.id)}`, getTaskResponseSchema);
    const observedOutput: Array<{ taskId: string; chunk: ProviderOutputChunk }> = [];
    const observedExits = new Map<
      string,
      { exitCode: number | null; finishedAt: string; signal: string | null }
    >();
    let resolveExpectedExit:
      | ((exit: { exitCode: number | null; finishedAt: string; signal: string | null }) => void)
      | null = null;
    let expectedTaskId: string | null = null;
    const removeOutput = taskExecutionService.onOutput((event) => {
      observedOutput.push({ taskId: event.taskId, chunk: event.chunk });
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
      const alreadyExited = observedExits.get(started.handle.id);
      const exitInfo =
        alreadyExited ??
        (await new Promise<{ exitCode: number | null; finishedAt: string; signal: string | null }>(
          (resolve) => {
            resolveExpectedExit = resolve;
          }
        ));
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
      const rawParsedOutput = parseLastJsonObject(outputChunks);
      const parsedOutput =
        directive.mode === "semantic"
          ? selectContractOutput(rawParsedOutput, directive.outputSchema)
          : rawParsedOutput;
      const outputContractErrors =
        directive.mode === "semantic"
          ? validateOutputContract(parsedOutput, directive.outputSchema)
          : [];
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
    onProgress?: ProgressListener
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
          previous = {
            directiveId: directive.id,
            message: error instanceof Error ? error.message : "Local operation failed.",
            output: null,
            status: "failed"
          };
        }
        continue;
      }

      try {
        const provider = await executeProvider(request, directive, client, onProgress);
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
