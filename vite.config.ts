import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

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
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Deno tests under supabase/functions/_shared use `Deno.test` + https:
    // imports and are run via `deno test`, not vitest. Exclude them here.
    exclude: ["**/node_modules/**", "**/dist/**", "supabase/functions/**", ".claude/**"],
  },
});
