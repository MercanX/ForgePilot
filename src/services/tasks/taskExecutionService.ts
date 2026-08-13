import { createCommandRunner, type CommandRunner } from "@main/process/commandRunner";
import { createProcessManager, type ProcessManager } from "@main/process/processManager";
import { createProviderRegistry, type ProviderRegistry } from "@main/providers/registry";
import type {
  TaskExecutionRequest,
  TaskExitEvent,
  TaskOutputEvent,
  TaskStartResponse
} from "@shared/schemas/job";

type TaskExecutionServiceEvents = {
  exit: (event: TaskExitEvent) => void;
  output: (event: TaskOutputEvent) => void;
};

export type TaskExecutionService = {
  dispose: () => void;
  onExit: (callback: TaskExecutionServiceEvents["exit"]) => () => void;
  onOutput: (callback: TaskExecutionServiceEvents["output"]) => () => void;
  start: (request: TaskExecutionRequest) => Promise<TaskStartResponse>;
  stop: (taskId: string) => boolean;
};

const createEchoCommand = (
  request: TaskExecutionRequest
): { args: string[]; command: string; input: string } => ({
  args: [
    "-e",
    [
      "const fs = require('node:fs');",
      "const input = fs.readFileSync(0, 'utf8');",
      "process.stdout.write(`ForgePilot echo fixture for provider: ${process.argv[1]}\\n`);",
      "process.stdout.write(input);"
    ].join(" "),
    request.providerId
  ],
  command: process.execPath,
  input: request.instructions.body
});

const createProviderCommand = async (
  request: TaskExecutionRequest,
  runner: CommandRunner
): Promise<{ args: string[]; command: string; input?: string }> => {
  const commandName = request.providerId === "claude-code" ? "claude" : "codex";
  const executablePath = await runner.findExecutable(commandName);

  if (!executablePath) {
    throw new Error(`${commandName} was not found on PATH.`);
  }

  if (request.providerId === "claude-code") {
    return {
      args: ["-p", "--permission-mode", "plan", request.instructions.body],
      command: executablePath
    };
  }

  return {
    args: [
      "exec",
      "--ask-for-approval",
      "never",
      "--sandbox",
      "read-only",
      "-C",
      request.projectRootPath,
      request.instructions.body
    ],
    command: executablePath
  };
};

export const createTaskExecutionService = (
  options: {
    processManager?: ProcessManager;
    providerRegistry?: ProviderRegistry;
    runner?: CommandRunner;
  } = {}
): TaskExecutionService => {
  const processManager = options.processManager ?? createProcessManager();
  const providerRegistry = options.providerRegistry ?? createProviderRegistry();
  const runner = options.runner ?? createCommandRunner();
  const outputCallbacks = new Set<TaskExecutionServiceEvents["output"]>();
  const exitCallbacks = new Set<TaskExecutionServiceEvents["exit"]>();

  const start = async (request: TaskExecutionRequest): Promise<TaskStartResponse> => {
    const provider = await providerRegistry.detect(request.providerId);

    if (!provider.installed) {
      throw new Error(`${provider.label} is not installed.`);
    }

    const command =
      request.mode === "echo-fixture"
        ? createEchoCommand(request)
        : await createProviderCommand(request, runner);

    const managedProcess = await processManager.start({
      args: command.args,
      command: command.command,
      input: command.input,
      providerId: request.providerId,
      rootPath: request.projectRootPath,
      timeoutMs: request.timeoutMs
    });

    managedProcess.onOutput((chunk) => {
      const event: TaskOutputEvent = {
        chunk,
        providerId: request.providerId,
        taskId: managedProcess.handle.id
      };
      for (const callback of outputCallbacks) {
        callback(event);
      }
    });

    managedProcess.onExit((exitInfo) => {
      const event: TaskExitEvent = {
        exitInfo,
        providerId: request.providerId,
        taskId: managedProcess.handle.id
      };
      for (const callback of exitCallbacks) {
        callback(event);
      }
    });

    return {
      handle: managedProcess.handle,
      startedAt: new Date().toISOString()
    };
  };

  return {
    dispose: () => processManager.dispose(),
    onExit: (callback) => {
      exitCallbacks.add(callback);
      return () => exitCallbacks.delete(callback);
    },
    onOutput: (callback) => {
      outputCallbacks.add(callback);
      return () => outputCallbacks.delete(callback);
    },
    start,
    stop: (taskId) => processManager.stop(taskId)
  };
};
