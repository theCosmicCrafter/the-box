import { defineConfig } from "electron-vite";

export default defineConfig({
  main: {
    build: {
      outDir: "out/main",
    },
  },
  preload: {
    build: {
      outDir: "out/preload",
      rollupOptions: {
        output: {
          // Sandboxed preload scripts must be CJS - ESM preloads silently
          // fail to load, leaving window.box undefined and every bridge
          // call a silent no-op.
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    esbuild: { jsx: "automatic" },
    build: {
      outDir: "out/renderer",
    },
  },
});
