import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMeetingDescription,
  buildMeetingTaskName,
  extractMeetUrl,
  meetingSprintPoints,
  sastLocalToIso,
} from "./meeting-logic.ts";

Deno.test("sastLocalToIso appends :00 seconds + the +02:00 SAST offset", () => {
  assertEquals(sastLocalToIso("2026-08-01T10:00"), "2026-08-01T10:00:00+02:00");
});

Deno.test("sastLocalToIso preserves explicit seconds", () => {
  assertEquals(sastLocalToIso("2026-08-01T10:00:30"), "2026-08-01T10:00:30+02:00");
});

Deno.test("sastLocalToIso has no DST variance across summer/winter dates", () => {
  // SAST is fixed +02:00 year-round — a January (SA summer) and a June (SA
  // winter) datetime must both get the same offset.
  assertEquals(sastLocalToIso("2026-01-15T09:00"), "2026-01-15T09:00:00+02:00");
  assertEquals(sastLocalToIso("2026-06-15T09:00"), "2026-06-15T09:00:00+02:00");
});

Deno.test("sastLocalToIso rejects a malformed input", () => {
  assertThrows(() => sastLocalToIso("not-a-datetime"));
});

Deno.test("meetingSprintPoints converts a clean 15-minute multiple", () => {
  assertEquals(
    meetingSprintPoints("2026-08-01T10:00:00+02:00", "2026-08-01T10:30:00+02:00"),
    2,
  );
});

Deno.test("meetingSprintPoints rounds to the nearest quarter point", () => {
  // 50 minutes / 15 = 3.333... -> nearest quarter = 3.25
  assertEquals(
    meetingSprintPoints("2026-08-01T10:00:00+02:00", "2026-08-01T10:50:00+02:00"),
    3.25,
  );
});

Deno.test("meetingSprintPoints floors at 1 point for a short meeting", () => {
  // 5 minutes / 15 = 0.333... -> nearest quarter = 0.25 -> floored to 1
  assertEquals(
    meetingSprintPoints("2026-08-01T10:00:00+02:00", "2026-08-01T10:05:00+02:00"),
    1,
  );
});

Deno.test("buildMeetingTaskName formats [Meeting] {client} — {title}", () => {
  assertEquals(buildMeetingTaskName("Acme", "Weekly sync"), "[Meeting] Acme — Weekly sync");
});

Deno.test("extractMeetUrl prefers hangoutLink when present", () => {
  const event = {
    hangoutLink: "https://meet.google.com/abc-defg-hij",
    conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/other" }] },
  };
  assertEquals(extractMeetUrl(event), "https://meet.google.com/abc-defg-hij");
});

Deno.test("extractMeetUrl falls back to the video entryPoint when hangoutLink is absent", () => {
  const event = {
    conferenceData: {
      entryPoints: [
        { entryPointType: "phone", uri: "tel:+27000000" },
        { entryPointType: "video", uri: "https://meet.google.com/xyz-defg-hij" },
      ],
    },
  };
  assertEquals(extractMeetUrl(event), "https://meet.google.com/xyz-defg-hij");
});

Deno.test("extractMeetUrl returns null when neither hangoutLink nor a video entryPoint exists", () => {
  assertEquals(extractMeetUrl({ conferenceData: { entryPoints: [{ entryPointType: "phone", uri: "tel:+27" }] } }), null);
  assertEquals(extractMeetUrl({}), null);
  assertEquals(extractMeetUrl(null), null);
  assertEquals(extractMeetUrl(undefined), null);
});

Deno.test("buildMeetingDescription includes the project when given", () => {
  const desc = buildMeetingDescription({
    title: "Weekly sync",
    agenda: "Review sprint burn",
    clientName: "Acme",
    projectName: "Website Revamp",
    attendeeNames: ["Brendan", "Lisa"],
    meetUrl: "https://meet.google.com/abc-defg-hij",
    meetingId: "m-1",
  });
  assertEquals(desc.startsWith("Weekly sync — Acme / Website Revamp"), true);
  assertEquals(desc.includes("Agenda:"), true);
  assertEquals(desc.includes("Review sprint burn"), true);
  assertEquals(desc.includes("Attendees: Brendan, Lisa"), true);
  assertEquals(desc.includes("Join: https://meet.google.com/abc-defg-hij"), true);
  assertEquals(desc.includes("internal meeting m-1"), true);
});

Deno.test("buildMeetingDescription omits the project slash when there is no project", () => {
  const desc = buildMeetingDescription({
    title: "Weekly sync",
    agenda: null,
    clientName: "Acme",
    projectName: null,
    attendeeNames: [],
    meetUrl: null,
    meetingId: "m-2",
  });
  assertEquals(desc.startsWith("Weekly sync — Acme\n"), true);
  assertEquals(desc.includes("/"), false);
  assertEquals(desc.includes("Agenda:"), false);
  assertEquals(desc.includes("Attendees:"), false);
  assertEquals(desc.includes("Join:"), false);
});
