import {
  DESKTOP_PROTOCOL_VERSION,
  SUPPORTED_CAPABILITIES
} from "@shared/constants/protocolVersion";
import type {
  CloudConnectionStatus,
  CloudStatusRequest,
  FailJobRequest,
  GetTaskResponse,
  HandshakeResponse,
  JobRunRequest,
  JobRunResponse,
  RequestJobRequest,
  RequestJobResponse,
  SubmitResultResponse,
  SyncFindingsResponse,
  WorkflowResponse
} from "@shared/schemas/cloud-api";
import {
  getTaskResponseSchema,
  handshakeResponseSchema,
  requestJobResponseSchema,
  submitResultResponseSchema,
  syncFindingsResponseSchema,
  workflowResponseSchema
} from "@shared/schemas/cloud-api";
import type { ProviderOutputChunk, TaskResult } from "@shared/schemas/job";
import type { Project } from "@shared/schemas/project";
import type { ProviderId } from "@shared/schemas/provider";

import { createHttpClient, type HttpClient } from "../api/httpClient";
import {
  runCaptureGitStateJob,
  runPlaceInputsJob,
  runSelectRunJob,
  runStartupJob
} from "../startup/startupJobService";
import {
  createTaskExecutionService,
  type TaskExecutionService
} from "../tasks/taskExecutionService";

export type JobService = {
  fail: (request: FailJobRequest, serverUrl: string) => Promise<{ accepted: true }>;
  getStatus: (request: CloudStatusRequest) => Promise<CloudConnectionStatus>;
  getTask: (jobId: string, serverUrl: string) => Promise<GetTaskResponse>;
  getWorkflow: (projectId: string, serverUrl: string) => Promise<WorkflowResponse>;
  requestJob: (request: RequestJobRequest, serverUrl: string) => Promise<RequestJobResponse>;
  runOnce: (request: JobRunRequest) => Promise<JobRunResponse>;
  submitResult: (result: TaskResult, serverUrl: string) => Promise<SubmitResultResponse>;
  syncFindings: (
    runId: string,
    findings: TaskResult["findings"],
    serverUrl: string
  ) => Promise<SyncFindingsResponse>;
};

type JobServiceOptions = {
  createClient?: (serverUrl: string) => HttpClient;
  desktopVersion?: string;
  runCaptureGitStateJob?: typeof runCaptureGitStateJob;
  runPlaceInputsJob?: typeof runPlaceInputsJob;
  runSelectRunJob?: typeof runSelectRunJob;
  runStartupJob?: typeof runStartupJob;
  taskExecutionService?: TaskExecutionService;
};

const HEARTBEAT_INTERVAL_MS = 30_000;
const STARTUP_STAGE_ID = "010-startup";

const createClientFactory =
  (options: JobServiceOptions): ((serverUrl: string) => HttpClient) =>
  (serverUrl) =>
    options.createClient?.(serverUrl) ?? createHttpClient(serverUrl);

const createRequestJobPayload = (project: Project, providerId: ProviderId): RequestJobRequest => ({
  capabilities: [...SUPPORTED_CAPABILITIES],
  localExecution: null,
  project,
  providerId
});

