import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { swapRevisionSuffix } from "./revision-logic.ts";

Deno.test("swapRevisionSuffix replaces a trailing DFT marker", () => {
  assertEquals(
    swapRevisionSuffix("Conductor - Visual Explainer Doc - DFT V1.1", "REV V1.1"),
    "Conductor - Visual Explainer Doc - REV V1.1",
  );
});

Deno.test("swapRevisionSuffix preserves trailing annotations after the marker", () => {
  assertEquals(
    swapRevisionSuffix(
      "Dovetail RSA - The Ultimate Guide: Landing Page Build - July 2026 - DFT V1.1 (QC)",
      "DFT V2.1",
    ),
    "Dovetail RSA - The Ultimate Guide: Landing Page Build - July 2026 - DFT V2.1 (QC)",
  );
});

Deno.test("swapRevisionSuffix handles a REV-without-V marker", () => {
  assertEquals(
    swapRevisionSuffix("Client - Task - REV 2.1", "DFT V2.2"),
    "Client - Task - DFT V2.2",
  );
});

Deno.test("swapRevisionSuffix appends when no marker exists", () => {
  assertEquals(
    swapRevisionSuffix("Client - Task with no suffix", "DFT V2.1"),
    "Client - Task with no suffix - DFT V2.1",
  );
});

Deno.test("swapRevisionSuffix only replaces the LAST marker if the name mentions DFT twice", () => {
  assertEquals(
    swapRevisionSuffix("DFT Media Client - Task - DFT V1.1", "REV V1.1"),
    "DFT Media Client - Task - REV V1.1",
  );
});
