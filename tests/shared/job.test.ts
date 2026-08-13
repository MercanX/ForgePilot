import { taskResultSchema, taskSchema } from "@shared/schemas/job";

import { taskFixture, taskResultFixture } from "./fixtures";

describe("job schemas", () => {
  it("accepts task instructions as opaque client payload", () => {
    expect(taskSchema.parse(taskFixture)).toEqual(taskFixture);
  });

  it("rejects empty task instruction bodies", () => {
    expect(() =>
      taskSchema.parse({
        ...taskFixture,
        instructions: {
          ...taskFixture.instructions,
          body: ""
        }
      })
    ).toThrow();
  });

  it("validates task results with normalized output chunks", () => {
    expect(taskResultSchema.parse(taskResultFixture)).toEqual(taskResultFixture);
  });
});
