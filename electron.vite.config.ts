import { resolve } from "node:path";

import { defineConfig, externalizeDepsPlugin } from "electron-vite";

import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/main/app/main.ts"),
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs"
        }
      }
    },
    resolve: {
      alias: {
        "@main": resolve(__dirname, "src/main"),
        "@services": resolve(__dirname, "src/services"),
        "@shared": resolve(__dirname, "src/shared")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/preload/index.ts"),
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs"
        }
      }
    },
    resolve: {
      alias: {
        "@preload": resolve(__dirname, "src/preload"),
        "@shared": resolve(__dirname, "src/shared")
      }
    }
  },
  renderer: {
    root: "src/renderer",
    plugins: [react()],
    resolve: {
      alias: {
        "@renderer": resolve(__dirname, "src/renderer/src"),
        "@shared": resolve(__dirname, "src/shared")
      }
    }
  }
});
