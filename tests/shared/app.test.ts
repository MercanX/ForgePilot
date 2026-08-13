import { APP_NAME, APP_VERSION } from "@shared/constants/app";

describe("app constants", () => {
  it("exposes the desktop client identity", () => {
    expect(APP_NAME).toBe("ForgePilot");
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
