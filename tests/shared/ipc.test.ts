import { appPingResponseSchema } from "@shared/schemas/ipc";

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
});
