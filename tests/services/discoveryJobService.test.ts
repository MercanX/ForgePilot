import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runClassifyFilesJob, runScanProjectJob } from "@services/discovery/discoveryJobService";

type FileInventory = {
  files: Array<{ path: string; size: number; vcs_status: string }>;
  root: string;
  totals: { directories: number; files: number };
};

type FolderStructure = {
  directories: Array<{ included: boolean; path: string }>;
  exclusion_policy: {
    file_names: string[];
    follow_symlinks: boolean;
    root_directories: string[];
  };
  files: string[];
};

type ClassifiedFiles = {
  files: Array<{ format: string | null; kind: string; path: string; signals: string[] }>;
  unknown: string[];
};

type UnknownFiles = {
  files: Array<{ format: null; path: string; reason: string; signals: string[] }>;
};

const REPORTS_DIR = [".ai-factory", "020-Discovery", "reports"];

const readInventory = (tempRoot: string): Promise<FileInventory> =>
  readFile(path.join(tempRoot, ...REPORTS_DIR, "FILE_INVENTORY.json"), "utf8").then(
    (content) => JSON.parse(content) as FileInventory
  );

const readFolderStructure = (tempRoot: string): Promise<FolderStructure> =>
  readFile(path.join(tempRoot, ...REPORTS_DIR, "FOLDER_STRUCTURE.json"), "utf8").then(
    (content) => JSON.parse(content) as FolderStructure
  );

const readClassifiedFiles = (tempRoot: string): Promise<ClassifiedFiles> =>
  readFile(path.join(tempRoot, ...REPORTS_DIR, "CLASSIFIED_FILES.json"), "utf8").then(
    (content) => JSON.parse(content) as ClassifiedFiles
  );

const readUnknownFiles = (tempRoot: string): Promise<UnknownFiles> =>
  readFile(path.join(tempRoot, ...REPORTS_DIR, "UNKNOWN_FILES.json"), "utf8").then(
    (content) => JSON.parse(content) as UnknownFiles
  );

const findFile = (
  classified: ClassifiedFiles,
  filePath: string
): ClassifiedFiles["files"][number] | undefined =>
  classified.files.find((file) => file.path === filePath);

