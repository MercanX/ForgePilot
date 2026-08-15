import { randomUUID } from "node:crypto";

import {
  stageExecutionNextRequestSchema,
  stageExecutionNextResponseSchema
} from "@shared/schemas/execution";

const project = {
  addedAt: new Date().toISOString(),
  id: randomUUID(),
  lastOpenedAt: null,
  name: "fixture",
  rootPath: process.cwd()
};

describe("stage execution protocol", () => {
  it("accepts a server-driven local directive with advertised operations", () => {
    const request = stageExecutionNextRequestSchema.parse({
      capabilities: ["stage-execution:directives-v1"],
      executionId: null,
      localOperations: ["startup.select-run"],
      newRun: false,
      previous: null,
      project,
      providerId: "claude-code",
      stageId: "any-cloud-stage"
    });

    expect(request.localOperations).toEqual(["startup.select-run"]);

    const response = stageExecutionNextResponseSchema.parse({
      directive: {
        id: randomUUID(),
        inputs: { newRun: false },
        kind: "local",
        messageCompleted: "done",
        messageStarted: "start",
        operation: "startup.select-run",
        progressCompleted: 20,
        progressStarted: 10,
        saveAs: "selection"
      },
      executionId: randomUUID(),
      stageId: "any-cloud-stage"
    });

    expect(response.directive.kind).toBe("local");
  });
});
