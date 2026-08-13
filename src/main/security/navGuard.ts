import type { BrowserWindow, Event } from "electron";

export const isAllowedNavigation = (targetUrl: string): boolean => {
  try {
    const parsedUrl = new URL(targetUrl);

    if (parsedUrl.protocol === "file:") {
      return true;
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "ws:") {
      return false;
    }

    return parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1";
  } catch {
    return false;
  }
};

export const installNavigationGuard = (window: BrowserWindow): void => {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  window.webContents.on("will-navigate", (event: Event, url: string) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault();
    }
  });
};
