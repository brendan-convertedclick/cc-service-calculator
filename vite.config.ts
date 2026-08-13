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
    proxy: {
      // The MCP server (mcp-server/src/http.ts) is its own process on 8787.
      // Proxying it here means the tunnel already fronting this dev server
      // also serves /mcp, so a teammate's client has one https URL to point at
      // and there is no second hostname or DNS record to keep alive. Returns
      // 502 when that process isn't running, which is the honest answer.
      "/mcp": {
        target: `http://localhost:${env.MCP_HTTP_PORT ?? 8787}`,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/mcp/, "") || "/",
      },
    },
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
