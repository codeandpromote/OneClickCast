import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json" with { type: "json" };

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    define: {
      "import.meta.env.VITE_VIEWER_BASE_URL": JSON.stringify(
        env.VITE_VIEWER_BASE_URL ?? "https://oneclickcast.pages.dev/room",
      ),
      "import.meta.env.VITE_SIGNALING_URL": JSON.stringify(
        env.VITE_SIGNALING_URL ?? "wss://oneclickcast-signaling.workers.dev",
      ),
    },
    plugins: [react(), crx({ manifest })],
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: {
          popup: "src/popup/index.html",
          offscreen: "src/offscreen/offscreen.html",
        },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      hmr: { port: 5173 },
    },
  };
});
