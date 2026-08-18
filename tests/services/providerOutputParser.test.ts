import { parseLastJsonObject } from "@services/jobs/stageExecutionService";
import { PROVIDER_IDS } from "@shared/constants/providerIds";
import type { ProviderOutputChunk } from "@shared/schemas/job";

const chunk = (text: string): ProviderOutputChunk => ({
  stream: "stdout",
  text,
  timestamp: "2026-08-18T00:00:00.000Z"
});

const assistantEvent = (text: string): string =>
  `${JSON.stringify({
    message: { content: [{ text, type: "text" }] },
    type: "assistant"
  })}\n`;

const resultEvent = (text: string): string =>
  `${JSON.stringify({ result: text, type: "result" })}\n`;

const ENVELOPE_SCHEMA = {
  additionalProperties: false,
  properties: {
    audit_id: { type: "string" },
    completed_at: { type: "string" },
    result: { type: "object" }
  },
  required: ["audit_id", "completed_at", "result"],
  type: "object"
} as const;

const FULL_ENVELOPE = {
  audit_id: "AUD-002",
  completed_at: "2026-08-18T14:30:00Z",
  result: {
    checklist: [{ check_id: "DB-089", notes: "tek", strength_ids: [] }],
    substage: "D15-Database"
  }
};

describe("provider stream parsing across split assistant messages", () => {
  it("recovers a JSON document split cleanly across two assistant events", () => {
    const fullText = `\`\`\`json\n${JSON.stringify(FULL_ENVELOPE)}\n\`\`\``;
    const splitAt = Math.floor(fullText.length / 2);
    const chunks = [
      chunk(assistantEvent(fullText.slice(0, splitAt))),
      chunk(assistantEvent(fullText.slice(splitAt))),
      chunk(resultEvent(fullText.slice(splitAt)))
    ];

    expect(
      parseLastJsonObject(chunks, PROVIDER_IDS.claudeCode, ENVELOPE_SCHEMA)
    ).toStrictEqual(FULL_ENVELOPE);
  });

  it("repairs a max-output-token seam where the continuation re-emits the interrupted token", () => {
    // Field-observed shape: part one ends with the opening quote of the next
    // key (`..."strength_ids": [], "`), the continuation re-emits the full key
    // (`"notes": ...`). A naive join doubles the quote and breaks JSON.parse.
    const json = JSON.stringify(FULL_ENVELOPE);
    const seamKey = '"notes"';
    const seamIndex = json.indexOf(seamKey);
    const partOne = `\`\`\`json\n${json.slice(0, seamIndex + 1)}`; // ends with dangling `"`
    const partTwo = `${json.slice(seamIndex)}\n\`\`\``; // re-emits `"notes": ...`

    const chunks = [
      chunk(assistantEvent(partOne)),
      chunk(assistantEvent(partTwo)),
      chunk(resultEvent(partTwo))
    ];

    expect(
      parseLastJsonObject(chunks, PROVIDER_IDS.claudeCode, ENVELOPE_SCHEMA)
    ).toStrictEqual(FULL_ENVELOPE);
  });

  it("repairs a seam where the continuation re-emits a partial key name", () => {
    const json = JSON.stringify(FULL_ENVELOPE);
    const seamKey = '"completed_at"';
    const seamIndex = json.indexOf(seamKey);
    // Part one got cut a few characters into the key; the continuation
    // restarts the key from its beginning.
    const partOne = `\`\`\`json\n${json.slice(0, seamIndex + 5)}`;
    const partTwo = `${json.slice(seamIndex)}\n\`\`\``;

    const chunks = [chunk(assistantEvent(partOne)), chunk(assistantEvent(partTwo))];

    expect(
      parseLastJsonObject(chunks, PROVIDER_IDS.claudeCode, ENVELOPE_SCHEMA)
    ).toStrictEqual(FULL_ENVELOPE);
  });

  it("still parses a single unsplit assistant message", () => {
    const chunks = [
      chunk(assistantEvent(`\`\`\`json\n${JSON.stringify(FULL_ENVELOPE)}\n\`\`\``))
    ];

    expect(
      parseLastJsonObject(chunks, PROVIDER_IDS.claudeCode, ENVELOPE_SCHEMA)
    ).toStrictEqual(FULL_ENVELOPE);
  });
});
