import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  assertPathInsideRoot,
  isPathInsideRoot,
  resolveDirectoryRealPath
} from "@main/filesystem/pathGuard";

describe("pathGuard", () => {
  it("accepts paths inside the selected project root", () => {
    const rootPath = resolve("C:/Workspace/project");
    const childPath = join(rootPath, "src", "index.ts");

    expect(isPathInsideRoot(rootPath, childPath)).toBe(true);
    expect(assertPathInsideRoot(rootPath, childPath)).toBe(resolve(childPath));
  });

  it("rejects paths outside the selected project root", () => {
    const rootPath = resolve("C:/Workspace/project");
    const outsidePath = resolve("C:/Workspace/other/file.ts");

    expect(isPathInsideRoot(rootPath, outsidePath)).toBe(false);
    expect(() => assertPathInsideRoot(rootPath, outsidePath)).toThrow();
  });

  it("resolves only existing directories", async () => {
    const tempRoot = join(process.cwd(), "node_modules", ".tmp-path-guard");
    const projectRoot = join(tempRoot, "project");
    const filePath = join(tempRoot, "file.txt");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(filePath, "not a directory", "utf8");

    await expect(resolveDirectoryRealPath(projectRoot)).resolves.toBeTruthy();
    await expect(resolveDirectoryRealPath(filePath)).rejects.toThrow();
  });
});
