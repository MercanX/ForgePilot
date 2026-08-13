import { createCommandRunner, type CommandRunner } from "@main/process/commandRunner";
import { PROVIDER_DETECTION_TIMEOUT_MS } from "@shared/constants/timeouts";
import type { ProviderExitInfo, ProviderOutputChunk, Task } from "@shared/schemas/job";
import type {
  ProviderAuthStatus,
  ProviderDetectionResult,
  ProviderId,
  ProviderStatus,
  ProviderVersionInfo
} from "@shared/schemas/provider";
import type { ProviderAdapter, TaskHandle, Unsubscribe } from "@shared/types/provider-adapter";

type CliProviderAdapterOptions = {
  command: string;
  id: ProviderId;
  label: string;
  versionArgs: string[];
  runner?: CommandRunner;
};

export class CliProviderAdapter implements ProviderAdapter {
  public readonly id: ProviderId;

  private readonly command: string;
  private readonly label: string;
  private readonly runner: CommandRunner;
  private readonly versionArgs: string[];

  public constructor(options: CliProviderAdapterOptions) {
    this.command = options.command;
    this.id = options.id;
    this.label = options.label;
    this.runner = options.runner ?? createCommandRunner();
    this.versionArgs = options.versionArgs;
  }

  public async detect(): Promise<ProviderDetectionResult> {
    try {
      const installed = await this.isInstalled();

      if (!installed) {
        return {
          errorMessage: null,
          id: this.id,
          installed: false,
          label: this.label,
          status: "not-installed",
          version: null
        };
      }

      const version = await this.getVersion();
      const authStatus = await this.authenticate();

      return {
        errorMessage: null,
        id: this.id,
        installed: true,
        label: this.label,
        status: this.statusFromAuth(authStatus),
        version
      };
    } catch (error) {
      return {
        errorMessage: error instanceof Error ? error.message : "Provider detection failed.",
        id: this.id,
        installed: false,
        label: this.label,
        status: "error",
        version: null
      };
    }
  }

  public async isInstalled(): Promise<boolean> {
    return (await this.runner.findExecutable(this.command)) !== null;
  }

  public async getVersion(): Promise<ProviderVersionInfo> {
    const executablePath = await this.runner.findExecutable(this.command);

    if (!executablePath) {
      return {
        providerId: this.id,
        rawOutput: null,
        version: null
      };
    }

    const result = await this.runner.run(
      executablePath,
      this.versionArgs,
      PROVIDER_DETECTION_TIMEOUT_MS
    );
    const rawOutput = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();

    return {
      providerId: this.id,
      rawOutput: rawOutput || null,
      version: this.extractVersion(rawOutput)
    };
  }

  public async authenticate(): Promise<ProviderAuthStatus> {
    return (await this.isInstalled()) ? "unknown" : "unauthenticated";
  }

  public async getStatus(): Promise<ProviderStatus> {
    return this.statusFromAuth(await this.authenticate());
  }

  public startTask(task: Task): Promise<TaskHandle> {
    void task;
    return Promise.reject(new Error("Provider task execution is implemented in Phase 5."));
  }

  public sendInput(handle: TaskHandle, input: string): void {
    void handle;
    void input;
    throw new Error("Provider task execution is implemented in Phase 5.");
  }

  public stopTask(handle: TaskHandle): Promise<void> {
    void handle;
    return Promise.reject(new Error("Provider task execution is implemented in Phase 5."));
  }

  public killProcess(handle: TaskHandle): void {
    void handle;
    throw new Error("Provider task execution is implemented in Phase 5.");
  }

  public readOutput(handle: TaskHandle): AsyncIterable<ProviderOutputChunk> {
    void handle;
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.reject(new Error("Provider task execution is implemented in Phase 5."))
      })
    };
  }

  public onOutput(callback: (chunk: ProviderOutputChunk) => void): Unsubscribe {
    void callback;
    return () => undefined;
  }

  public onExit(callback: (exitInfo: ProviderExitInfo) => void): Unsubscribe {
    void callback;
    return () => undefined;
  }

  public async dispose(): Promise<void> {
    await Promise.resolve();
  }

  private extractVersion(rawOutput: string): string | null {
    const match = rawOutput.match(/\d+(?:\.\d+){1,3}(?:[-+][\w.-]+)?/);
    return match?.[0] ?? (rawOutput.trim() || null);
  }

  private statusFromAuth(authStatus: ProviderAuthStatus): ProviderStatus {
    if (authStatus === "authenticated") {
      return "authenticated";
    }

    if (authStatus === "error") {
      return "error";
    }

    return "installed";
  }
}
