import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const collectSourceFiles = (directory: string): string[] => {
  return readdirSync(directory).flatMap((entry) => {
    const entryPath = join(directory, entry);
    const stat = statSync(entryPath);

    if (stat.isDirectory()) {
      return collectSourceFiles(entryPath);
    }

    return entryPath.endsWith(".ts") ? [entryPath] : [];
  });
};

describe("shared import boundary", () => {
  it("does not import main, renderer or services modules", () => {
    const sharedFiles = collectSourceFiles(join(process.cwd(), "src", "shared"));

    for (const filePath of sharedFiles) {
      const source = readFileSync(filePath, "utf8");

      expect(source).not.toMatch(/from ["']@(main|renderer|services)\//);
    }
  });
});
