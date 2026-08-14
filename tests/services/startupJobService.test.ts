import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runStartupJob } from "@services/startup/startupJobService";

describe("startupJobService", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "forgepilot-startup-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { force: true, recursive: true });
  });

  it("creates the factory directory and default config when missing", async () => {
    const result = await runStartupJob(tempRoot);
    const config = await readFile(
      path.join(tempRoot, ".ai-factory", "factory.config.yaml"),
      "utf8"
    );

    expect(result).toEqual({
      check_factory: {
        created: true,
        path: path.join(tempRoot, ".ai-factory")
      },
      read_config: {
        locale: "tr-TR",
        mode: "unknown",
        version: "unknown"
      }
    });
    expect(config).toBe(
      ["version: unknown", "factory:", "  mode: unknown", "  locale: tr-TR", ""].join("\n")
    );
  });

  it("reads an existing config without replacing it", async () => {
    const factoryPath = path.join(tempRoot, ".ai-factory");
    const configPath = path.join(factoryPath, "factory.config.yaml");
    const existingConfig = [
      "version: 1.2.3",
      "factory:",
      "  mode: dev",
      "  locale: de-DE",
      ""
    ].join("\n");
    await runStartupJob(tempRoot);
    await writeFile(configPath, existingConfig, "utf8");

    const result = await runStartupJob(tempRoot);
    const config = await readFile(configPath, "utf8");

    expect(result).toEqual({
      check_factory: {
        created: false,
        path: factoryPath
      },
      read_config: {
        locale: "de-DE",
        mode: "dev",
        version: "1.2.3"
      }
    });
    expect(config).toBe(existingConfig);
  });

  it("falls back to tr-TR for unsupported locales", async () => {
    await runStartupJob(tempRoot);
    await writeFile(
      path.join(tempRoot, ".ai-factory", "factory.config.yaml"),
      ["version: 2", "factory:", "  mode: prod", "  locale: es-ES", ""].join("\n"),
      "utf8"
    );

    await expect(runStartupJob(tempRoot)).resolves.toMatchObject({
      read_config: {
        locale: "tr-TR",
        mode: "prod",
        version: "2"
      }
    });
  });
});
