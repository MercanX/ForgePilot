import { describe, expect, it } from "vitest";

import { validateOutputContract } from "../src/services/jobs/stageExecutionService";

describe("local JSON Schema enforcement", () => {
  const schema = {
    type: "object",
    properties: {
      completed_at: { type: "string", format: "date-time" },
      schema_version: { type: "string", const: "1.0" },
      substage: { type: "string", const: "D05-Project-Overview" }
    },
    required: ["completed_at", "schema_version", "substage"],
    additionalProperties: false
  };

  it("accepts const values and ISO date-time values", () => {
    expect(
      validateOutputContract(
        {
          completed_at: "2026-08-17T08:50:00.000Z",
          schema_version: "1.0",
          substage: "D05-Project-Overview"
        },
        schema
      )
    ).toEqual([]);
  });

  it("rejects a wrong const", () => {
    const errors = validateOutputContract(
      {
        completed_at: "2026-08-17T08:50:00.000Z",
        schema_version: "2.0",
        substage: "D05-Project-Overview"
      },
      schema
    );

    expect(errors.some((error) => error.includes("required const"))).toBe(true);
  });

  it("rejects a date-time without timezone", () => {
    const errors = validateOutputContract(
      {
        completed_at: "2026-08-17 08:50:00",
        schema_version: "1.0",
        substage: "D05-Project-Overview"
      },
      schema
    );

    expect(errors.some((error) => error.includes("valid date-time"))).toBe(true);
  });
});
