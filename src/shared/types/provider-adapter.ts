import type { ProviderExitInfo, ProviderOutputChunk, Task } from "@shared/schemas/job";
import type {
  ProviderAuthStatus,
  ProviderId,
  ProviderStatus,
  ProviderVersionInfo
} from "@shared/schemas/provider";

export type TaskHandle = {
  id: string;
  providerId: ProviderId;
  processId: number | null;
};

export type Unsubscribe = () => void;

export type ProviderAdapter = {
  readonly id: ProviderId;
  isInstalled(): Promise<boolean>;
  getVersion(): Promise<ProviderVersionInfo>;
  authenticate(): Promise<ProviderAuthStatus>;
  getStatus(): Promise<ProviderStatus>;
  startTask(task: Task): Promise<TaskHandle>;
  sendInput(handle: TaskHandle, input: string): void;
  stopTask(handle: TaskHandle): Promise<void>;
  killProcess(handle: TaskHandle): void;
  readOutput(handle: TaskHandle): AsyncIterable<ProviderOutputChunk>;
  onOutput(callback: (chunk: ProviderOutputChunk) => void): Unsubscribe;
  onExit(callback: (exitInfo: ProviderExitInfo) => void): Unsubscribe;
  dispose(): Promise<void>;
};
