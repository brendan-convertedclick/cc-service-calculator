import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Stub Supabase env vars so any transitive import of `@/lib/supabase`
// from a component under test does not throw. Tests that exercise
// supabase calls must still mock the client itself.
// `import.meta.env.*` is readonly in Vite's types, so use vi.stubEnv
// instead of a direct assignment — same "only if unset" behaviour as
// the old `??=`, since a real .env.local value should win if present.
if (!import.meta.env.VITE_SUPABASE_URL) {
  vi.stubEnv("VITE_SUPABASE_URL", "http://test.local");
}
if (!import.meta.env.VITE_SUPABASE_ANON_KEY) {
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-anon-key");
}

// jsdom lacks ResizeObserver and scrollIntoView; cmdk (Command/MultiSelect)
// requires both at mount.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};
