import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  finalizeBuildContextJob,
  finalizeDetectGapsJob,
  finalizeIndexDocumentsJob,
  prepareBuildContextJob,
  prepareDetectGapsJob,
  prepareIndexDocumentsJob,
  runClassifyFilesJob,
  runMapDependenciesJob,
  runMapModuleDependenciesJob,
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

type ModuleSummaryFixture = {
  file_count: number;
  formats: string[];
  kind_counts: Record<string, number>;
  signals: string[];
};

type ModuleMapBase = {
  modules: Array<{
    description: string;
    description_evidence: unknown;
    id: string;
    name: string;
    paths: string[];
    root: string;
    summary: ModuleSummaryFixture;
  }>;
};

type ProjectContext = {
  assumptions: Array<{ evidence: unknown; statement: string }>;
  business_domain: { entities: unknown[]; name: string; name_evidence: unknown };
  modules: Array<{ description: string; description_evidence: unknown; id: string; name: string; root: string }>;
  project: {
    evidence: { purpose: unknown; type: unknown };
    name: string;
    purpose: string;
    root_path: string;
    type: string;
  };
  sources: string[];
  technology_stack: unknown[];
  unknowns: Array<{ field: string; reason: string }>;
  user_roles: unknown[];
};

const writeFileInventory = async (
  tempRoot: string,
  files: Array<{ path: string; size?: number; vcs_status?: string }>
): Promise<void> => {
  const reportsDir = path.join(tempRoot, ...REPORTS_DIR);
  await mkdir(reportsDir, { recursive: true });
  await writeFile(
    path.join(reportsDir, "FILE_INVENTORY.json"),
    JSON.stringify({
      files: files.map((file) => ({ path: file.path, size: file.size ?? 1, vcs_status: file.vcs_status ?? "unknown" })),
      metadata: {},
      root: ".",
      totals: { directories: 0, files: files.length }
    }),
    "utf8"
  );
};

const writeTechnologyStack = async (
  tempRoot: string,
  stack: Array<{ category: string; evidence: ManifestEvidence; name: string }> = []
): Promise<void> => {
  const reportsDir = path.join(tempRoot, ...REPORTS_DIR);
  await mkdir(reportsDir, { recursive: true });
  await writeFile(
    path.join(reportsDir, "TECHNOLOGY_STACK.json"),
    JSON.stringify({ metadata: {}, stack }),
    "utf8"
  );
};

const writeDomainGlossaryFixture = async (
  tempRoot: string,
  terms: Array<{ category: string; evidence: { excerpt: string; line: number; source: string }; term: string }> = []
): Promise<void> => {
  const reportsDir = path.join(tempRoot, ...REPORTS_DIR);
  await mkdir(reportsDir, { recursive: true });
  await writeFile(
    path.join(reportsDir, "DOMAIN_GLOSSARY.json"),
    JSON.stringify({ metadata: {}, terms }),
    "utf8"
  );
};

const writeDocumentIndexFixture = async (
  tempRoot: string,
  documents: Array<{ format: string; path: string }> = []
): Promise<void> => {
  const reportsDir = path.join(tempRoot, ...REPORTS_DIR);
  await mkdir(reportsDir, { recursive: true });
  await writeFile(
    path.join(reportsDir, "DOCUMENT_INDEX.json"),
    JSON.stringify({
      documents: documents.map((doc) => ({
        capabilities: { anchors: false, code_blocks: false, headings: false, links: false, tables: false },
        format: doc.format,
        path: doc.path
      })),
      metadata: {},
      standard_documents_inventory: {}
    }),
    "utf8"
  );
};

const writeBuildContextInputs = async (
  tempRoot: string,
  options: {
    classified: ClassifiedFileFixture[];
    documents?: Array<{ format: string; path: string }>;
    glossary?: Array<{ category: string; evidence: { excerpt: string; line: number; source: string }; term: string }>;
    inventory?: Array<{ path: string; size?: number }>;
    technologyStack?: Array<{ category: string; evidence: ManifestEvidence; name: string }>;
  }
): Promise<void> => {
  await writeClassifiedFiles(tempRoot, options.classified);
  await writeFileInventory(
    tempRoot,
    options.inventory ?? options.classified.map((file) => ({ path: file.path }))
  );
  await writeDocumentIndexFixture(tempRoot, options.documents ?? []);
  await writeDomainGlossaryFixture(tempRoot, options.glossary ?? []);
  await writeTechnologyStack(tempRoot, options.technologyStack ?? []);
};

const readProjectContext = (tempRoot: string): Promise<ProjectContext> =>
  readFile(path.join(tempRoot, ".ai-factory", "context", "project", "PROJECT_CONTEXT.json"), "utf8").then(
    (content) => JSON.parse(content) as ProjectContext
  );

const readModuleMapBase = (tempRoot: string): Promise<ModuleMapBase> =>
  readFile(path.join(tempRoot, ...REPORTS_DIR, "MODULE_MAP_BASE.json"), "utf8").then(
    (content) => JSON.parse(content) as ModuleMapBase
  );

