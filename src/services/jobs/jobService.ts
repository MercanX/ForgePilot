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
  JobRunProgressEvent,
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
  runOnce: (request: JobRunRequest, onProgress?: JobRunProgressListener) => Promise<JobRunResponse>;
  submitResult: (result: TaskResult, serverUrl: string) => Promise<SubmitResultResponse>;
  syncFindings: (
    runId: string,
    findings: TaskResult["findings"],
    serverUrl: string
  ) => Promise<SyncFindingsResponse>;
};

export type JobRunProgressListener = (event: JobRunProgressEvent) => void;

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
    localExecution: unknown,
    onProgress: JobRunProgressListener | undefined,
    stepId: string,
    progressStarted: number,
    progressCompleted: number
  ): Promise<JobRunResponse> => {
    const outputChunks: ProviderOutputChunk[] = [];
    onProgress?.({
      message: "Requesting LLM verification job from the cloud.",
      progress: progressStarted,
      projectId: request.project.id,
      stageId: request.stageId,
      status: "started",
      stepId
    });
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
      onProgress?.({
        message: "LLM provider process is running; waiting for verification output.",
        progress: Math.min(progressStarted + 4, progressCompleted - 1),
        projectId: request.project.id,
        stageId: request.stageId,
        status: "started",
        stepId
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
      onProgress?.({
        message:
          result.status === "completed"
            ? "LLM verification completed."
            : "LLM verification failed.",
        progress: progressCompleted,
        projectId: request.project.id,
        stageId: request.stageId,
        status: result.status === "completed" ? "completed" : "failed",
        stepId
      });

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

  const emit = (
    request: JobRunRequest,
    onProgress: JobRunProgressListener | undefined,
    event: Omit<JobRunProgressEvent, "projectId" | "stageId">
  ): void => {
    onProgress?.({
      ...event,
      projectId: request.project.id,
      stageId: request.stageId
    });
  };

  const runOnce = async (
    request: JobRunRequest,
    onProgress?: JobRunProgressListener
  ): Promise<JobRunResponse> => {
    emit(request, onProgress, {
      message: "Connecting to the cloud session.",
      progress: 4,
      status: "started",
      stepId: "cloud-handshake"
    });
    await handshake(request.serverUrl);
    emit(request, onProgress, {
      message: "Cloud session is connected.",
      progress: 8,
      status: "completed",
      stepId: "cloud-handshake"
    });

    emit(request, onProgress, {
      message: "Loading the current workflow.",
      progress: 12,
      status: "started",
      stepId: "load-workflow"
    });
    await getWorkflow(request.project.id, request.serverUrl);
    emit(request, onProgress, {
      message: "Workflow loaded.",
      progress: 16,
      status: "completed",
      stepId: "load-workflow"
    });

    if (request.stageId !== STARTUP_STAGE_ID) {
      return runProviderVerification(request, null, onProgress, "provider-verification", 30, 100);
    }

    emit(request, onProgress, {
      message: "Job 1 started: checking factory folder and reading config.",
      progress: 22,
      status: "started",
      stepId: "job-1-local"
    });
    const startupResult = await executeStartupJob(request.project.rootPath);
    emit(request, onProgress, {
      message: "Job 1 local execution completed.",
      progress: 30,
      status: "completed",
      stepId: "job-1-local"
    });
    const startupVerification = await runProviderVerification(
      request,
      startupResult,
      onProgress,
      "job-1-llm",
      34,
      46
    );
    const startupJson = getLastJsonObject(startupVerification.result.outputChunks);

    if (startupJson?.ok !== true) {
      emit(request, onProgress, {
        message: "Job 1 verification did not pass; the stage stopped.",
        progress: 46,
        status: "failed",
        stepId: "job-1-llm"
      });
      return startupVerification;
    }

    emit(request, onProgress, {
      message: "Job 2 started: selecting the AI Factory run folder.",
      progress: 50,
      status: "started",
      stepId: "job-2-local"
    });
    const selectRunResult = await executeSelectRunJob(request.project.rootPath, request.newRun);
    emit(request, onProgress, {
      message: `Job 2 local execution completed with decision: ${selectRunResult.decision}.`,
      progress: 58,
      status: "completed",
      stepId: "job-2-local"
    });
    const selectRunVerification = await runProviderVerification(
      request,
      {
        select_run: selectRunResult
      },
      onProgress,
      "job-2-llm",
      60,
      68
    );
    const selectRunJson = getLastJsonObject(selectRunVerification.result.outputChunks);

    if (selectRunJson?.ok !== true || selectRunResult.decision === "already_sealed") {
      emit(request, onProgress, {
        message:
          selectRunResult.decision === "already_sealed"
            ? "A valid sealed run already exists; no further jobs are needed."
            : "Job 2 verification did not pass; the stage stopped.",
        progress: selectRunResult.decision === "already_sealed" ? 100 : 68,
        status: selectRunResult.decision === "already_sealed" ? "completed" : "failed",
        stepId: "job-2-llm"
      });
      return selectRunVerification;
    }

    emit(request, onProgress, {
      message: "Job 3 started: placing SCOPE.md and BASELINE.md.",
      progress: 72,
      status: "started",
      stepId: "job-3-local"
    });
    const placeInputsResult = await executePlaceInputsJob(
      request.project.rootPath,
      selectRunResult.run_id
    );
    emit(request, onProgress, {
      message: `Job 3 local execution completed with status: ${placeInputsResult.status}.`,
      progress: 78,
      status: placeInputsResult.status === "ready" ? "completed" : "blocked",
      stepId: "job-3-local"
    });
    const placeInputsVerification = await runProviderVerification(
      request,
      {
        place_inputs: placeInputsResult
      },
      onProgress,
      "job-3-llm",
      80,
      86
    );
    const placeInputsJson = getLastJsonObject(placeInputsVerification.result.outputChunks);

    if (placeInputsJson?.ok !== true || placeInputsResult.status !== "ready") {
      emit(request, onProgress, {
        message:
          placeInputsResult.status === "waiting_for_input"
            ? "SCOPE.md and BASELINE.md need user review before the next job can run."
            : "Job 3 verification did not pass; the stage stopped.",
        progress: placeInputsResult.status === "waiting_for_input" ? 86 : 80,
        status: placeInputsResult.status === "waiting_for_input" ? "blocked" : "failed",
        stepId: "job-3-llm"
      });
      return placeInputsVerification;
    }

    emit(request, onProgress, {
      message: "Job 4 started: capturing git state.",
      progress: 90,
      status: "started",
      stepId: "job-4-local"
    });
    const captureGitStateResult = await executeCaptureGitStateJob(
      request.project.rootPath,
      selectRunResult.run_id
    );
    emit(request, onProgress, {
      message: "Job 4 local execution completed.",
      progress: 94,
      status: "completed",
      stepId: "job-4-local"
    });

    return runProviderVerification(
      request,
      {
        capture_git_state: captureGitStateResult
      },
      onProgress,
      "job-4-llm",
      96,
      100
    );
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
