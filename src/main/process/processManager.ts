import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import { assertPathInsideRoot, resolveDirectoryRealPath } from "@main/filesystem/pathGuard";
import type { ProviderExitInfo, ProviderOutputChunk } from "@shared/schemas/job";
import type { ProviderId } from "@shared/schemas/provider";
import type { TaskHandle, Unsubscribe } from "@shared/types/provider-adapter";

type ManagedProcessEvents = {
  exit: [ProviderExitInfo];
  output: [ProviderOutputChunk];
};

type ManagedProcessEmitter = EventEmitter<ManagedProcessEvents>;

export type ProcessStartOptions = {
  args: string[];
  command: string;
  input?: string;
  providerId: ProviderId;
  rootPath: string;
  timeoutMs: number;
};

export type ManagedProcess = {
  handle: TaskHandle;
  kill: () => void;
  onExit: (callback: (exitInfo: ProviderExitInfo) => void) => Unsubscribe;
  onOutput: (callback: (chunk: ProviderOutputChunk) => void) => Unsubscribe;
  stop: () => void;
};

export type ProcessManager = {
  dispose: () => void;
  get: (taskId: string) => ManagedProcess | null;
  start: (options: ProcessStartOptions) => Promise<ManagedProcess>;
  stop: (taskId: string) => boolean;
};

const ENV_ALLOWLIST = [
  "APPDATA",
  "COMSPEC",
  "HOME",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "WINDIR"
] as const;

const createChildEnvironment = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};

  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];

    if (value) {
      env[key] = value;
    }
  }

  return env;
};

export const createProcessManager = (): ProcessManager => {
  const processes = new Map<string, ManagedProcess>();

  const start = async (options: ProcessStartOptions): Promise<ManagedProcess> => {
    const rootPath = await resolveDirectoryRealPath(options.rootPath);
    const cwd = assertPathInsideRoot(rootPath, rootPath);
    const emitter: ManagedProcessEmitter = new EventEmitter();
    const child = spawn(options.command, options.args, {
      cwd,
      env: createChildEnvironment(),
      shell: false,
      windowsHide: true
    });
    const handle: TaskHandle = {
      id: randomUUID(),
      processId: child.pid ?? null,
      providerId: options.providerId
    };
    let finished = false;
    let finalExitInfo: ProviderExitInfo | null = null;
    const outputHistory: ProviderOutputChunk[] = [];

    const emitOutput = (stream: ProviderOutputChunk["stream"], text: string): void => {
      if (!text) {
        return;
      }

      const chunk: ProviderOutputChunk = {
        stream,
        text,
        timestamp: new Date().toISOString()
      };
      outputHistory.push(chunk);
      emitter.emit("output", chunk);
    };

    const finish = (exitCode: number | null, signal: string | null): void => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeout);
      const exitInfo: ProviderExitInfo = {
        exitCode,
        finishedAt: new Date().toISOString(),
        signal
      };
      finalExitInfo = exitInfo;
      emitter.emit("exit", exitInfo);
      processes.delete(handle.id);
    };

    const timeout = setTimeout(() => {
      child.kill();
      finish(null, "timeout");
    }, options.timeoutMs);

    child.stdout.on("data", (data: Buffer) => emitOutput("stdout", data.toString("utf8")));
    child.stderr.on("data", (data: Buffer) => emitOutput("stderr", data.toString("utf8")));
    child.on("error", (error: Error) => {
      emitOutput("stderr", error.message);
      finish(null, "error");
    });
    child.on("exit", (exitCode: number | null, signal: NodeJS.Signals | null) => {
      finish(exitCode, signal);
    });

    const managedProcess: ManagedProcess = {
      handle,
      kill: () => child.kill("SIGKILL"),
      onExit: (callback) => {
        if (finalExitInfo) {
          callback(finalExitInfo);
          return () => undefined;
        }
        emitter.on("exit", callback);
        return () => emitter.off("exit", callback);
      },
      onOutput: (callback) => {
        for (const chunk of outputHistory) {
          callback(chunk);
        }
        emitter.on("output", callback);
        return () => emitter.off("output", callback);
      },
      stop: () => child.kill()
    };

    processes.set(handle.id, managedProcess);
    setImmediate(() => {
      if (options.input) {
        child.stdin.write(options.input);
      }
      child.stdin.end();
    });
    return managedProcess;
  };

  const stop = (taskId: string): boolean => {
    const process = processes.get(taskId);

    if (!process) {
      return false;
    }

    process.stop();
    return true;
  };

  const dispose = (): void => {
    for (const process of processes.values()) {
      process.kill();
    }
    processes.clear();
  };

  return {
    dispose,
    get: (taskId) => processes.get(taskId) ?? null,
    start,
    stop
  };
};
