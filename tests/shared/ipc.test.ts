import {
  appPingRequestSchema,
  appPingResponseSchema,
  startupOpenInputFileRequestSchema
} from "@shared/schemas/ipc";

describe("ipc schemas", () => {
  it("validates the app ping response contract", () => {
    expect(() =>
      appPingResponseSchema.parse({
        ok: true,
        appName: "ForgePilot",
        version: "0.1.0",
        timestamp: new Date().toISOString()
      })
    ).not.toThrow();
  });

  it("rejects unexpected app ping request fields", () => {
    expect(() => appPingRequestSchema.parse({ unexpected: true })).toThrow();
  });

  it("only accepts known startup input files", () => {
    expect(() =>
      startupOpenInputFileRequestSchema.parse({
        fileName: "SCOPE.md",
        projectRootPath: "C:/Workspace/sample",
        runId: "sample-20260814-001"
      })
    ).not.toThrow();
    expect(() =>
      startupOpenInputFileRequestSchema.parse({
        fileName: "notes.md",
        projectRootPath: "C:/Workspace/sample",
        runId: "sample-20260814-001"
      })
    ).toThrow();
  });
});
