import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// outDir MUST point at the folder FastAPI serves from (backend/static).
// emptyOutDir clears stale bundles so old JS can never be served.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:8000" } },
  build: { outDir: "../backend/static", emptyOutDir: true },
});
