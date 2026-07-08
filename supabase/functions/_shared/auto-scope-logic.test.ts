// Run with: deno test supabase/functions/_shared/auto-scope-logic.test.ts
import { assert, assertEquals } from "jsr:@std/assert";
import {
  parseQuickResponseRules,
  matchesQuickResponseRule,
  parseClassifyResponse,
  parseScopeJson,
  CLASSIFY_SYSTEM,
  buildScopeSystem,
} from "./auto-scope-logic.ts";

// --- parseQuickResponseRules ---

Deno.test("parseQuickResponseRules: extracts bullet items from markdown", () => {
  const md = `# Config\n\n## Subject rules\n\n- reschedule\n- rescheduling\n\n## Other\n\n- following up\n`;
  const rules = parseQuickResponseRules(md);
  assertEquals(rules, ["reschedule", "rescheduling", "following up"]);
});

Deno.test("parseQuickResponseRules: returns empty array for empty string", () => {
  assertEquals(parseQuickResponseRules(""), []);
});

Deno.test("parseQuickResponseRules: trims whitespace from rules", () => {
  const md = `-  reschedule  \n-  rescheduling  `;
  const rules = parseQuickResponseRules(md);
  assertEquals(rules, ["reschedule", "rescheduling"]);
});

// --- matchesQuickResponseRule ---

Deno.test("matchesQuickResponseRule: matches keyword in subject (case-insensitive)", () => {
  const rules = ["reschedule"];
  assertEquals(matchesQuickResponseRule("Can we Reschedule?", "body text", rules), true);
});

Deno.test("matchesQuickResponseRule: matches keyword in body", () => {
  const rules = ["following up"];
  assertEquals(matchesQuickResponseRule("Hello", "Just following up on our call", rules), true);
});

Deno.test("matchesQuickResponseRule: no match returns false", () => {
  const rules = ["reschedule"];
  assertEquals(matchesQuickResponseRule("New website project", "Please see attached brief", rules), false);
});

Deno.test("matchesQuickResponseRule: empty rules returns false", () => {
  assertEquals(matchesQuickResponseRule("Reschedule", "body", []), false);
});

// --- parseClassifyResponse ---

Deno.test("parseClassifyResponse: extracts intent_type from JSON", () => {
  const text = `{"intent_type":"new_brief","reasoning":"Client is requesting a new website"}`;
  assertEquals(parseClassifyResponse(text), "new_brief");
});

Deno.test("parseClassifyResponse: handles JSON embedded in prose", () => {
  const text = `Here is the result:\n{"intent_type":"project_thread","reasoning":"References current project"}`;
  assertEquals(parseClassifyResponse(text), "project_thread");
});

Deno.test("parseClassifyResponse: returns new_brief as fallback on invalid JSON", () => {
  assertEquals(parseClassifyResponse("not json at all"), "new_brief");
});

Deno.test("parseClassifyResponse: returns new_brief when intent_type is unrecognised", () => {
  const text = `{"intent_type":"unknown_type","reasoning":"..."}`;
  assertEquals(parseClassifyResponse(text), "new_brief");
});

// --- parseScopeJson ---

Deno.test("parseScopeJson: parses standard scope response", () => {
  const text = `{"enhanced_prose":"Summary","in_scope":["Item A"],"out_of_scope":[],"open_questions":["Q1"]}`;
  const result = parseScopeJson(text);
  assertEquals(result.enhanced_prose, "Summary");
  assertEquals(result.in_scope, ["Item A"]);
  assertEquals(result.open_questions, ["Q1"]);
});

Deno.test("parseScopeJson: parses quick_response draft_reply", () => {
  const text = `{"draft_reply":"Thank you for reaching out, we will be in touch shortly."}`;
  const result = parseScopeJson(text);
  assertEquals(result.draft_reply, "Thank you for reaching out, we will be in touch shortly.");
});

Deno.test("parseScopeJson: returns empty object on invalid JSON", () => {
  const result = parseScopeJson("not json");
  assertEquals(Object.keys(result).length, 0);
});

// --- quick_task bucket ---

Deno.test("parseClassifyResponse recognises quick_task", () => {
  assertEquals(parseClassifyResponse("quick_task"), "quick_task");
  assertEquals(parseClassifyResponse("  QUICK_TASK  "), "quick_task");
});

Deno.test("CLASSIFY_SYSTEM documents the quick_task bucket", () => {
  assert(CLASSIFY_SYSTEM.includes("quick_task"));
  assert(/one concrete|single deliverable|just do/i.test(CLASSIFY_SYSTEM));
});

Deno.test("buildScopeSystem for quick_task asks for a suggestion object", () => {
  const sys = buildScopeSystem("quick_task");
  assert(/sprint_points/.test(sys));
  assert(/work_stream/.test(sys));
});
