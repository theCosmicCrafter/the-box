import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri serves the renderer: vite is a plain web build now (no electron
// main/preload bundles). Root stays at src/renderer so no file moves.
export default defineConfig({
  root: "src/renderer",
  plugins: [react()],
  build: {
    outDir: "../../out/renderer",
    emptyOutDir: true,
    target: "es2022",
  },
  server: { port: 5173, strictPort: true },
  clearScreen: false,
  // Tauri requires env access via import.meta.env only - no .env loading
  envPrefix: ["VITE_", "TAURI_"],
});
