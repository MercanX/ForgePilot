import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createStageExecutionJournal } from "@services/jobs/stageExecutionJournal";

describe("stage execution journal", () => {
  it("reuses small completed local results for the same execution", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgepilot-journal-"));
    try {
      const journal = createStageExecutionJournal(root);
      const executionId = randomUUID();
      const directiveId = randomUUID();
      await journal.setExecutionId("stage-a", executionId);
      await journal.saveLocalResult("stage-a", executionId, directiveId, "op-a", { ok: true });

      await expect(journal.getExecutionId("stage-a")).resolves.toBe(executionId);
      await expect(
        journal.getLocalResult("stage-a", executionId, directiveId, "op-a")
      ).resolves.toEqual({
        found: true,
        output: { ok: true }
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not duplicate very large local payloads into the journal", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "forgepilot-journal-large-"));
    try {
      const journal = createStageExecutionJournal(root);
      const executionId = randomUUID();
      const directiveId = randomUUID();
      await journal.saveLocalResult(
        "stage-a",
        executionId,
        directiveId,
        "large-op",
        { body: "x".repeat(300 * 1024) }
      );

      const cached = await journal.getLocalResult("stage-a", executionId, directiveId, "large-op");
      expect(cached.found).toBe(false);
      const raw = await readFile(
        path.join(root, ".ai-factory", ".forgepilot", "execution-journal.json"),
        "utf8"
      );
      expect(raw.length).toBeLessThan(10_000);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
