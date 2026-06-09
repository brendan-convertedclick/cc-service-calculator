import "@testing-library/jest-dom/vitest";

// Stub Supabase env vars so any transitive import of `@/lib/supabase`
// from a component under test does not throw. Tests that exercise
// supabase calls must still mock the client itself.
import.meta.env.VITE_SUPABASE_URL ??= "http://test.local";
import.meta.env.VITE_SUPABASE_ANON_KEY ??= "test-anon-key";

// jsdom lacks ResizeObserver and scrollIntoView; cmdk (Command/MultiSelect)
// requires both at mount.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};
