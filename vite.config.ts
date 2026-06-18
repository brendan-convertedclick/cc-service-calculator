import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Extra hostnames the dev server should accept (e.g. a cloudflared tunnel
// fronting localhost:5174) come from DEV_ALLOWED_HOSTS in .env.local, so
// machine-specific hostnames never ship to the team. Comma-separated.
const env = loadEnv("development", process.cwd(), "");
const allowedHosts = (env.DEV_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    allowedHosts,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Deno tests under supabase/functions/_shared use `Deno.test` + https:
    // imports and are run via `deno test`, not vitest. Exclude them here.
    exclude: ["**/node_modules/**", "**/dist/**", "supabase/functions/**", ".claude/**", "e2e/**"],
  },
});
