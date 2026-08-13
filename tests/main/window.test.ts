import { getDefaultWebPreferences } from "@main/app/window";

describe("main window security defaults", () => {
  it("keeps renderer capabilities constrained", () => {
    const preferences = getDefaultWebPreferences("preload.js");

    expect(preferences.contextIsolation).toBe(true);
    expect(preferences.nodeIntegration).toBe(false);
    expect(preferences.sandbox).toBe(true);
    expect(preferences.webSecurity).toBe(true);
  });
});
