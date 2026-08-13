import type { BrowserWindow, Event } from "electron";

const isAllowedNavigation = (url: string): boolean => {
  return url.startsWith("file://") || url.startsWith("http://localhost:");
};

export const installNavigationGuard = (window: BrowserWindow): void => {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  window.webContents.on("will-navigate", (event: Event, url: string) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault();
    }
  });
};