describe("discoveryJobService", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "forgepilot-discovery-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { force: true, recursive: true });
  });

  describe("runScanProjectJob (RULE-D01)", () => {
    it("scans included files/directories and excludes root-level excluded trees", async () => {
      await mkdir(path.join(tempRoot, "src"), { recursive: true });
      await mkdir(path.join(tempRoot, "node_modules", "pkg"), { recursive: true });
      await mkdir(path.join(tempRoot, ".git"), { recursive: true });
      await mkdir(path.join(tempRoot, "empty-dir"), { recursive: true });
      await writeFile(path.join(tempRoot, "README.md"), "# Project\n", "utf8");
      await writeFile(path.join(tempRoot, "src", "app.ts"), "export {};\n", "utf8");
      await writeFile(path.join(tempRoot, "node_modules", "pkg", "index.js"), "1", "utf8");
      await writeFile(path.join(tempRoot, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
      await writeFile(path.join(tempRoot, "RUN_ENV.json"), "{}", "utf8");
      await writeFile(path.join(tempRoot, "src", "RUN_ENV.json"), "{}", "utf8");

      await runScanProjectJob(tempRoot);
      const inventory = await readInventory(tempRoot);
      const folder = await readFolderStructure(tempRoot);

      const paths = inventory.files.map((file) => file.path);
      expect(paths).toContain("README.md");
      expect(paths).toContain("src/app.ts");
      expect(paths).not.toContain("RUN_ENV.json");
      expect(paths).not.toContain("src/RUN_ENV.json");
      expect(paths.some((filePath) => filePath.startsWith("node_modules/"))).toBe(false);
      expect(paths.some((filePath) => filePath.startsWith(".git/"))).toBe(false);
      expect(inventory.totals.files).toBe(inventory.files.length);
      expect(inventory.totals.directories).toBe(folder.directories.length);
      expect(folder.directories.map((directory) => directory.path)).toContain("empty-dir");
      expect(folder.files.slice().sort()).toEqual(paths.slice().sort());
      expect(folder.exclusion_policy.root_directories.slice().sort()).toEqual(
        [".ai-factory", ".ai-factory-runs", ".claude", ".git", "node_modules", "vendor"].sort()
      );
      expect(folder.exclusion_policy.file_names).toEqual(["RUN_ENV.json"]);
      expect(folder.exclusion_policy.follow_symlinks).toBe(false);
    });

    it("marks vcs_status as unknown when the project is not a git repository", async () => {
      await writeFile(path.join(tempRoot, "a.txt"), "a", "utf8");

      await runScanProjectJob(tempRoot);
      const inventory = await readInventory(tempRoot);

      expect(inventory.files).toEqual([{ path: "a.txt", size: 1, vcs_status: "unknown" }]);
    });

    it("never follows or includes symbolic links", async () => {
      await writeFile(path.join(tempRoot, "real.txt"), "content", "utf8");

      try {
        await symlink(
          path.join(tempRoot, "real.txt"),
          path.join(tempRoot, "link.txt"),
          "file"
        );
      } catch {
        return;
      }

      await runScanProjectJob(tempRoot);
      const inventory = await readInventory(tempRoot);

      expect(inventory.files.map((file) => file.path)).toEqual(["real.txt"]);
    });

    it("does not exclude a nested directory that merely shares a name with a root exclusion", async () => {
      await mkdir(path.join(tempRoot, "packages", "vendor"), { recursive: true });
      await writeFile(path.join(tempRoot, "packages", "vendor", "keep.txt"), "keep", "utf8");

      await runScanProjectJob(tempRoot);
      const inventory = await readInventory(tempRoot);

      expect(inventory.files.map((file) => file.path)).toContain("packages/vendor/keep.txt");
    });
  });

  describe("runClassifyFilesJob (RULE-D02)", () => {
    const writeInventory = async (paths: string[]): Promise<void> => {
      const reportsDir = path.join(tempRoot, ...REPORTS_DIR);
      await mkdir(reportsDir, { recursive: true });
      await writeFile(
        path.join(reportsDir, "FILE_INVENTORY.json"),
        JSON.stringify({
          files: paths.map((filePath) => ({ path: filePath, size: 1, vcs_status: "unknown" })),
          root: ".",
          totals: { directories: 0, files: paths.length }
        }),
        "utf8"
      );
    };

    it("classifies manifest precedence fixtures ahead of generic extension rules", async () => {
      await writeInventory([
        "requirements.txt",
        "package-lock.json",
        "composer.lock",
        "Cargo.lock",
        "poetry.lock",
        "yarn.lock",
        "pom.xml"
      ]);

      await runClassifyFilesJob(tempRoot);
      const classified = await readClassifiedFiles(tempRoot);

      expect(findFile(classified, "requirements.txt")).toMatchObject({
        format: "plain_text",
        kind: "manifest"
      });
      expect(findFile(classified, "package-lock.json")).toMatchObject({
        format: "json",
        kind: "manifest"
      });
      expect(findFile(classified, "composer.lock")).toMatchObject({
        format: "json",
        kind: "manifest"
      });
      expect(findFile(classified, "Cargo.lock")).toMatchObject({ format: "toml", kind: "manifest" });
      expect(findFile(classified, "poetry.lock")).toMatchObject({ format: "toml", kind: "manifest" });
      expect(findFile(classified, "yarn.lock")).toMatchObject({
        format: "plain_text",
        kind: "manifest"
      });
      expect(findFile(classified, "pom.xml")).toMatchObject({ format: "xml", kind: "manifest" });
    });

    it("classifies standard-document fixtures with exact extensionless matching", async () => {
      await writeInventory(["README", "LICENSE", "README.md", "LICENSE.json"]);

      await runClassifyFilesJob(tempRoot);
      const classified = await readClassifiedFiles(tempRoot);

      expect(findFile(classified, "README")).toMatchObject({
        format: "plain_text",
        kind: "documentation"
      });
      expect(findFile(classified, "LICENSE")).toMatchObject({
        format: "plain_text",
        kind: "documentation"
      });
      expect(findFile(classified, "README.md")).toMatchObject({
        format: "markdown",
        kind: "documentation"
      });
      expect(findFile(classified, "LICENSE.json")).toMatchObject({
        format: "json",
        kind: "configuration"
      });
    });

    it("never assigns an architectural role to source files", async () => {
      await writeInventory(["src/app.ts", "src/App.jsx", "api/server.go"]);

      await runClassifyFilesJob(tempRoot);
      const classified = await readClassifiedFiles(tempRoot);

      for (const file of classified.files) {
        expect(file.kind).toBe("source");
      }
    });

    it("applies the signal tokenizer without substring false positives", async () => {
      await writeInventory([
        "user.test.ts",
        "contest.ts",
        "orderMigration.ts",
        "migration2.py",
        "immigration.ts",
        "userSeeder.php",
        "seed2Data.py",
        "proceed.ts"
      ]);

      await runClassifyFilesJob(tempRoot);
      const classified = await readClassifiedFiles(tempRoot);

      expect(findFile(classified, "user.test.ts")?.signals).toContain("test");
      expect(findFile(classified, "contest.ts")?.signals).not.toContain("test");
      expect(findFile(classified, "orderMigration.ts")?.signals).toContain("migration");
      expect(findFile(classified, "migration2.py")?.signals).toContain("migration");
      expect(findFile(classified, "immigration.ts")?.signals).not.toContain("migration");
      expect(findFile(classified, "userSeeder.php")?.signals).toContain("seed");
      expect(findFile(classified, "seed2Data.py")?.signals).toContain("seed");
      expect(findFile(classified, "proceed.ts")?.signals).not.toContain("seed");
    });

    it("detects infrastructure signals from filenames, extensions, and path segments", async () => {
      await writeInventory([
        "Dockerfile",
        "docker-compose.yml",
        "terraform/main.tf",
        ".github/workflows/ci.yml"
      ]);

      await runClassifyFilesJob(tempRoot);
      const classified = await readClassifiedFiles(tempRoot);

      expect(findFile(classified, "Dockerfile")).toMatchObject({
        format: "dockerfile",
        kind: "configuration",
        signals: ["infrastructure"]
      });
      expect(findFile(classified, "docker-compose.yml")).toMatchObject({
        format: "yaml",
        kind: "configuration",
        signals: ["infrastructure"]
      });
      expect(findFile(classified, "terraform/main.tf")).toMatchObject({
        format: "hcl",
        kind: "configuration",
        signals: ["infrastructure"]
      });
      expect(findFile(classified, ".github/workflows/ci.yml")?.signals).toContain("infrastructure");
    });

    it("writes deduplicated signals in the fixed order test, migration, seed, infrastructure", async () => {
      await writeInventory(["migrations/test.seed.tf"]);

      await runClassifyFilesJob(tempRoot);
      const classified = await readClassifiedFiles(tempRoot);

      expect(findFile(classified, "migrations/test.seed.tf")?.signals).toEqual([
        "test",
        "migration",
        "seed",
        "infrastructure"
      ]);
    });

    it("derives unknown[] from files with kind unknown and keeps UNKNOWN_FILES.json in sync", async () => {
      await writeInventory(["notes.xyz", "README.md"]);

      const result = await runClassifyFilesJob(tempRoot);
      const classified = await readClassifiedFiles(tempRoot);
      const unknownFiles = await readUnknownFiles(tempRoot);

      expect(classified.unknown).toEqual(["notes.xyz"]);
      expect(unknownFiles.files.map((file) => file.path)).toEqual(["notes.xyz"]);
      expect(unknownFiles.files[0]).toMatchObject({
        format: null,
        reason: "no deterministic kind rule matched"
      });
      expect(result.unknown_count).toBe(1);
      expect(result.file_count).toBe(2);
    });

    it("writes an empty UNKNOWN_FILES.json when nothing is unknown", async () => {
      await writeInventory(["README.md"]);

      await runClassifyFilesJob(tempRoot);
      const unknownFiles = await readUnknownFiles(tempRoot);

      expect(unknownFiles.files).toEqual([]);
    });

    it("classifies every inventory path exactly once with a matching path set", async () => {
      await writeInventory(["a.md", "b/c.ts", "d.unknownext"]);

      await runClassifyFilesJob(tempRoot);
      const classified = await readClassifiedFiles(tempRoot);

      expect(classified.files.map((file) => file.path).sort()).toEqual(
        ["a.md", "b/c.ts", "d.unknownext"].sort()
      );
    });
  });
});