const runBuildContextJob = async (tempRoot: string, patch: unknown = {}) => {
  const preparation = await prepareBuildContextJob(tempRoot);
  return finalizeBuildContextJob(tempRoot, preparation, patch);
};

type ModuleMapEntry = ModuleMapBase["modules"][number] & { depends_on: string[] };

type ModuleMap = {
  analysis_coverage: {
    analyzed_manifest_files: string[];
    analyzed_source_files: string[];
    unparsed_manifest_files: Array<{ path: string; reason: string }>;
    unparsed_source_files: Array<{ format: string | null; path: string; reason: string }>;
    unresolved_references: Array<{
      field: string | null;
      line: number | null;
      raw_target: string;
      reason: string;
      source: string;
    }>;
    unsupported_manifest_files: Array<{ path: string; reason: string }>;
    unsupported_source_files: Array<{ format: string | null; path: string; reason: string }>;
  };
  dependency_edges: Array<{
    evidence: {
      field: string | null;
      kind: string;
      line: number | null;
      raw_target: string;
      resolver: string;
      source: string;
    };
    source_module: string;
    target_module: string;
  }>;
  modules: ModuleMapEntry[];
};

const writeModuleMapBase = async (
  tempRoot: string,
  modules: Array<{
    description?: string;
    description_evidence?: unknown;
    id: string;
    name?: string;
    paths: string[];
    root: string;
    summary?: Partial<ModuleSummaryFixture>;
  }>
): Promise<void> => {
  const reportsDir = path.join(tempRoot, ...REPORTS_DIR);
  await mkdir(reportsDir, { recursive: true });
  await writeFile(
    path.join(reportsDir, "MODULE_MAP_BASE.json"),
    JSON.stringify({
      metadata: {},
      modules: modules.map((module) => ({
        description: module.description ?? "UNKNOWN",
        description_evidence: module.description_evidence ?? null,
        id: module.id,
        name: module.name ?? module.id,
        paths: module.paths,
        root: module.root,
        summary: {
          file_count: module.paths.length,
          formats: [],
          kind_counts: {},
          signals: [],
          ...module.summary
        }
      }))
    }),
    "utf8"
  );
};

const readModuleMap = (tempRoot: string): Promise<ModuleMap> =>
  readFile(path.join(tempRoot, ".ai-factory", "context", "project", "MODULE_MAP.json"), "utf8").then(
    (content) => JSON.parse(content) as ModuleMap
  );