export const createJobService = (options: JobServiceOptions = {}): JobService => {
  const createClient = createClientFactory(options);
  const taskExecutionService = options.taskExecutionService ?? createTaskExecutionService();
  const desktopVersion = options.desktopVersion ?? "0.1.0";
  const executeCaptureGitStateJob = options.runCaptureGitStateJob ?? runCaptureGitStateJob;
  const executePlaceInputsJob = options.runPlaceInputsJob ?? runPlaceInputsJob;
  const executeSelectRunJob = options.runSelectRunJob ?? runSelectRunJob;
  const executeStartupJob = options.runStartupJob ?? runStartupJob;

  const handshake = async (serverUrl: string): Promise<HandshakeResponse> =>
    createClient(serverUrl).post(
      "/session/handshake",
      {
        desktopVersion,
        protocolVersion: DESKTOP_PROTOCOL_VERSION,
        supportedCapabilities: [...SUPPORTED_CAPABILITIES]
      },
      handshakeResponseSchema
    );

  const getStatus = async (request: CloudStatusRequest): Promise<CloudConnectionStatus> => {
    try {
      const response = await handshake(request.serverUrl);
      return {
        connected: response.status !== "update-required",
        message: response.message ?? response.status,
        serverVersion: response.serverVersion
      };
    } catch (error) {
      return {
        connected: false,
        message: error instanceof Error ? error.message : "Cloud connection failed.",
        serverVersion: null
      };
    }
  };

  const getWorkflow = async (projectId: string, serverUrl: string): Promise<WorkflowResponse> =>
    createClient(serverUrl).get(
      `/workflows/current?projectId=${encodeURIComponent(projectId)}`,
      workflowResponseSchema
    );

  const requestJob = async (
    request: RequestJobRequest,
    serverUrl: string
  ): Promise<RequestJobResponse> =>
    createClient(serverUrl).post("/jobs/request", request, requestJobResponseSchema);

  const getTask = async (jobId: string, serverUrl: string): Promise<GetTaskResponse> =>
    createClient(serverUrl).get(`/jobs/${encodeURIComponent(jobId)}`, getTaskResponseSchema);

  const submitResult = async (
    result: TaskResult,
    serverUrl: string
  ): Promise<SubmitResultResponse> =>
    createClient(serverUrl).post(
      `/jobs/${encodeURIComponent(result.jobId)}/result`,
      result,
      submitResultResponseSchema
    );

  const fail = async (request: FailJobRequest, serverUrl: string): Promise<{ accepted: true }> =>
    createClient(serverUrl).post(
      `/jobs/${encodeURIComponent(request.jobId)}/fail`,
      request,
      syncFindingsResponseSchema
    );

  const syncFindings = async (
    runId: string,
    findings: TaskResult["findings"],
    serverUrl: string
  ): Promise<SyncFindingsResponse> =>
    createClient(serverUrl).post(
      "/findings/sync",
      {
        findings,
        runId
      },
      syncFindingsResponseSchema
    );

  const getLastJsonObject = (outputChunks: ProviderOutputChunk[]): { ok?: unknown } | null => {
    const lines = outputChunks
      .map((chunk) => chunk.text)
      .join("")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const jsonLine = [...lines]
      .reverse()
      .find((line) => line.startsWith("{") && line.endsWith("}"));

    if (!jsonLine) {
      return null;
    }

    try {
      const parsed = JSON.parse(jsonLine) as unknown;

      return typeof parsed === "object" && parsed !== null ? parsed : null;
    } catch {
      return null;
    }
  };

  const runProviderVerification = async (
    request: JobRunRequest,
    localExecution: unknown
  ): Promise<JobRunResponse> => {
    const outputChunks: ProviderOutputChunk[] = [];
    const job = await requestJob(
      {
        ...createRequestJobPayload(request.project, request.providerId),
        localExecution
      },
      request.serverUrl
    );
    const task = await getTask(job.id, request.serverUrl);

    const removeOutputListener = taskExecutionService.onOutput((event) => {
      outputChunks.push(event.chunk);
    });
    let removeExitListener: (() => void) | undefined;
    let heartbeat: NodeJS.Timeout | undefined;

    try {
      const startedTask = await taskExecutionService.start({
        instructions: task.instructions,
        mode: "provider",
        model: request.model,
        projectRootPath: request.project.rootPath,
        providerId: request.providerId,
        timeoutMs: request.timeoutMs
      });

      heartbeat = setInterval(() => {
        void createClient(request.serverUrl).post(
          `/jobs/${encodeURIComponent(job.id)}/heartbeat`,
          {
            jobId: job.id,
            timestamp: new Date().toISOString()
          },
          syncFindingsResponseSchema
        );
      }, HEARTBEAT_INTERVAL_MS);

      const exitInfo = await new Promise<TaskResult["exitCode"]>((resolve) => {
        removeExitListener = taskExecutionService.onExit((event) => {
          if (event.taskId === startedTask.handle.id) {
            resolve(event.exitInfo.exitCode);
          }
        });
      });

      const finishedAt = new Date().toISOString();
      const result: TaskResult = {
        exitCode: exitInfo,
        findings: [],
        finishedAt,
        jobId: job.id,
        outputChunks,
        providerId: request.providerId,
        startedAt: startedTask.startedAt,
        status: exitInfo === 0 ? "completed" : "failed",
        taskId: startedTask.handle.id
      };
      const submitResponse = await submitResult(result, request.serverUrl);
      const syncResponse = await syncFindings(
        job.runId,
        submitResponse.findings,
        request.serverUrl
      );

      return {
        job,
        result,
        submitAccepted: submitResponse.accepted,
        syncedFindings: syncResponse.accepted ? submitResponse.findings : []
      };
    } catch (error) {
      await fail(
        {
          jobId: job.id,
          message: error instanceof Error ? error.message : "Unknown client error.",
          reason: "client-error"
        },
        request.serverUrl
      );
      throw error;
    } finally {
      if (heartbeat) {
        clearInterval(heartbeat);
      }
      removeOutputListener();
      if (removeExitListener) {
        removeExitListener();
      }
    }
  };

  const runOnce = async (request: JobRunRequest): Promise<JobRunResponse> => {
    await handshake(request.serverUrl);
    await getWorkflow(request.project.id, request.serverUrl);

    if (request.stageId !== STARTUP_STAGE_ID) {
      return runProviderVerification(request, null);
    }

    const startupResult = await executeStartupJob(request.project.rootPath);
    const startupVerification = await runProviderVerification(request, startupResult);
    const startupJson = getLastJsonObject(startupVerification.result.outputChunks);

    if (startupJson?.ok !== true) {
      return startupVerification;
    }

    const selectRunResult = await executeSelectRunJob(request.project.rootPath, request.newRun);
    const selectRunVerification = await runProviderVerification(request, {
      select_run: selectRunResult
    });
    const selectRunJson = getLastJsonObject(selectRunVerification.result.outputChunks);

    if (selectRunJson?.ok !== true || selectRunResult.decision === "already_sealed") {
      return selectRunVerification;
    }

    const placeInputsResult = await executePlaceInputsJob(
      request.project.rootPath,
      selectRunResult.run_id
    );
    const placeInputsVerification = await runProviderVerification(request, {
      place_inputs: placeInputsResult
    });
    const placeInputsJson = getLastJsonObject(placeInputsVerification.result.outputChunks);

    if (placeInputsJson?.ok !== true || placeInputsResult.status !== "ready") {
      return placeInputsVerification;
    }

    const captureGitStateResult = await executeCaptureGitStateJob(
      request.project.rootPath,
      selectRunResult.run_id
    );

    return runProviderVerification(request, {
      capture_git_state: captureGitStateResult
    });
  };

  return {
    fail,
    getStatus,
    getTask,
    getWorkflow,
    requestJob,
    runOnce,
    submitResult,
    syncFindings
  };
};
