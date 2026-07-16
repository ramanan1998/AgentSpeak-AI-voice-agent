import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Build output goes to web/dist, which server.py serves at "/".
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    // During `npm run dev`, the app talks to server.py at :8000 (CORS is open there).
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
