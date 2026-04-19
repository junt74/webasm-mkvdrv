import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    outDir: "dist-engine",
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, "src/engine-entry.ts"),
      name: "MkvdrvGameAudioEngine",
      fileName: "mkvdrv-game-audio-engine",
      formats: ["es"]
    }
  }
});
