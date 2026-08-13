export type EnvironmentCheckResult = {
  id: string;
  label: string;
  status: "pending" | "ok" | "warning" | "error";
};

export const getInitialEnvironmentChecks = (): EnvironmentCheckResult[] => [
  {
    id: "internet",
    label: "Internet",
    status: "pending"
  },
  {
    id: "git",
    label: "Git",
    status: "pending"
  },
  {
    id: "providers",
    label: "Providers",
    status: "pending"
  }
];
