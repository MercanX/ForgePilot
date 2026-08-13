import electron, { type BrowserWindow as ElectronBrowserWindow } from "electron";

import { isDev } from "@main/app/runtime";
import { createMainWindow } from "@main/app/window";
import { registerAppIpc } from "@main/ipc/app";
import { registerProjectsIpc } from "@main/ipc/projects";
import { registerProvidersIpc } from "@main/ipc/providers";
import { registerSettingsIpc } from "@main/ipc/settings";
import { registerTasksIpc } from "@main/ipc/tasks";
import { applyContentSecurityPolicy } from "@main/security/csp";

const { app, BrowserWindow } = electron;

let mainWindow: ElectronBrowserWindow | null = null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.focus();
  });

  app
    .whenReady()
    .then(async () => {
      applyContentSecurityPolicy({
        allowDevServer: isDev()
      });
      registerAppIpc();
      registerProjectsIpc();
      registerProvidersIpc();
      registerSettingsIpc();
      registerTasksIpc();
      mainWindow = await createMainWindow({
        isDev: isDev(),
        openDevTools: process.env.FORGEPILOT_OPEN_DEVTOOLS === "1",
        rendererUrl: process.env.ELECTRON_RENDERER_URL
      });
    })
    .catch((error: unknown) => {
      console.error("Failed to create ForgePilot window", error);
      app.quit();
    });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow({
        isDev: isDev(),
        openDevTools: process.env.FORGEPILOT_OPEN_DEVTOOLS === "1",
        rendererUrl: process.env.ELECTRON_RENDERER_URL
      }).then((window) => {
        mainWindow = window;
      });
    }
  });
}