const writeSourceFile = async (tempRoot: string, relativePath: string, content: string): Promise<void> => {
  const absolutePath = path.join(tempRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
};

const setupModules = async (
  tempRoot: string,
  modules: Array<{ files: ClassifiedFileFixture[]; id: string; root: string }>
): Promise<void> => {
  await writeClassifiedFiles(
    tempRoot,
    modules.flatMap((module) => module.files)
  );
  await writeModuleMapBase(
    tempRoot,
    modules.map((module) => ({ id: module.id, paths: module.files.map((file) => file.path), root: module.root }))
  );
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

  describe("build_context (RULE-D04)", () => {
    it("treats a root package.json as the sole explicit module; src/ is not a separate module", async () => {
      await writeBuildContextInputs(tempRoot, {
        classified: [
          { format: "json", kind: "manifest", path: "package.json" },
          { format: "typescript", kind: "source", path: "src/index.ts" },
          { format: "markdown", kind: "documentation", path: "README.md" }
        ]
      });

      await runBuildContextJob(tempRoot);
      const moduleMap = await readModuleMapBase(tempRoot);

      expect(moduleMap.modules).toHaveLength(1);
      expect(moduleMap.modules[0]).toMatchObject({ id: "root", root: "." });
      expect(moduleMap.modules[0]?.paths).toEqual(["README.md", "package.json", "src/index.ts"]);
    });

    it("creates two distinct nested explicit modules for packages/a and packages/b", async () => {
      await writeBuildContextInputs(tempRoot, {
        classified: [
          { format: "json", kind: "manifest", path: "packages/a/package.json" },
          { format: "typescript", kind: "source", path: "packages/a/src/index.ts" },
          { format: "json", kind: "manifest", path: "packages/b/package.json" },
          { format: "typescript", kind: "source", path: "packages/b/src/index.ts" }
        ]
      });

      await runBuildContextJob(tempRoot);
      const moduleMap = await readModuleMapBase(tempRoot);
      const ids = moduleMap.modules.map((module) => module.id).sort();

      expect(ids).toEqual(["packages/a", "packages/b"]);
      const moduleA = moduleMap.modules.find((module) => module.id === "packages/a");
      expect(moduleA?.paths).toEqual(["packages/a/package.json", "packages/a/src/index.ts"]);
      expect(moduleA?.name).toBe("a");
    });

    it("still creates a root module for a documentation/config-only project; no files are dropped", async () => {
      await writeBuildContextInputs(tempRoot, {
        classified: [
          { format: "markdown", kind: "documentation", path: "README.md" },
          { format: "yaml", kind: "configuration", path: "config/settings.yaml" }
        ]
      });

      await runBuildContextJob(tempRoot);
      const moduleMap = await readModuleMapBase(tempRoot);

      expect(moduleMap.modules).toHaveLength(1);
      expect(moduleMap.modules[0]).toMatchObject({ id: "root", root: "." });
      expect(moduleMap.modules[0]?.paths).toEqual(["README.md", "config/settings.yaml"]);
    });

    it("does not duplicate a nested module's file into the parent module", async () => {
      await writeBuildContextInputs(tempRoot, {
        classified: [
          { format: "json", kind: "manifest", path: "package.json" },
          { format: "json", kind: "manifest", path: "packages/orders/package.json" },
          { format: "typescript", kind: "source", path: "packages/orders/src/index.ts" },
          { format: "typescript", kind: "source", path: "src/app.ts" }
        ]
      });

      await runBuildContextJob(tempRoot);
      const moduleMap = await readModuleMapBase(tempRoot);
      const root = moduleMap.modules.find((module) => module.id === "root");
      const orders = moduleMap.modules.find((module) => module.id === "packages/orders");

      expect(orders?.paths).toEqual(["packages/orders/package.json", "packages/orders/src/index.ts"]);
      expect(root?.paths).toEqual(["package.json", "src/app.ts"]);
      expect(root?.paths).not.toContain("packages/orders/src/index.ts");
    });

    it("gives apps/api and packages/api distinct ids despite the same basename", async () => {
      await writeBuildContextInputs(tempRoot, {
        classified: [
          { format: "json", kind: "manifest", path: "apps/api/package.json" },
          { format: "typescript", kind: "source", path: "apps/api/index.ts" },
          { format: "json", kind: "manifest", path: "packages/api/package.json" },
          { format: "typescript", kind: "source", path: "packages/api/index.ts" }
        ]
      });

      await runBuildContextJob(tempRoot);
      const moduleMap = await readModuleMapBase(tempRoot);
      const ids = moduleMap.modules.map((module) => module.id).sort();

      expect(ids).toEqual(["apps/api", "packages/api"]);
    });

    it("never opens a fallback module purely from a top-level dir with only documentation files", async () => {
      await writeBuildContextInputs(tempRoot, {
        classified: [
          { format: "markdown", kind: "documentation", path: "docs/guide.md" },
          { format: "typescript", kind: "source", path: "app.ts" }
        ]
      });

      await runBuildContextJob(tempRoot);
      const moduleMap = await readModuleMapBase(tempRoot);

      expect(moduleMap.modules).toHaveLength(1);
      expect(moduleMap.modules[0]?.id).toBe("root");
      expect(moduleMap.modules[0]?.paths).toEqual(["app.ts", "docs/guide.md"]);
    });

    it("opens a fallback module for a top-level dir containing an eligible source/database/script file", async () => {
      await writeBuildContextInputs(tempRoot, {
        classified: [
          { format: "typescript", kind: "source", path: "app.ts" },
          { format: "typescript", kind: "source", path: "backend/server.ts" },
          { format: "markdown", kind: "documentation", path: "backend/NOTES.md" }
        ]
      });

      await runBuildContextJob(tempRoot);
      const moduleMap = await readModuleMapBase(tempRoot);
      const ids = moduleMap.modules.map((module) => module.id).sort();

      expect(ids).toEqual(["backend", "root"]);
      const backend = moduleMap.modules.find((module) => module.id === "backend");
      expect(backend?.paths).toEqual(["backend/NOTES.md", "backend/server.ts"]);
    });

    it("does not write a depends_on field on MODULE_MAP_BASE modules", async () => {
      await writeBuildContextInputs(tempRoot, {
        classified: [{ format: "typescript", kind: "source", path: "app.ts" }]
      });

      await runBuildContextJob(tempRoot);
      const moduleMap = await readModuleMapBase(tempRoot);

      expect(moduleMap.modules[0]).not.toHaveProperty("depends_on");
    });

    it("keeps PROJECT_CONTEXT.modules[] and MODULE_MAP_BASE.modules[] on the same id set", async () => {
      await writeBuildContextInputs(tempRoot, {
        classified: [
          { format: "json", kind: "manifest", path: "packages/a/package.json" },
          { format: "typescript", kind: "source", path: "packages/a/src/index.ts" },
          { format: "markdown", kind: "documentation", path: "README.md" }
        ]
      });

      await runBuildContextJob(tempRoot);
      const projectContext = await readProjectContext(tempRoot);
      const moduleMap = await readModuleMapBase(tempRoot);

      expect(projectContext.modules.map((module) => module.id).sort()).toEqual(
        moduleMap.modules.map((module) => module.id).sort()
      );
    });

    it("computes module summary file_count/kind_counts/formats/signals correctly", async () => {
      await writeBuildContextInputs(tempRoot, {
        classified: [
          { format: "typescript", kind: "source", path: "user.test.ts", signals: ["test"] },
          { format: "typescript", kind: "source", path: "app.ts" },
          { format: "markdown", kind: "documentation", path: "README.md" }
        ]
      });

      await runBuildContextJob(tempRoot);
      const moduleMap = await readModuleMapBase(tempRoot);
      const root = moduleMap.modules.find((module) => module.id === "root");

      expect(root?.summary).toEqual({
        file_count: 3,
        formats: ["markdown", "typescript"],
        kind_counts: { documentation: 1, source: 2 },
        signals: ["test"]
      });
    });

    it("copies technology_stack from TECHNOLOGY_STACK.json unchanged", async () => {
      const stack = [{ category: "Language", evidence: { note: "n", source: "s" }, name: "TypeScript" }];
      await writeBuildContextInputs(tempRoot, {
        classified: [{ format: "typescript", kind: "source", path: "app.ts" }],
        technologyStack: stack
      });

      await runBuildContextJob(tempRoot);
      const projectContext = await readProjectContext(tempRoot);

      expect(projectContext.technology_stack).toEqual(stack);
    });

    it("transplants entities only from glossary entity_name records, and roles only from role records", async () => {
      await writeBuildContextInputs(tempRoot, {
        classified: [{ format: "typescript", kind: "source", path: "app.ts" }],
        glossary: [
          { category: "entity_name", evidence: { excerpt: "An Order", line: 1, source: "domain.md" }, term: "Order" },
          { category: "role", evidence: { excerpt: "as Admin", line: 2, source: "domain.md" }, term: "Admin" },
          { category: "business_term", evidence: { excerpt: "checkout flow", line: 3, source: "domain.md" }, term: "checkout" }
        ]
      });

      await runBuildContextJob(tempRoot);
      const projectContext = await readProjectContext(tempRoot);

      expect(projectContext.business_domain.entities).toEqual([
        { evidence: { excerpt: "An Order", line: 1, source: "domain.md" }, term: "Order" }
      ]);
      expect(projectContext.user_roles).toEqual([
        { evidence: { excerpt: "as Admin", line: 2, source: "domain.md" }, term: "Admin" }
      ]);
    });

    it("accepts a semantic patch value only when its evidence excerpt genuinely occurs at source+line", async () => {
      await writeBuildContextInputs(tempRoot, {
        classified: [{ format: "typescript", kind: "source", path: "app.ts" }],
        documents: [{ format: "markdown", path: "README.md" }]
      });
      await writeFile(path.join(tempRoot, "README.md"), "This is a CLI tool for developers.\n", "utf8");

      const result = await runBuildContextJob(tempRoot, {
        project: {
          evidence: { type: { excerpt: "CLI tool", line: 1, source: "README.md" } },
          type: "cli"
        }
      });
      const projectContext = await readProjectContext(tempRoot);

      expect(projectContext.project.type).toBe("cli");
      expect(projectContext.project.evidence.type).toEqual({
        excerpt: "CLI tool",
        line: 1,
        source: "README.md"
      });
      expect(projectContext.sources).toEqual(["README.md"]);
      expect(result.unknown_count).toBe(3);
    });

    it("rejects a semantic patch value when the evidence excerpt does not occur at the claimed location, leaving it UNKNOWN", async () => {
      await writeBuildContextInputs(tempRoot, {
        classified: [{ format: "typescript", kind: "source", path: "app.ts" }],
        documents: [{ format: "markdown", path: "README.md" }]
      });
      await writeFile(path.join(tempRoot, "README.md"), "This is a CLI tool for developers.\n", "utf8");

      const result = await runBuildContextJob(tempRoot, {
        project: {
          evidence: { type: { excerpt: "totally fabricated text", line: 1, source: "README.md" } },
          type: "cli"
        }
      });
      const projectContext = await readProjectContext(tempRoot);

      expect(projectContext.project.type).toBe("UNKNOWN");
      expect(projectContext.unknowns).toContainEqual({
        field: "project.type",
        reason: "No direct evidence found in allowed sources."
      });
      expect(result.unknown_count).toBe(4);
    });

    it("resolves module descriptions from patch entries and marks unresolved ones UNKNOWN with an unknowns[] entry", async () => {
      await writeBuildContextInputs(tempRoot, {
        classified: [
          { format: "json", kind: "manifest", path: "packages/a/package.json" },
          { format: "typescript", kind: "source", path: "packages/a/src/index.ts" },
          { format: "json", kind: "manifest", path: "packages/b/package.json" },
          { format: "typescript", kind: "source", path: "packages/b/src/index.ts" }
        ],
        documents: [{ format: "markdown", path: "README.md" }]
      });
      await writeFile(path.join(tempRoot, "README.md"), "Module a handles orders.\n", "utf8");

      const result = await runBuildContextJob(tempRoot, {
        modules: [
          {
            description: "Module a handles orders.",
            description_evidence: { excerpt: "Module a handles orders.", line: 1, source: "README.md" },
            id: "packages/a"
          }
        ]
      });
      const projectContext = await readProjectContext(tempRoot);
      const moduleA = projectContext.modules.find((module) => module.id === "packages/a");
      const moduleB = projectContext.modules.find((module) => module.id === "packages/b");

      expect(moduleA?.description).toBe("Module a handles orders.");
      expect(moduleB?.description).toBe("UNKNOWN");
      expect(projectContext.unknowns).toContainEqual({
        field: "modules[packages/b].description",
        reason: "No direct evidence found in allowed sources."
      });
      expect(result.unknown_count).toBe(4);
    });

    it("fails when FILE_INVENTORY.json and CLASSIFIED_FILES.json path sets do not match", async () => {
      await writeBuildContextInputs(tempRoot, {
        classified: [{ format: "typescript", kind: "source", path: "app.ts" }],
        inventory: [{ path: "different.ts" }]
      });

      await expect(prepareBuildContextJob(tempRoot)).rejects.toThrow();
    });

    it("fails when structured inputs are missing", async () => {
      await expect(prepareBuildContextJob(tempRoot)).rejects.toThrow();
    });
  });

  describe("runMapModuleDependenciesJob (RULE-D08)", () => {
    it("resolves a relative TypeScript import across modules and derives depends_on", async () => {
      await setupModules(tempRoot, [
        { files: [{ format: "typescript", kind: "source", path: "web/index.ts" }], id: "web", root: "web" },
        { files: [{ format: "typescript", kind: "source", path: "auth/index.ts" }], id: "auth", root: "auth" }
      ]);
      await writeSourceFile(tempRoot, "web/index.ts", 'import { login } from "../auth/index";\n');
      await writeSourceFile(tempRoot, "auth/index.ts", "export const login = () => {};\n");

      const result = await runMapModuleDependenciesJob(tempRoot);
      const map = await readModuleMap(tempRoot);

      expect(result).toEqual({ edge_count: 1, module_count: 2, unresolved_count: 0 });
      expect(map.modules.find((module) => module.id === "web")?.depends_on).toEqual(["auth"]);
      expect(map.dependency_edges).toEqual([
        {
          evidence: {
            field: null,
            kind: "source_reference",
            line: 1,
            raw_target: "../auth/index",
            resolver: "typescript_relative",
            source: "web/index.ts"
          },
          source_module: "web",
          target_module: "auth"
        }
      ]);
    });

    it("reports target_not_found and ambiguous_target for unresolved relative imports", async () => {
      await setupModules(tempRoot, [
        {
          files: [
            { format: "typescript", kind: "source", path: "web/a.ts" },
            { format: "typescript", kind: "source", path: "web/dup.ts" },
            { format: "javascript", kind: "source", path: "web/dup.js" }
          ],
          id: "web",
          root: "web"
        }
      ]);
      await writeSourceFile(tempRoot, "web/a.ts", 'import "./missing";\nimport "./dup";\n');
      await writeSourceFile(tempRoot, "web/dup.ts", "export const dup = 1;\n");
      await writeSourceFile(tempRoot, "web/dup.js", "module.exports.dup = 1;\n");

      const result = await runMapModuleDependenciesJob(tempRoot);
      const map = await readModuleMap(tempRoot);

      expect(result.unresolved_count).toBe(2);
      expect(map.analysis_coverage.unresolved_references).toEqual([
        { field: null, line: 1, raw_target: "./missing", reason: "target_not_found", source: "web/a.ts" },
        { field: null, line: 2, raw_target: "./dup", reason: "ambiguous_target", source: "web/a.ts" }
      ]);
    });

    it("does not treat import-like text inside comments or string literals as a real reference", async () => {
      await setupModules(tempRoot, [
        { files: [{ format: "javascript", kind: "source", path: "web/index.js" }], id: "web", root: "web" },
        { files: [{ format: "javascript", kind: "source", path: "auth/index.js" }], id: "auth", root: "auth" }
      ]);
      await writeSourceFile(
        tempRoot,
        "web/index.js",
        [
          '// import auth from "../auth/index";',
          'const note = \'import auth from "../auth/index"\';',
          "export const web = 1;",
          ""
        ].join("\n")
      );
      await writeSourceFile(tempRoot, "auth/index.js", "export const auth = 1;\n");

      const result = await runMapModuleDependenciesJob(tempRoot);

      expect(result).toEqual({ edge_count: 0, module_count: 2, unresolved_count: 0 });
    });

    it("resolves a bare specifier via the local package.json name registry and flags duplicate names as ambiguous", async () => {
      await setupModules(tempRoot, [
        {
          files: [
            { format: "json", kind: "manifest", path: "web/package.json" },
            { format: "typescript", kind: "source", path: "web/index.ts" }
          ],
          id: "web",
          root: "web"
        },
        {
          files: [
            { format: "json", kind: "manifest", path: "auth/package.json" },
            { format: "typescript", kind: "source", path: "auth/index.ts" }
          ],
          id: "auth",
          root: "auth"
        },
        {
          files: [
            { format: "json", kind: "manifest", path: "dup-a/package.json" },
            { format: "typescript", kind: "source", path: "dup-a/index.ts" }
          ],
          id: "dup-a",
          root: "dup-a"
        },
        {
          files: [
            { format: "json", kind: "manifest", path: "dup-b/package.json" },
            { format: "typescript", kind: "source", path: "dup-b/index.ts" }
          ],
          id: "dup-b",
          root: "dup-b"
        }
      ]);
      await writeSourceFile(tempRoot, "web/package.json", JSON.stringify({ name: "@acme/web" }));
      await writeSourceFile(tempRoot, "auth/package.json", JSON.stringify({ name: "@acme/auth" }));
      await writeSourceFile(tempRoot, "dup-a/package.json", JSON.stringify({ name: "@acme/dup" }));
      await writeSourceFile(tempRoot, "dup-b/package.json", JSON.stringify({ name: "@acme/dup" }));
      await writeSourceFile(
        tempRoot,
        "web/index.ts",
        'import { login } from "@acme/auth";\nimport { x } from "@acme/dup";\n'
      );
      await writeSourceFile(tempRoot, "auth/index.ts", "export const login = () => {};\n");
      await writeSourceFile(tempRoot, "dup-a/index.ts", "export const x = 1;\n");
      await writeSourceFile(tempRoot, "dup-b/index.ts", "export const x = 2;\n");

      const result = await runMapModuleDependenciesJob(tempRoot);
      const map = await readModuleMap(tempRoot);

      expect(result.edge_count).toBe(1);
      expect(map.modules.find((module) => module.id === "web")?.depends_on).toEqual(["auth"]);
      expect(map.analysis_coverage.unresolved_references).toEqual([
        { field: null, line: 2, raw_target: "@acme/dup", reason: "ambiguous_local_package", source: "web/index.ts" }
      ]);
    });

    it("resolves an extensionless relative import through package.json main before falling back to index", async () => {
      await setupModules(tempRoot, [
        { files: [{ format: "typescript", kind: "source", path: "web/index.ts" }], id: "web", root: "web" },
        {
          files: [
            { format: "json", kind: "manifest", path: "lib/package.json" },
            { format: "javascript", kind: "source", path: "lib/entry.js" }
          ],
          id: "lib",
          root: "lib"
        }
      ]);
      await writeSourceFile(tempRoot, "web/index.ts", 'import "../lib";\n');
      await writeSourceFile(tempRoot, "lib/package.json", JSON.stringify({ main: "entry.js" }));
      await writeSourceFile(tempRoot, "lib/entry.js", "module.exports = {};\n");

      const result = await runMapModuleDependenciesJob(tempRoot);
      const map = await readModuleMap(tempRoot);

      expect(result).toEqual({ edge_count: 1, module_count: 2, unresolved_count: 0 });
      expect(map.modules.find((module) => module.id === "web")?.depends_on).toEqual(["lib"]);
    });

    it("resolves Python relative imports, ignores absolute imports, and reports an out-of-root ascent", async () => {
      await setupModules(tempRoot, [
        {
          files: [
            { format: "python", kind: "source", path: "app/main.py" },
            { format: "python", kind: "source", path: "app/utils.py" }
          ],
          id: "app",
          root: "app"
        }
      ]);
      await writeSourceFile(
        tempRoot,
        "app/main.py",
        ["from .utils import helper", "from .... import too_far", "import os", ""].join("\n")
      );
      await writeSourceFile(tempRoot, "app/utils.py", "def helper():\n    pass\n");

      const result = await runMapModuleDependenciesJob(tempRoot);
      const map = await readModuleMap(tempRoot);

      expect(result.edge_count).toBe(0);
      expect(result.unresolved_count).toBe(1);
      expect(map.analysis_coverage.unresolved_references).toEqual([
        { field: null, line: 2, raw_target: "too_far", reason: "outside_project", source: "app/main.py" }
      ]);
      expect(map.analysis_coverage.analyzed_source_files).toEqual(["app/main.py", "app/utils.py"]);
    });

    it("resolves PHP namespaces via the longest local PSR-4 prefix", async () => {
      await setupModules(tempRoot, [
        {
          files: [
            { format: "json", kind: "manifest", path: "web/composer.json" },
            { format: "php", kind: "source", path: "web/src/Controller.php" }
          ],
          id: "web",
          root: "web"
        },
        {
          files: [
            { format: "json", kind: "manifest", path: "auth/composer.json" },
            { format: "php", kind: "source", path: "auth/src/Service.php" }
          ],
          id: "auth",
          root: "auth"
        }
      ]);
      await writeSourceFile(
        tempRoot,
        "web/composer.json",
        JSON.stringify({ autoload: { "psr-4": { "Acme\\Web\\": "src/" } }, name: "acme/web" })
      );
      await writeSourceFile(
        tempRoot,
        "auth/composer.json",
        JSON.stringify({ autoload: { "psr-4": { "Acme\\Auth\\": "src/" } }, name: "acme/auth" })
      );
      await writeSourceFile(
        tempRoot,
        "web/src/Controller.php",
        ["<?php", "", "use Acme\\Auth\\Service;", "", "class Controller {}", ""].join("\n")
      );
      await writeSourceFile(tempRoot, "auth/src/Service.php", "<?php\n\nclass Service {}\n");

      const result = await runMapModuleDependenciesJob(tempRoot);
      const map = await readModuleMap(tempRoot);

      expect(result).toEqual({ edge_count: 1, module_count: 2, unresolved_count: 0 });
      expect(map.modules.find((module) => module.id === "web")?.depends_on).toEqual(["auth"]);
      expect(map.dependency_edges[0]?.evidence.resolver).toBe("php_psr4_local_namespace");
    });

    it("resolves Go imports via the local go.mod registry and requires a directly-owned source file", async () => {
      await setupModules(tempRoot, [
        {
          files: [
            { format: "plain_text", kind: "manifest", path: "web/go.mod" },
            { format: "go", kind: "source", path: "web/main.go" }
          ],
          id: "web",
          root: "web"
        },
        {
          files: [
            { format: "plain_text", kind: "manifest", path: "auth/go.mod" },
            { format: "go", kind: "source", path: "auth/client/client.go" }
          ],
          id: "auth",
          root: "auth"
        }
      ]);
      await writeSourceFile(tempRoot, "web/go.mod", "module github.com/acme/web\n\ngo 1.21\n");
      await writeSourceFile(tempRoot, "auth/go.mod", "module github.com/acme/auth\n\ngo 1.21\n");
      await writeSourceFile(
        tempRoot,
        "web/main.go",
        ["package main", "", 'import "github.com/acme/auth/client"', "", "func main() {}", ""].join("\n")
      );
      await writeSourceFile(tempRoot, "auth/client/client.go", "package client\n");

      const result = await runMapModuleDependenciesJob(tempRoot);
      const map = await readModuleMap(tempRoot);

      expect(result).toEqual({ edge_count: 1, module_count: 2, unresolved_count: 0 });
      expect(map.modules.find((module) => module.id === "web")?.depends_on).toEqual(["auth"]);
      expect(map.dependency_edges[0]?.evidence).toMatchObject({
        kind: "source_reference",
        line: 3,
        raw_target: "github.com/acme/auth/client",
        resolver: "go_local_module",
        source: "web/main.go"
      });
    });

    it("produces manifest-reference edges from package.json and composer.json dependency tables", async () => {
      await setupModules(tempRoot, [
        { files: [{ format: "json", kind: "manifest", path: "web/package.json" }], id: "web", root: "web" },
        { files: [{ format: "json", kind: "manifest", path: "auth/package.json" }], id: "auth", root: "auth" },
        { files: [{ format: "json", kind: "manifest", path: "api/composer.json" }], id: "api", root: "api" },
        { files: [{ format: "json", kind: "manifest", path: "billing/composer.json" }], id: "billing", root: "billing" }
      ]);
      await writeSourceFile(
        tempRoot,
        "web/package.json",
        JSON.stringify({ dependencies: { "@acme/auth": "1.0.0" }, name: "@acme/web" })
      );
      await writeSourceFile(tempRoot, "auth/package.json", JSON.stringify({ name: "@acme/auth" }));
      await writeSourceFile(
        tempRoot,
        "api/composer.json",
        JSON.stringify({ name: "acme/api", require: { "acme/billing": "^1.0", php: "^8.1" } })
      );
      await writeSourceFile(tempRoot, "billing/composer.json", JSON.stringify({ name: "acme/billing" }));

      const result = await runMapModuleDependenciesJob(tempRoot);
      const map = await readModuleMap(tempRoot);

      expect(result).toEqual({ edge_count: 2, module_count: 4, unresolved_count: 0 });
      expect(map.modules.find((module) => module.id === "web")?.depends_on).toEqual(["auth"]);
      expect(map.modules.find((module) => module.id === "api")?.depends_on).toEqual(["billing"]);
      expect(map.dependency_edges.find((edge) => edge.source_module === "web")?.evidence).toMatchObject({
        field: "dependencies.@acme/auth",
        kind: "manifest_reference",
        line: null,
        resolver: "package_json_local_dependency"
      });
      expect(map.dependency_edges.find((edge) => edge.source_module === "api")?.evidence).toMatchObject({
        field: "require.acme/billing",
        kind: "manifest_reference",
        line: null,
        resolver: "composer_json_local_dependency"
      });
    });

    it("produces manifest-reference edges from go.mod require, Cargo.toml path dependencies, and MSBuild ProjectReference", async () => {
      await setupModules(tempRoot, [
        { files: [{ format: "plain_text", kind: "manifest", path: "svc/go.mod" }], id: "svc", root: "svc" },
        { files: [{ format: "plain_text", kind: "manifest", path: "shared/go.mod" }], id: "shared", root: "shared" },
        { files: [{ format: "toml", kind: "manifest", path: "core/Cargo.toml" }], id: "core", root: "core" },
        { files: [{ format: "toml", kind: "manifest", path: "utils/Cargo.toml" }], id: "utils", root: "utils" },
        { files: [{ format: "xml", kind: "manifest", path: "App/App.csproj" }], id: "App", root: "App" },
        { files: [{ format: "xml", kind: "manifest", path: "Shared/Shared.csproj" }], id: "Shared", root: "Shared" }
      ]);
      await writeSourceFile(tempRoot, "svc/go.mod", "module github.com/acme/svc\n\nrequire github.com/acme/shared v1.0.0\n");
      await writeSourceFile(tempRoot, "shared/go.mod", "module github.com/acme/shared\n");
      await writeSourceFile(tempRoot, "core/Cargo.toml", '[package]\nname = "core"\n\n[dependencies]\nutils = { path = "../utils" }\n');
      await writeSourceFile(tempRoot, "utils/Cargo.toml", '[package]\nname = "utils"\n');
      await writeSourceFile(
        tempRoot,
        "App/App.csproj",
        '<Project Sdk="Microsoft.NET.Sdk">\n  <ItemGroup>\n    <ProjectReference Include="..\\Shared\\Shared.csproj" />\n  </ItemGroup>\n</Project>\n'
      );
      await writeSourceFile(tempRoot, "Shared/Shared.csproj", '<Project Sdk="Microsoft.NET.Sdk" />\n');

      const result = await runMapModuleDependenciesJob(tempRoot);
      const map = await readModuleMap(tempRoot);

      expect(result).toEqual({ edge_count: 3, module_count: 6, unresolved_count: 0 });
      expect(map.modules.find((module) => module.id === "svc")?.depends_on).toEqual(["shared"]);
      expect(map.modules.find((module) => module.id === "core")?.depends_on).toEqual(["utils"]);
      expect(map.modules.find((module) => module.id === "App")?.depends_on).toEqual(["Shared"]);
      expect(map.dependency_edges.map((edge) => edge.evidence.resolver).sort()).toEqual([
        "cargo_toml_local_path_dependency",
        "go_mod_local_dependency",
        "msbuild_project_reference"
      ]);
    });

    it("flags dynamic require()/import() calls as unresolved without guessing a target", async () => {
      await setupModules(tempRoot, [
        { files: [{ format: "javascript", kind: "source", path: "web/index.js" }], id: "web", root: "web" }
      ]);
      await writeSourceFile(
        tempRoot,
        "web/index.js",
        ["const name = './auth';", "const mod = require(name);", "export default mod;", ""].join("\n")
      );

      const result = await runMapModuleDependenciesJob(tempRoot);
      const map = await readModuleMap(tempRoot);

      expect(result).toEqual({ edge_count: 0, module_count: 1, unresolved_count: 1 });
      expect(map.analysis_coverage.unresolved_references[0]).toMatchObject({
        line: 2,
        reason: "dynamic_reference",
        source: "web/index.js"
      });
    });

    it("records unparsable source files in coverage without inventing edges", async () => {
      await setupModules(tempRoot, [
        { files: [{ format: "typescript", kind: "source", path: "web/broken.ts" }], id: "web", root: "web" }
      ]);
      await writeSourceFile(tempRoot, "web/broken.ts", 'import { from "./oops\n');

      const result = await runMapModuleDependenciesJob(tempRoot);
      const map = await readModuleMap(tempRoot);

      expect(result).toEqual({ edge_count: 0, module_count: 1, unresolved_count: 0 });
      expect(map.analysis_coverage.unparsed_source_files).toEqual([
        { format: "typescript", path: "web/broken.ts", reason: "parse_error" }
      ]);
      expect(map.analysis_coverage.analyzed_source_files).toEqual([]);
    });

    it("records unsupported source formats and unsupported module-defining manifests in coverage", async () => {
      await setupModules(tempRoot, [
        {
          files: [
            { format: "java", kind: "source", path: "svc/App.java" },
            { format: "toml", kind: "manifest", path: "svc/pyproject.toml" }
          ],
          id: "svc",
          root: "svc"
        }
      ]);
      await writeSourceFile(tempRoot, "svc/App.java", "class App {}\n");
      await writeSourceFile(tempRoot, "svc/pyproject.toml", '[project]\nname = "svc"\n');

      const result = await runMapModuleDependenciesJob(tempRoot);
      const map = await readModuleMap(tempRoot);

      expect(result).toEqual({ edge_count: 0, module_count: 1, unresolved_count: 0 });
      expect(map.analysis_coverage.unsupported_source_files).toEqual([
        { format: "java", path: "svc/App.java", reason: "unsupported_format" }
      ]);
      expect(map.analysis_coverage.unsupported_manifest_files).toEqual([
        { path: "svc/pyproject.toml", reason: "unsupported_manifest_reference" }
      ]);
    });

    it("preserves MODULE_MAP_BASE fields and only adds depends_on/dependency_edges/analysis_coverage", async () => {
      await setupModules(tempRoot, [
        { files: [{ format: "typescript", kind: "source", path: "web/index.ts" }], id: "web", root: "web" }
      ]);
      await writeSourceFile(tempRoot, "web/index.ts", "export const a = 1;\n");

      await runMapModuleDependenciesJob(tempRoot);

      const base = await readModuleMapBase(tempRoot);
      const map = await readModuleMap(tempRoot);

      expect(map.modules).toEqual([{ ...base.modules[0], depends_on: [] }]);
    });

    it("throws when CLASSIFIED_FILES.json and MODULE_MAP_BASE.json path sets disagree", async () => {
      await writeClassifiedFiles(tempRoot, [{ format: "typescript", kind: "source", path: "web/index.ts" }]);
      await writeModuleMapBase(tempRoot, [{ id: "web", paths: ["web/other.ts"], root: "web" }]);

      await expect(runMapModuleDependenciesJob(tempRoot)).rejects.toThrow();
    });
  });
});
