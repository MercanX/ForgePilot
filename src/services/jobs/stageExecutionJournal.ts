import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const JOURNAL_RELATIVE_PATH = path.join(".ai-factory", ".forgepilot", "execution-journal.json");
const MAX_CACHED_LOCAL_RESULT_BYTES = 256 * 1024;

type LocalResultRecord = {
  completedAt: string;
  operation: string;
  output: unknown;
};

type StageJournalRecord = {
  executionId: string;
  localResults: Record<string, LocalResultRecord>;
  updatedAt: string;
};

type JournalDocument = {
  schemaVersion: 1;
  stages: Record<string, StageJournalRecord>;
};

export type StageExecutionJournal = {
  clearStage: (stageId: string) => Promise<void>;
  getExecutionId: (stageId: string) => Promise<string | null>;
  getLocalResult: (
    stageId: string,
    executionId: string,
    directiveId: string,
    operation: string
  ) => Promise<{ found: boolean; output: unknown }>;
  saveLocalResult: (
    stageId: string,
    executionId: string,
    directiveId: string,
    operation: string,
    output: unknown
  ) => Promise<void>;
  setExecutionId: (stageId: string, executionId: string) => Promise<void>;
};

const emptyJournal = (): JournalDocument => ({ schemaVersion: 1, stages: {} });

const parseJournal = (value: unknown): JournalDocument => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return emptyJournal();
  }

  const document = value as Partial<JournalDocument>;

  if (
    document.schemaVersion !== 1 ||
    typeof document.stages !== "object" ||
    document.stages === null
  ) {
    return emptyJournal();
  }

  return {
    schemaVersion: 1,
    stages: document.stages as Record<string, StageJournalRecord>
  };
};

export const createStageExecutionJournal = (projectRootPath: string): StageExecutionJournal => {
  const journalPath = path.join(projectRootPath, JOURNAL_RELATIVE_PATH);

  const read = async (): Promise<JournalDocument> => {
    try {
      return parseJournal(JSON.parse(await readFile(journalPath, "utf8")) as unknown);
    } catch {
      return emptyJournal();
    }
  };

  const write = async (document: JournalDocument): Promise<void> => {
    const directory = path.dirname(journalPath);
    const temporaryPath = `${journalPath}.tmp`;
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await rename(temporaryPath, journalPath);
  };

  const ensureStage = (
    document: JournalDocument,
    stageId: string,
    executionId: string
  ): StageJournalRecord => {
    const current = document.stages[stageId];

    if (current?.executionId === executionId) {
      return current;
    }

    const created: StageJournalRecord = {
      executionId,
      localResults: {},
      updatedAt: new Date().toISOString()
    };
    document.stages[stageId] = created;
    return created;
  };

  return {
    clearStage: async (stageId) => {
      const document = await read();
      delete document.stages[stageId];
      await write(document);
    },
    getExecutionId: async (stageId) => (await read()).stages[stageId]?.executionId ?? null,
    getLocalResult: async (stageId, executionId, directiveId, operation) => {
      const record = (await read()).stages[stageId];
      const result =
        record?.executionId === executionId ? record.localResults[directiveId] : undefined;

      if (!result || result.operation !== operation) {
        return { found: false, output: null };
      }

      return { found: true, output: result.output };
    },
    saveLocalResult: async (stageId, executionId, directiveId, operation, output) => {
      const document = await read();
      const stage = ensureStage(document, stageId, executionId);
      let serialized: string | null = null;

      try {
        const json = JSON.stringify(output);
        serialized = typeof json === "string" ? json : null;
      } catch {
        serialized = null;
      }

      // Large Discovery preparations can contain substantial project text. They
      // are replay-safe and should be recomputed rather than duplicated into a
      // recovery journal. Small mutating-operation results are cached so a crash
      // does not repeat the already-completed local step.
      if (
        serialized !== null &&
        Buffer.byteLength(serialized, "utf8") <= MAX_CACHED_LOCAL_RESULT_BYTES
      ) {
        stage.localResults[directiveId] = {
          completedAt: new Date().toISOString(),
          operation,
          output
        };
      }

      stage.updatedAt = new Date().toISOString();
      await write(document);
    },
    setExecutionId: async (stageId, executionId) => {
      const document = await read();
      const stage = ensureStage(document, stageId, executionId);
      stage.updatedAt = new Date().toISOString();
      await write(document);
    }
  };
};
