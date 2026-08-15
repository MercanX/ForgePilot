import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  finalizeIndexDocumentsJob,
  prepareIndexDocumentsJob,
  runClassifyFilesJob,
  runMapDependenciesJob,
  runScanProjectJob
} from "@services/discovery/discoveryJobService";

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

type ManifestEvidence = { field?: string; note: string; source: string };

type DependencyMap = {
  manifests: string[];
  packages: Array<{ evidence: ManifestEvidence; name: string; scopes: string[] }>;
  parsed_manifests: string[];
  unparsed_manifests: string[];
};

type TechnologyStack = {
  stack: Array<{ category: string; evidence: ManifestEvidence; name: string }>;
};

type ClassifiedFileFixture = {
  format: string | null;
  kind: string;
  path: string;
  signals?: string[];
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

const writeClassifiedFiles = async (
  tempRoot: string,
  files: ClassifiedFileFixture[]
): Promise<void> => {
  const reportsDir = path.join(tempRoot, ...REPORTS_DIR);
  await mkdir(reportsDir, { recursive: true });
  await writeFile(
    path.join(reportsDir, "CLASSIFIED_FILES.json"),
    JSON.stringify({
      files: files.map((file) => ({ ...file, signals: file.signals ?? [] })),
      metadata: {},
      unknown: []
    }),
    "utf8"
  );
};

const readDependencyMap = (tempRoot: string): Promise<DependencyMap> =>
  readFile(path.join(tempRoot, ...REPORTS_DIR, "DEPENDENCY_MAP.json"), "utf8").then(
    (content) => JSON.parse(content) as DependencyMap
  );

const readTechnologyStack = (tempRoot: string): Promise<TechnologyStack> =>
  readFile(path.join(tempRoot, ...REPORTS_DIR, "TECHNOLOGY_STACK.json"), "utf8").then(
    (content) => JSON.parse(content) as TechnologyStack
  );

type DocumentIndex = {
  documents: Array<{
    capabilities: { anchors: boolean; code_blocks: boolean; headings: boolean; links: boolean; tables: boolean };
    format: string;
    path: string;
  }>;
  standard_documents_inventory: Record<string, { paths: string[]; present: boolean }>;
};

type DocumentStructure = {
  documents: Array<{
    code_blocks: Array<{ language: string | null; line: number }>;
    headings: Array<{ anchor: string; level: number; line: number; text: string }>;
    path: string;
    tables: Array<{ columns: number; line: number }>;
  }>;
};

type DocumentReferences = {
  references: Array<{
    failure_kind: string | null;
    fragment: string | null;
    line: number;
    link_type: string;
    raw_target: string;
    resolved_path: string | null;
    source: string;
    status: string;
  }>;
};

type MissingDocuments = {
  missing: Array<{ referenced_from: string; resolved_path: string; target: string }>;
};

type DomainGlossary = {
  terms: Array<{ category: string; evidence: { excerpt: string; line: number; source: string }; term: string }>;
};

const readDocumentIndex = (tempRoot: string): Promise<DocumentIndex> =>
  readFile(path.join(tempRoot, ...REPORTS_DIR, "DOCUMENT_INDEX.json"), "utf8").then(
    (content) => JSON.parse(content) as DocumentIndex
  );

const readDocumentStructure = (tempRoot: string): Promise<DocumentStructure> =>
  readFile(path.join(tempRoot, ...REPORTS_DIR, "DOCUMENT_STRUCTURE.json"), "utf8").then(
    (content) => JSON.parse(content) as DocumentStructure
  );

const readDocumentReferences = (tempRoot: string): Promise<DocumentReferences> =>
  readFile(path.join(tempRoot, ...REPORTS_DIR, "DOCUMENT_REFERENCES.json"), "utf8").then(
    (content) => JSON.parse(content) as DocumentReferences
  );

const readMissingDocuments = (tempRoot: string): Promise<MissingDocuments> =>
  readFile(path.join(tempRoot, ...REPORTS_DIR, "MISSING_DOCUMENTS.json"), "utf8").then(
    (content) => JSON.parse(content) as MissingDocuments
  );

const readDomainGlossary = (tempRoot: string): Promise<DomainGlossary> =>
  readFile(path.join(tempRoot, ...REPORTS_DIR, "DOMAIN_GLOSSARY.json"), "utf8").then(
    (content) => JSON.parse(content) as DomainGlossary
  );

const runIndexDocumentsJob = async (
  tempRoot: string,
  candidates: Array<{ category: string; evidence: { line: number; source: string }; term: string }> = []
) => {
  const preparation = await prepareIndexDocumentsJob(tempRoot);
  return finalizeIndexDocumentsJob(tempRoot, preparation, candidates);
};

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

  describe("runMapDependenciesJob (RULE-D09)", () => {
    it("splits package.json dependencies/devDependencies into scopes and dedupes shared names", async () => {
      await writeClassifiedFiles(tempRoot, [
        { format: "json", kind: "manifest", path: "package.json" },
        { format: "typescript", kind: "source", path: "src/app.ts" }
      ]);
      await writeFile(
        path.join(tempRoot, "package.json"),
        JSON.stringify({
          dependencies: { react: "^19.0.0", zustand: "^5.0.0" },
          devDependencies: { typescript: "^5.0.0", zustand: "^5.0.0" }
        }),
        "utf8"
      );

      await runMapDependenciesJob(tempRoot);
      const map = await readDependencyMap(tempRoot);

      const react = map.packages.find((pkg) => pkg.name === "react");
      const zustand = map.packages.find((pkg) => pkg.name === "zustand");
      const typescriptPkg = map.packages.find((pkg) => pkg.name === "typescript");

      expect(react?.scopes).toEqual(["runtime"]);
      expect(typescriptPkg?.scopes).toEqual(["development"]);
      expect(zustand?.scopes).toEqual(["development", "runtime"]);
      expect(map.packages.filter((pkg) => pkg.name === "zustand")).toHaveLength(1);
    });

    it("prefers packageManager field over lockfile evidence for the package manager record", async () => {
      await writeClassifiedFiles(tempRoot, [
        { format: "json", kind: "manifest", path: "package.json" },
        { format: "yaml", kind: "manifest", path: "pnpm-lock.yaml" }
      ]);
      await writeFile(
        path.join(tempRoot, "package.json"),
        JSON.stringify({ packageManager: "pnpm@8.6.0" }),
        "utf8"
      );

      await runMapDependenciesJob(tempRoot);
      const stack = await readTechnologyStack(tempRoot);
      const packageManager = stack.stack.find((entry) => entry.category === "Package Manager");

      expect(packageManager).toMatchObject({ evidence: { field: "packageManager" }, name: "pnpm" });
    });

    it("falls back through the lockfile precedence chain when packageManager is absent", async () => {
      await writeClassifiedFiles(tempRoot, [
        { format: "json", kind: "manifest", path: "package.json" },
        { format: "plain_text", kind: "manifest", path: "yarn.lock" },
        { format: "json", kind: "manifest", path: "package-lock.json" }
      ]);
      await writeFile(path.join(tempRoot, "package.json"), "{}", "utf8");

      await runMapDependenciesJob(tempRoot);
      const stack = await readTechnologyStack(tempRoot);
      const packageManager = stack.stack.find((entry) => entry.category === "Package Manager");

      expect(packageManager).toMatchObject({ evidence: { source: "yarn.lock" }, name: "Yarn" });
    });

    it("only records the Node.js runtime when engines.node is explicitly present", async () => {
      await writeClassifiedFiles(tempRoot, [{ format: "json", kind: "manifest", path: "package.json" }]);
      await writeFile(path.join(tempRoot, "package.json"), JSON.stringify({}), "utf8");

      await runMapDependenciesJob(tempRoot);
      const stack = await readTechnologyStack(tempRoot);

      expect(stack.stack.some((entry) => entry.category === "Runtime")).toBe(false);
    });

    it("excludes php and ext-* keys from composer dependencies and gates Package Manager on composer.lock", async () => {
      await writeClassifiedFiles(tempRoot, [
        { format: "json", kind: "manifest", path: "composer.json" }
      ]);
      await writeFile(
        path.join(tempRoot, "composer.json"),
        JSON.stringify({
          require: { php: "^8.1", "ext-json": "*", "laravel/framework": "^10.0" },
          "require-dev": { "phpunit/phpunit": "^10.0" }
        }),
        "utf8"
      );

      await runMapDependenciesJob(tempRoot);
      const map = await readDependencyMap(tempRoot);
      const stack = await readTechnologyStack(tempRoot);

      expect(map.packages.map((pkg) => pkg.name).sort()).toEqual(["laravel/framework", "phpunit/phpunit"]);
      expect(stack.stack.some((entry) => entry.category === "Package Manager")).toBe(false);
    });

    it("maps pyproject.toml build-backend to a Build Backend record, never Package Manager", async () => {
      await writeClassifiedFiles(tempRoot, [
        { format: "toml", kind: "manifest", path: "pyproject.toml" }
      ]);
      await writeFile(
        path.join(tempRoot, "pyproject.toml"),
        '[build-system]\nbuild-backend = "poetry.core.masonry.api"\n',
        "utf8"
      );

      await runMapDependenciesJob(tempRoot);
      const stack = await readTechnologyStack(tempRoot);

      expect(stack.stack).toContainEqual(
        expect.objectContaining({ category: "Build Backend", name: "Poetry" })
      );
      expect(stack.stack.some((entry) => entry.category === "Package Manager")).toBe(false);
    });

    it("prefers [project].dependencies over [tool.poetry.dependencies] and excludes the python key", async () => {
      await writeClassifiedFiles(tempRoot, [
        { format: "toml", kind: "manifest", path: "pyproject.toml" }
      ]);
      await writeFile(
        path.join(tempRoot, "pyproject.toml"),
        [
          "[project]",
          'dependencies = ["requests>=2.0", "click"]',
          "",
          "[tool.poetry.dependencies]",
          'python = "^3.11"',
          'flask = "^2.0"'
        ].join("\n"),
        "utf8"
      );

      await runMapDependenciesJob(tempRoot);
      const map = await readDependencyMap(tempRoot);

      expect(map.packages.map((pkg) => pkg.name).sort()).toEqual(["click", "requests"]);
    });

    it("falls back to [tool.poetry.dependencies] and drops the python key when no [project].dependencies exist", async () => {
      await writeClassifiedFiles(tempRoot, [
        { format: "toml", kind: "manifest", path: "pyproject.toml" }
      ]);
      await writeFile(
        path.join(tempRoot, "pyproject.toml"),
        ["[tool.poetry.dependencies]", 'python = "^3.11"', 'flask = "^2.0"'].join("\n"),
        "utf8"
      );

      await runMapDependenciesJob(tempRoot);
      const map = await readDependencyMap(tempRoot);

      expect(map.packages.map((pkg) => pkg.name)).toEqual(["flask"]);
    });

    it("keeps nested/unsupported manifests in the inventory without parsing them as dependency sources", async () => {
      await writeClassifiedFiles(tempRoot, [
        { format: "json", kind: "manifest", path: "package.json" },
        { format: "json", kind: "manifest", path: "packages/app/package.json" },
        { format: "toml", kind: "manifest", path: "Cargo.toml" }
      ]);
      await writeFile(path.join(tempRoot, "package.json"), "{}", "utf8");

      await runMapDependenciesJob(tempRoot);
      const map = await readDependencyMap(tempRoot);

      expect(map.manifests.slice().sort()).toEqual(
        ["Cargo.toml", "package.json", "packages/app/package.json"].sort()
      );
      expect(map.parsed_manifests).toEqual(["package.json"]);
      expect(map.unparsed_manifests.slice().sort()).toEqual(
        ["Cargo.toml", "packages/app/package.json"].sort()
      );
    });

    it("only records a language when a matching source format is actually present", async () => {
      await writeClassifiedFiles(tempRoot, [
        { format: "json", kind: "manifest", path: "package.json" },
        { format: "json", kind: "configuration", path: "config.json" }
      ]);
      await writeFile(path.join(tempRoot, "package.json"), "{}", "utf8");

      await runMapDependenciesJob(tempRoot);
      const stack = await readTechnologyStack(tempRoot);

      expect(stack.stack.some((entry) => entry.category === "Language")).toBe(false);
    });

    it("orders the technology stack Language, then Runtime, then Package Manager, then Build Backend", async () => {
      await writeClassifiedFiles(tempRoot, [
        { format: "json", kind: "manifest", path: "package.json" },
        { format: "json", kind: "manifest", path: "package-lock.json" },
        { format: "typescript", kind: "source", path: "src/app.ts" }
      ]);
      await writeFile(
        path.join(tempRoot, "package.json"),
        JSON.stringify({ engines: { node: ">=18" } }),
        "utf8"
      );

      await runMapDependenciesJob(tempRoot);
      const stack = await readTechnologyStack(tempRoot);

      expect(stack.stack.map((entry) => entry.category)).toEqual([
        "Language",
        "Runtime",
        "Package Manager"
      ]);
    });

    it("fails when CLASSIFIED_FILES.json is missing", async () => {
      await expect(runMapDependenciesJob(tempRoot)).rejects.toThrow();
    });

    it("fails when a present root manifest cannot be parsed", async () => {
      await writeClassifiedFiles(tempRoot, [{ format: "json", kind: "manifest", path: "package.json" }]);
      await writeFile(path.join(tempRoot, "package.json"), "{ not valid json", "utf8");

      await expect(runMapDependenciesJob(tempRoot)).rejects.toThrow();
    });
  });

  describe("index_documents + finalize (RULE-D03)", () => {
    it("builds the standard documents inventory, root-only and case-insensitively, without ara-segment matches", async () => {
      await writeClassifiedFiles(tempRoot, [
        { format: "markdown", kind: "documentation", path: "README.md" },
        { format: "plain_text", kind: "documentation", path: "LICENSE" },
        { format: "markdown", kind: "documentation", path: "README.old.md" },
        { format: "markdown", kind: "documentation", path: "docs/nested/README.md" }
      ]);
      await writeFile(path.join(tempRoot, "README.md"), "# Title\n", "utf8");
      await writeFile(path.join(tempRoot, "LICENSE"), "MIT\n", "utf8");
      await writeFile(path.join(tempRoot, "README.old.md"), "old\n", "utf8");
      await mkdir(path.join(tempRoot, "docs", "nested"), { recursive: true });
      await writeFile(path.join(tempRoot, "docs", "nested", "README.md"), "nested\n", "utf8");

      await runIndexDocumentsJob(tempRoot);
      const index = await readDocumentIndex(tempRoot);

      expect(index.standard_documents_inventory.README).toEqual({ paths: ["README.md"], present: true });
      expect(index.standard_documents_inventory.LICENSE).toEqual({ paths: ["LICENSE"], present: true });
      expect(index.standard_documents_inventory.CHANGELOG).toEqual({ paths: [], present: false });
    });

    it("extracts markdown headings with deterministic anchors, code blocks, and tables", async () => {
      await writeClassifiedFiles(tempRoot, [{ format: "markdown", kind: "documentation", path: "guide.md" }]);
      await writeFile(
        path.join(tempRoot, "guide.md"),
        [
          "# Install",
          "",
          "```ts",
          "const x = 1;",
          "```",
          "",
          "| A | B |",
          "|---|---|",
          "| 1 | 2 |",
          "",
          "# Install"
        ].join("\n"),
        "utf8"
      );

      await runIndexDocumentsJob(tempRoot);
      const structure = await readDocumentStructure(tempRoot);
      const doc = structure.documents.find((entry) => entry.path === "guide.md");

      expect(doc?.headings).toEqual([
        { anchor: "install", level: 1, line: 1, text: "Install" },
        { anchor: "install-1", level: 1, line: 11, text: "Install" }
      ]);
      expect(doc?.code_blocks).toEqual([{ language: "ts", line: 3 }]);
      expect(doc?.tables).toEqual([{ columns: 2, line: 7 }]);
    });

    it("leaves structure arrays empty (capabilities false) for non-markdown formats without fabricating data", async () => {
      await writeClassifiedFiles(tempRoot, [{ format: "plain_text", kind: "documentation", path: "notes.txt" }]);
      await writeFile(path.join(tempRoot, "notes.txt"), "# not a heading\n", "utf8");

      await runIndexDocumentsJob(tempRoot);
      const index = await readDocumentIndex(tempRoot);
      const structure = await readDocumentStructure(tempRoot);
      const capabilities = index.documents.find((doc) => doc.path === "notes.txt")?.capabilities;
      const structureDoc = structure.documents.find((doc) => doc.path === "notes.txt");

      expect(capabilities).toEqual({
        anchors: false,
        code_blocks: false,
        headings: false,
        links: false,
        tables: false
      });
      expect(structureDoc?.headings).toEqual([]);
    });

    it("resolves relative link fixtures: fragment/query separation, outside-project, and missing anchor", async () => {
      await mkdir(path.join(tempRoot, "docs"), { recursive: true });
      await writeClassifiedFiles(tempRoot, [
        { format: "markdown", kind: "documentation", path: "docs/guide.md" },
        { format: "markdown", kind: "documentation", path: "README.md" }
      ]);
      await writeFile(path.join(tempRoot, "README.md"), "# Install\n", "utf8");
      await writeFile(
        path.join(tempRoot, "docs", "guide.md"),
        [
          "[install](../README.md#install)",
          "[print](guide.md?mode=print#top)",
          "[outside](../../outside/readme.md)",
          "[broken anchor](../README.md#missing-anchor)",
          "[external](https://example.com)"
        ].join("\n"),
        "utf8"
      );

      await runIndexDocumentsJob(tempRoot);
      const references = await readDocumentReferences(tempRoot);

      const install = references.references.find((ref) => ref.raw_target === "../README.md#install");
      expect(install).toMatchObject({ fragment: "install", resolved_path: "README.md", status: "ok" });

      const print = references.references.find((ref) => ref.raw_target === "guide.md?mode=print#top");
      expect(print).toMatchObject({ fragment: "top", resolved_path: "docs/guide.md" });

      const outside = references.references.find((ref) => ref.raw_target === "../../outside/readme.md");
      expect(outside).toMatchObject({ failure_kind: "outside_project", status: "outside_project" });

      const brokenAnchor = references.references.find(
        (ref) => ref.raw_target === "../README.md#missing-anchor"
      );
      expect(brokenAnchor).toMatchObject({ failure_kind: "missing_anchor", status: "broken" });

      const external = references.references.find((ref) => ref.raw_target === "https://example.com");
      expect(external).toMatchObject({ link_type: "external", status: "unchecked" });
    });

    it("applies the missing_document predicate: broken doc targets qualify, broken asset/config/anchor targets do not", async () => {
      await writeClassifiedFiles(tempRoot, [{ format: "markdown", kind: "documentation", path: "guide.md" }]);
      await writeFile(
        path.join(tempRoot, "guide.md"),
        [
          "# Top",
          "[missing doc](missing.md)",
          "[missing readme](README)",
          "[missing asset](logo.png)",
          "[missing config](config.yaml)",
          "[missing anchor](#nope)"
        ].join("\n"),
        "utf8"
      );

      await runIndexDocumentsJob(tempRoot);
      const missing = await readMissingDocuments(tempRoot);
      const targets = missing.missing.map((entry) => entry.target).sort();

      expect(targets).toEqual(["README", "missing.md"]);
    });

    it("validates glossary candidates against canonical text and rejects unverifiable ones", async () => {
      await writeClassifiedFiles(tempRoot, [{ format: "markdown", kind: "documentation", path: "domain.md" }]);
      await writeFile(path.join(tempRoot, "domain.md"), "An Order belongs to a Customer.\n", "utf8");

      const result = await runIndexDocumentsJob(tempRoot, [
        { category: "entity_name", evidence: { line: 1, source: "domain.md" }, term: "Order" },
        { category: "entity_name", evidence: { line: 1, source: "domain.md" }, term: "NotInText" },
        { category: "not_a_real_category", evidence: { line: 1, source: "domain.md" }, term: "Customer" },
        { category: "entity_name", evidence: { line: 99, source: "domain.md" }, term: "Order" }
      ]);
      const glossary = await readDomainGlossary(tempRoot);

      expect(glossary.terms).toHaveLength(1);
      expect(glossary.terms[0]).toMatchObject({
        category: "entity_name",
        evidence: { excerpt: "An Order belongs to a Customer.", line: 1, source: "domain.md" },
        term: "Order"
      });
      expect(result.glossary_term_count).toBe(1);
    });

    it("deduplicates identical term+category+source+line glossary candidates", async () => {
      await writeClassifiedFiles(tempRoot, [{ format: "markdown", kind: "documentation", path: "domain.md" }]);
      await writeFile(path.join(tempRoot, "domain.md"), "An Order belongs to a Customer.\n", "utf8");

      await runIndexDocumentsJob(tempRoot, [
        { category: "entity_name", evidence: { line: 1, source: "domain.md" }, term: "Order" },
        { category: "entity_name", evidence: { line: 1, source: "domain.md" }, term: "Order" }
      ]);
      const glossary = await readDomainGlossary(tempRoot);

      expect(glossary.terms).toHaveLength(1);
    });

    it("fails when CLASSIFIED_FILES.json is missing", async () => {
      await expect(prepareIndexDocumentsJob(tempRoot)).rejects.toThrow();
    });
  });
});
