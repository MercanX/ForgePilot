import { createCommandRunner, type CommandRunner } from "@main/process/commandRunner";
import { PROVIDER_DETECTION_TIMEOUT_MS } from "@shared/constants/timeouts";
import type { TaskExecutionRequest } from "@shared/schemas/job";
import type {
  ProviderAuthStatus,
  ProviderDetectionResult,
  ProviderId,
  ProviderStatus,
  ProviderVersionInfo
} from "@shared/schemas/provider";
import type { ProviderAdapter, ProviderExecutionCommand } from "@shared/types/provider-adapter";

type CliProviderAdapterOptions = {
  buildExecutionArgs: (request: TaskExecutionRequest) => string[];
  command: string;
  id: ProviderId;
  label: string;
  runner?: CommandRunner;
  versionArgs: string[];
};

export class CliProviderAdapter implements ProviderAdapter {
  public readonly id: ProviderId;

  private readonly buildExecutionArgs: (request: TaskExecutionRequest) => string[];
  private readonly command: string;
  private readonly label: string;
  private readonly runner: CommandRunner;
  private readonly versionArgs: string[];

  public constructor(options: CliProviderAdapterOptions) {
    this.buildExecutionArgs = options.buildExecutionArgs;
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

  public async createExecutionCommand(
    request: TaskExecutionRequest
  ): Promise<ProviderExecutionCommand> {
    const executablePath = await this.runner.findExecutable(this.command);

    if (!executablePath) {
      throw new Error(`${this.command} was not found on PATH.`);
    }

    return {
      args: this.buildExecutionArgs(request),
      command: executablePath,
      input: request.instructions.body
    };
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
