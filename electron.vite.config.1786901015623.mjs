// electron.vite.config.ts
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
var __electron_vite_injected_dirname = "C:\\Github\\ForgePilot";
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__electron_vite_injected_dirname, "src/main/app/main.ts"),
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs"
        }
      }
    },
    resolve: {
      alias: {
        "@main": resolve(__electron_vite_injected_dirname, "src/main"),
        "@services": resolve(__electron_vite_injected_dirname, "src/services"),
        "@shared": resolve(__electron_vite_injected_dirname, "src/shared")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__electron_vite_injected_dirname, "src/preload/index.ts"),
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs"
        }
      }
    },
    resolve: {
      alias: {
        "@preload": resolve(__electron_vite_injected_dirname, "src/preload"),
        "@shared": resolve(__electron_vite_injected_dirname, "src/shared")
      }
    }
  },
  renderer: {
    root: "src/renderer",
    plugins: [react()],
    resolve: {
      alias: {
        "@renderer": resolve(__electron_vite_injected_dirname, "src/renderer/src"),
        "@shared": resolve(__electron_vite_injected_dirname, "src/shared")
      }
    }
  }
});
export {
  electron_vite_config_default as default
};
