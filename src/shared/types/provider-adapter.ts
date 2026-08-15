import type { TaskExecutionRequest } from "@shared/schemas/job";
import type {
  ProviderAuthStatus,
  ProviderId,
  ProviderStatus,
  ProviderVersionInfo
} from "@shared/schemas/provider";

export type TaskHandle = {
  id: string;
  processId: number | null;
  providerId: ProviderId;
};

export type Unsubscribe = () => void;

export type ProviderExecutionCommand = {
  args: string[];
  command: string;
  input: string;
};

export type ProviderAdapter = {
  readonly id: ProviderId;
  isInstalled(): Promise<boolean>;
  getVersion(): Promise<ProviderVersionInfo>;
  authenticate(): Promise<ProviderAuthStatus>;
  getStatus(): Promise<ProviderStatus>;
  createExecutionCommand(request: TaskExecutionRequest): Promise<ProviderExecutionCommand>;
  dispose(): Promise<void>;
};
