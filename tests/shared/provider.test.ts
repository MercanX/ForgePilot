import { providerDetectionResultSchema, providerIdSchema } from "@shared/schemas/provider";

describe("provider schemas", () => {
  it("accepts supported provider ids", () => {
    expect(providerIdSchema.parse("claude-code")).toBe("claude-code");
    expect(providerIdSchema.parse("codex")).toBe("codex");
  });

  it("rejects unknown provider ids", () => {
    expect(() => providerIdSchema.parse("unknown-provider")).toThrow();
  });

  it("validates provider detection results", () => {
    expect(() =>
      providerDetectionResultSchema.parse({
        id: "codex",
        label: "Codex",
        installed: false,
        status: "not-installed",
        version: null,
        errorMessage: null
      })
    ).not.toThrow();
  });
});
