import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"]
  },
  resolve: {
    alias: {
      "@main": new URL("./src/main", import.meta.url).pathname,
      "@preload": new URL("./src/preload", import.meta.url).pathname,
      "@renderer": new URL("./src/renderer", import.meta.url).pathname,
      "@services": new URL("./src/services", import.meta.url).pathname,
      "@shared": new URL("./src/shared", import.meta.url).pathname
    }
  }
});
