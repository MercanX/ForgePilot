import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { createCommandRunner, type CommandRunner } from "@main/process/commandRunner";
import { createProcessManager, type ProcessManager } from "@main/process/processManager";
import { createProviderRegistry, type ProviderRegistry } from "@main/providers/registry";
import type {
  TaskExecutionRequest,
  TaskExitEvent,
  TaskOutputEvent,
  TaskStartResponse
} from "@shared/schemas/job";

export type PromptFileWriter = {
  cleanup: (absolutePath: string) => Promise<void>;
  write: (
    projectRootPath: string,
    body: string
  ) => Promise<{ absolutePath: string; relativePath: string }>;
};

const PROMPT_TEMP_RELATIVE_DIR = path.posix.join(".ai-factory", ".tmp");

export const createPromptFileWriter = (): PromptFileWriter => ({
  cleanup: async (absolutePath) => {
    await unlink(absolutePath).catch(() => undefined);
  },
  write: async (projectRootPath, body) => {
    const dir = path.join(projectRootPath, ".ai-factory", ".tmp");
    await mkdir(dir, { recursive: true });
    const fileName = `prompt-${randomUUID()}.md`;
    const absolutePath = path.join(dir, fileName);
    await writeFile(absolutePath, body, "utf8");
    return {
      absolutePath,
      relativePath: path.posix.join(PROMPT_TEMP_RELATIVE_DIR, fileName)
    };
  }
});

const createFilePromptArgument = (relativePath: string): string =>
  `Read the file at "${relativePath}" (relative to the current working directory) in full ` +
  "before responding — if it is long, keep reading with increasing offsets until you reach " +
  "the end of the file. Follow the instructions in it exactly and respond with only the " +
  "output format it specifies, no extra commentary.";

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
): { args: string[]; command: string; input: string; tempFilePath?: string } => ({
  args: [
    "-e",
    [
      "const fs = require('node:fs');",
      "const input = fs.readFileSync(0, 'utf8');",
      "process.stdout.write(`ForgePilot echo fixture for provider: ${process.argv[1]}\\n`);",
      "process.stdout.write(`Model: ${process.argv[2] || 'none'}\\n`);",
      "process.stdout.write(input);"
    ].join(" "),
    request.providerId,
    request.model ?? ""
  ],
  command: process.execPath,
  input: request.instructions.body
});

const createProviderCommand = async (
  request: TaskExecutionRequest,
  runner: CommandRunner,
  promptFileWriter: PromptFileWriter
): Promise<{ args: string[]; command: string; input?: string; tempFilePath?: string }> => {
  const commandName = request.providerId === "claude-code" ? "claude" : "codex";
  const executablePath = await runner.findExecutable(commandName);

  if (!executablePath) {
    throw new Error(`${commandName} was not found on PATH.`);
  }

  const { absolutePath, relativePath } = await promptFileWriter.write(
    request.projectRootPath,
    request.instructions.body
  );
  const promptArg = createFilePromptArgument(relativePath);
  const modelArgs = request.model ? ["--model", request.model] : [];

  if (request.providerId === "claude-code") {
    return {
      args: ["-p", "--permission-mode", "plan", ...modelArgs, promptArg],
      command: executablePath,
      tempFilePath: absolutePath
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
      ...modelArgs,
      promptArg
    ],
    command: executablePath,
    tempFilePath: absolutePath
  };
};

export const createTaskExecutionService = (
  options: {
    processManager?: ProcessManager;
    promptFileWriter?: PromptFileWriter;
    providerRegistry?: ProviderRegistry;
    runner?: CommandRunner;
  } = {}
): TaskExecutionService => {
  const processManager = options.processManager ?? createProcessManager();
  const providerRegistry = options.providerRegistry ?? createProviderRegistry();
  const runner = options.runner ?? createCommandRunner();
  const promptFileWriter = options.promptFileWriter ?? createPromptFileWriter();
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
        : await createProviderCommand(request, runner, promptFileWriter);

    const managedProcess = await processManager.start({
      args: command.args,
      command: command.command,
      input: command.input,
      providerId: request.providerId,
      rootPath: request.projectRootPath,
      timeoutMs: request.timeoutMs
    });

    if (command.tempFilePath) {
      const tempFilePath = command.tempFilePath;
      managedProcess.onExit(() => {
        void promptFileWriter.cleanup(tempFilePath);
      });
    }

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
