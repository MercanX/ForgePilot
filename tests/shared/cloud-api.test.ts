import {
  DESKTOP_PROTOCOL_VERSION,
  SUPPORTED_CAPABILITIES
} from "@shared/constants/protocolVersion";
import {
  handshakeRequestSchema,
  requestJobRequestSchema,
  submitResultResponseSchema,
  workflowResponseSchema
} from "@shared/schemas/cloud-api";

import {
  findingFixture,
  jobFixture,
  projectFixture,
  taskResultFixture,
  workflowStageFixture
} from "./fixtures";

describe("cloud api schemas", () => {
  it("validates version negotiation payloads", () => {
    expect(() =>
      handshakeRequestSchema.parse({
        desktopVersion: "0.1.0",
        protocolVersion: DESKTOP_PROTOCOL_VERSION,
        supportedCapabilities: [...SUPPORTED_CAPABILITIES]
      })
    ).not.toThrow();
  });

  it("rejects unsupported capabilities", () => {
    expect(() =>
      handshakeRequestSchema.parse({
        desktopVersion: "0.1.0",
        protocolVersion: DESKTOP_PROTOCOL_VERSION,
        supportedCapabilities: ["unknown"]
      })
    ).toThrow();
  });

  it("validates request job payloads", () => {
    expect(() =>
      requestJobRequestSchema.parse({
        project: projectFixture,
        providerId: jobFixture.providerId,
        capabilities: ["provider:claude-code"]
      })
    ).not.toThrow();
  });

  it("validates server-driven workflow responses", () => {
    expect(
      workflowResponseSchema.parse({
        workflowId: "software-factory-v1",
        workflowVersion: "1.0.0",
        stages: [workflowStageFixture]
      })
    ).toEqual({
      workflowId: "software-factory-v1",
      workflowVersion: "1.0.0",
      stages: [workflowStageFixture]
    });
  });

  it("validates submit result acknowledgements with findings", () => {
    expect(
      submitResultResponseSchema.parse({
        accepted: true,
        findings: [findingFixture]
      })
    ).toEqual({
      accepted: true,
      findings: [findingFixture]
    });
    expect(taskResultFixture.status).toBe("completed");
  });
});
