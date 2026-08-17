import { describe, expect, it } from "vitest";

import { parseAuthorizedDiscoveryStageEnvelope } from "../src/services/discovery/discoverySubstageService";

describe("Discovery D05/D10 provider envelope", () => {
  const expected = {
    auditId: "AUD-001",
    label: "D05" as const,
    substage: "D05-Project-Overview",
    workspaceHash: "c".repeat(64)
  };

  const validEnvelope = () => ({
    audit_id: "AUD-001",
    completed_at: "2026-08-17T08:50:00.000Z",
    result: {
      substage: "D05-Project-Overview",
      result: "PASS",
      summary: "fixture",
      checklist: []
    },
    schema_version: "1.0",
    substage: "D05-Project-Overview",
    workspace_hash: "c".repeat(64)
  });

  it("accepts the full envelope and exposes the inner result without double wrapping", () => {
    const parsed = parseAuthorizedDiscoveryStageEnvelope(validEnvelope(), expected);

    expect(parsed.result.summary).toBe("fixture");
    expect(parsed.stageDocument.result).toBe(parsed.result);
    expect((parsed.stageDocument.result as Record<string, unknown>).audit_id).toBeUndefined();
  });

  it("rejects the legacy flat stage payload", () => {
    expect(() =>
      parseAuthorizedDiscoveryStageEnvelope(
        {
          substage: "D05-Project-Overview",
          result: "PASS",
          summary: "legacy",
          checklist: []
        },
        expected
      )
    ).toThrow();
  });

  it("rejects provider metadata that disagrees with local Startup/audit authority", () => {
    const payload = validEnvelope();
    payload.workspace_hash = "d".repeat(64);

    expect(() => parseAuthorizedDiscoveryStageEnvelope(payload, expected)).toThrow(/workspace_hash/);
  });

  it("requires both root and inner substage to match", () => {
    const payload = validEnvelope();
    payload.result.substage = "D10-Architecture";

    expect(() => parseAuthorizedDiscoveryStageEnvelope(payload, expected)).toThrow(/result\.result has unexpected substage/);
  });
});
