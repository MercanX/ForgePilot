import { DEFAULT_LOCALE } from "@shared/constants/locales";
import { languagePackManifestSchema, translationFileSchema } from "@shared/schemas/language-pack";

import { languagePackManifestFixture } from "./fixtures";

describe("language pack schemas", () => {
  it("accepts signed external language pack manifests", () => {
    expect(languagePackManifestSchema.parse(languagePackManifestFixture)).toEqual(
      languagePackManifestFixture
    );
  });

  it("rejects installing bundled en-US as a language pack", () => {
    expect(() =>
      languagePackManifestSchema.parse({
        ...languagePackManifestFixture,
        id: DEFAULT_LOCALE
      })
    ).toThrow();
  });

  it("allows JSON translation files with string values only", () => {
    expect(translationFileSchema.parse({ "app.title": "ForgePilot" })).toEqual({
      "app.title": "ForgePilot"
    });
    expect(() => translationFileSchema.parse({ "app.title": { nested: "no" } })).toThrow();
  });
});
