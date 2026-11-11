import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { bucketCounts, bucketOf, typeLabelFor, workBucketOf } from "./client-buckets.ts";
import type { BucketItem } from "./client-buckets.ts";

const pendingClient: BucketItem = {
  state: "pending",
  owed_by: "client",
  court: null,
  item_type: "brief",
};

Deno.test("bucketOf: pending and owed by the client is their move", () => {
  assertEquals(bucketOf(pendingClient), "your-move");
});

Deno.test("bucketOf: an agreement we owe sits with us", () => {
  assertEquals(bucketOf({ ...pendingClient, item_type: "agreement", owed_by: "us" }), "with-us");
});

Deno.test("bucketOf: a linked task in our court sits with us", () => {
  assertEquals(bucketOf({ ...pendingClient, court: "us" }), "with-us");
});

Deno.test("bucketOf: noted is coming up, changes_requested is with us, approved is signed off", () => {
  assertEquals(bucketOf({ ...pendingClient, state: "noted" }), "coming-up");
  assertEquals(bucketOf({ ...pendingClient, state: "changes_requested" }), "with-us");
  assertEquals(bucketOf({ ...pendingClient, state: "approved" }), "signed-off");
});

Deno.test("workBucketOf: client court is their move, anything else is ours", () => {
  assertEquals(workBucketOf({ court: "client" }), "your-move");
  assertEquals(workBucketOf({ court: "done" }), "with-us");
});

Deno.test("bucketCounts counts items and work together", () => {
  const counts = bucketCounts(
    [pendingClient, { ...pendingClient, state: "approved" }],
    [{ court: "client" }],
  );
  assertEquals(counts["your-move"], 2);
  assertEquals(counts["signed-off"], 1);
  assertEquals(counts["with-us"], 0);
  assertEquals(counts["coming-up"], 0);
});

Deno.test("typeLabelFor reads from the client's side of who asked", () => {
  assertEquals(typeLabelFor({ ...pendingClient, item_type: "question", raised_by: "client" }), "You asked");
  assertEquals(typeLabelFor({ ...pendingClient, item_type: "question", raised_by: "us" }), "Question");
  assertEquals(typeLabelFor({ ...pendingClient, item_type: "agreement", owed_by: "us" }), "We agreed");
  assertEquals(typeLabelFor(pendingClient), "Sign-off");
});
