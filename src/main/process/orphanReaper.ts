export type OrphanReaperResult = {
  inspected: number;
  terminated: number;
};

export const reapOrphanedProviderProcesses = (): Promise<OrphanReaperResult> => {
  return Promise.resolve({
    inspected: 0,
    terminated: 0
  });
};
