import { createLocalOperationRegistry } from "@services/jobs/localOperationRegistry";

describe("local operation registry", () => {
  it("executes operations by capability name rather than stage branching", async () => {
    const registry = createLocalOperationRegistry({
      "fixture.echo": async (_root, inputs) => ({ value: inputs.value })
    });

    await expect(registry.execute("fixture.echo", process.cwd(), { value: 42 })).resolves.toEqual({
      value: 42
    });
  });

  it("rejects operations the desktop did not advertise", async () => {
    const registry = createLocalOperationRegistry();
    await expect(registry.execute("unknown.operation", process.cwd())).rejects.toThrow(
      "Unsupported local operation"
    );
  });
});
