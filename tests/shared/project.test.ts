import { projectSchema } from "@shared/schemas/project";

import { projectFixture } from "./fixtures";

describe("project schema", () => {
  it("accepts an absolute project root", () => {
    expect(projectSchema.parse(projectFixture)).toEqual(projectFixture);
  });

  it("rejects relative project roots", () => {
    expect(() => projectSchema.parse({ ...projectFixture, rootPath: "..\\ForgePilot" })).toThrow();
  });
});
