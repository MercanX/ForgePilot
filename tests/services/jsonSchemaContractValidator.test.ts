import { validateJsonSchemaContract } from "@services/jobs/jsonSchemaContractValidator";

describe("validateJsonSchemaContract", () => {
  it("accepts output that matches the cloud-provided JSON Schema", () => {
    const result = validateJsonSchemaContract(
      {
        include: [{ confidence: "high", path: "src", reason: "source" }],
        summary: "Scope proposal"
      },
      {
        additionalProperties: false,
        properties: {
          include: {
            items: {
              additionalProperties: false,
              properties: {
                confidence: { enum: ["high", "medium", "low"], type: "string" },
                path: { type: "string" },
                reason: { type: "string" }
              },
              required: ["confidence", "path", "reason"],
              type: "object"
            },
            type: "array"
          },
          summary: { type: "string" }
        },
        required: ["include", "summary"],
        type: "object"
      }
    );

    expect(result).toEqual({ errors: [], valid: true });
  });

  it("rejects missing required fields and extra properties", () => {
    const result = validateJsonSchemaContract(
      { extra: true },
      {
        additionalProperties: false,
        properties: { summary: { type: "string" } },
        required: ["summary"],
        type: "object"
      }
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("$.summary is required.");
    expect(result.errors).toContain("$.extra is not allowed.");
  });
});
