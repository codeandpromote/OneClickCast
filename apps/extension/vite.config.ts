import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json" with { type: "json" };

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const WEB_BASE_DEFAULT =
    "https://oneclickcast.info-codeandpromote.workers.dev";
  const SIGNALING_DEFAULT =
    "wss://oneclickcast-signaling.info-codeandpromote.workers.dev";
  return {
    define: {
      "import.meta.env.VITE_WEB_BASE_URL": JSON.stringify(
        env.VITE_WEB_BASE_URL ?? WEB_BASE_DEFAULT,
      ),
      "import.meta.env.VITE_VIEWER_BASE_URL": JSON.stringify(
        env.VITE_VIEWER_BASE_URL ?? `${WEB_BASE_DEFAULT}/room`,
      ),
      "import.meta.env.VITE_SIGNALING_URL": JSON.stringify(
        env.VITE_SIGNALING_URL ?? SIGNALING_DEFAULT,
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
