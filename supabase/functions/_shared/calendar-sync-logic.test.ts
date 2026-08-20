import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyEvent,
  type CalendarEventLike,
  type ClassifyContext,
  emailDomain,
  eventHours,
  internalDomainsFrom,
  pickOrganiser,
  pickRetainerProject,
  resolveClient,
} from "./calendar-sync-logic.ts";

const STAFF = ["brendan@convertedclick.co.za", "lisa@convertedclick.co.za"];

function ctx(over: Partial<ClassifyContext> = {}): ClassifyContext {
  return {
    calendarOwnerEmail: "brendan@convertedclick.co.za",
    staffEmails: STAFF,
    ...over,
  };
}

function ev(over: Partial<CalendarEventLike> = {}): CalendarEventLike {
  return {
    id: "evt1",
    status: "confirmed",
    summary: "WIP",
    start: { dateTime: "2026-08-20T09:00:00+02:00" },
    end: { dateTime: "2026-08-20T10:00:00+02:00" },
    ...over,
  };
}

// ── domains ──────────────────────────────────────────────────────────────

Deno.test("emailDomain lowercases and handles junk", () => {
  assertEquals(emailDomain("Someone@Example.CO.ZA"), "example.co.za");
  assertEquals(emailDomain("no-at-sign"), null);
  assertEquals(emailDomain("trailing@"), null);
  assertEquals(emailDomain(null), null);
});

Deno.test("internalDomainsFrom collapses our addresses to their domains", () => {
  assertEquals([...internalDomainsFrom(STAFF)], ["convertedclick.co.za"]);
});

Deno.test("eventHours never returns a negative or NaN", () => {
  assertEquals(eventHours("2026-08-20T09:00:00Z", "2026-08-20T10:30:00Z"), 1.5);
  assertEquals(eventHours("2026-08-20T10:00:00Z", "2026-08-20T09:00:00Z"), 0);
  assertEquals(eventHours("nonsense", "2026-08-20T09:00:00Z"), 0);
});

// ── skips ────────────────────────────────────────────────────────────────

Deno.test("all-day events are skipped", () => {
  const r = classifyEvent(ev({ start: { date: "2026-08-20" }, end: { date: "2026-08-21" } }), ctx());
  assertEquals(r.kind, "skip");
});

Deno.test("a cancelled event reports itself so the stored row can be closed", () => {
  const r = classifyEvent(ev({ status: "cancelled" }), ctx());
  assertEquals(r, { kind: "cancelled", eventId: "evt1" });
});

Deno.test("staff-only events are skipped — no domain to attribute by", () => {
  const r = classifyEvent(
    ev({ attendees: [{ email: "brendan@convertedclick.co.za", responseStatus: "accepted" }] }),
    ctx(),
  );
  assertEquals(r.kind, "skip");
});

Deno.test("a staff-only event Conductor created is still processed, for RSVPs", () => {
  const r = classifyEvent(
    ev({ attendees: [{ email: "lisa@convertedclick.co.za", responseStatus: "accepted" }] }),
    ctx({ knownEventIds: new Set(["evt1"]) }),
  );
  assertEquals(r.kind, "event");
  if (r.kind === "event") assertEquals(r.event.meetingType, "internal");
});

Deno.test("an event nobody of ours is on is skipped", () => {
  const r = classifyEvent(
    ev({ attendees: [{ email: "someone@else.com", responseStatus: "accepted" }] }),
    ctx({ calendarOwnerEmail: "shared-room@notus.com" }),
  );
  assertEquals(r.kind, "skip");
});

// ── the RSVP rule ────────────────────────────────────────────────────────

Deno.test("no response counts as attending; only an outright decline does not", () => {
  const r = classifyEvent(
    ev({
      attendees: [
        { email: "brendan@convertedclick.co.za", responseStatus: "needsAction" },
        { email: "kate@acme.com", responseStatus: "accepted" },
      ],
    }),
    ctx(),
  );
  assertEquals(r.kind, "event");
  if (r.kind === "event") {
    assertEquals(r.event.staff, [{ email: "brendan@convertedclick.co.za", responseStatus: "needsAction" }]);
  }
});

Deno.test("tentative counts as attending", () => {
  const r = classifyEvent(
    ev({
      attendees: [
        { email: "brendan@convertedclick.co.za", responseStatus: "tentative" },
        { email: "kate@acme.com", responseStatus: "accepted" },
      ],
    }),
    ctx(),
  );
  assertEquals(r.kind, "event");
});

Deno.test("an event our whole team declined is skipped", () => {
  const r = classifyEvent(
    ev({
      attendees: [
        { email: "brendan@convertedclick.co.za", responseStatus: "declined" },
        { email: "lisa@convertedclick.co.za", responseStatus: "declined" },
        { email: "kate@acme.com", responseStatus: "accepted" },
      ],
    }),
    ctx(),
  );
  assertEquals(r.kind, "skip");
});

Deno.test("one decline does not remove the colleagues who did attend", () => {
  const r = classifyEvent(
    ev({
      attendees: [
        { email: "brendan@convertedclick.co.za", responseStatus: "declined" },
        { email: "lisa@convertedclick.co.za", responseStatus: "accepted" },
        { email: "kate@acme.com", responseStatus: "accepted" },
      ],
    }),
    ctx(),
  );
  assertEquals(r.kind, "event");
  if (r.kind === "event") assertEquals(r.event.staff.length, 2);
});

// ── external identification ──────────────────────────────────────────────

Deno.test("a client invite yields the external domain and reads as a client meeting", () => {
  const r = classifyEvent(
    ev({
      organizer: { email: "Kate@Acme.com" },
      attendees: [
        { email: "kate@acme.com", responseStatus: "accepted" },
        { email: "brendan@convertedclick.co.za", responseStatus: "needsAction" },
      ],
    }),
    ctx(),
  );
  assertEquals(r.kind, "event");
  if (r.kind === "event") {
    assertEquals(r.event.meetingType, "client");
    assertEquals(r.event.externalDomains, ["acme.com"]);
    assertEquals(r.event.organiserEmail, "kate@acme.com");
    assertEquals(r.event.hours, 1);
  }
});

Deno.test("an external organiser missing from the attendee list still counts", () => {
  const r = classifyEvent(
    ev({
      organizer: { email: "kate@acme.com" },
      attendees: [{ email: "brendan@convertedclick.co.za", responseStatus: "accepted" }],
    }),
    ctx(),
  );
  assertEquals(r.kind, "event");
  if (r.kind === "event") assertEquals(r.event.externalDomains, ["acme.com"]);
});

Deno.test("freemail is external but never offered as a mappable domain", () => {
  const r = classifyEvent(
    ev({
      attendees: [
        { email: "brendan@convertedclick.co.za", responseStatus: "accepted" },
        { email: "someone@gmail.com", responseStatus: "accepted" },
      ],
    }),
    ctx(),
  );
  assertEquals(r.kind, "event");
  if (r.kind === "event") {
    assertEquals(r.event.meetingType, "client");
    assertEquals(r.event.externalDomains, []);
    assertEquals(r.event.externalEmails, ["someone@gmail.com"]);
  }
});

Deno.test("meeting rooms are not people and consume no time", () => {
  const r = classifyEvent(
    ev({
      attendees: [
        { email: "brendan@convertedclick.co.za", responseStatus: "accepted" },
        { email: "boardroom@resource.calendar.google.com", resource: true },
        { email: "kate@acme.com", responseStatus: "accepted" },
      ],
    }),
    ctx(),
  );
  assertEquals(r.kind, "event");
  if (r.kind === "event") {
    assertEquals(r.event.staff.length, 1);
    assertEquals(r.event.externalDomains, ["acme.com"]);
  }
});

Deno.test("a solo blocked-out hour with an external organiser still attributes", () => {
  const r = classifyEvent(
    ev({ organizer: { email: "kate@acme.com" }, attendees: undefined }),
    ctx(),
  );
  assertEquals(r.kind, "event");
  if (r.kind === "event") {
    assertEquals(r.event.staff, [{ email: "brendan@convertedclick.co.za", responseStatus: "accepted" }]);
  }
});

// ── attribution ──────────────────────────────────────────────────────────

Deno.test("resolveClient takes the first domain that maps and reports which", () => {
  const map = new Map([["acme.com", "client-1"]]);
  assertEquals(resolveClient(["printers.co", "acme.com"], map), {
    clientId: "client-1",
    domain: "acme.com",
  });
  assertEquals(resolveClient(["nobody.com"], map), null);
});

Deno.test("pickRetainerProject: one live retainer is the answer", () => {
  assertEquals(
    pickRetainerProject([{ id: "p1", retainer_monthly_fee_cents: 1000, created_at: "2026-01-01" }]),
    "p1",
  );
  assertEquals(pickRetainerProject([]), null);
});

Deno.test("pickRetainerProject: biggest fee wins when a client has several", () => {
  assertEquals(
    pickRetainerProject([
      { id: "small", retainer_monthly_fee_cents: 500_000, created_at: "2026-01-01" },
      { id: "big", retainer_monthly_fee_cents: 2_450_000, created_at: "2026-05-01" },
    ]),
    "big",
  );
});

Deno.test("pickRetainerProject: ties break to the oldest, then the id — never wobbles", () => {
  const rows = [
    { id: "b", retainer_monthly_fee_cents: 100, created_at: "2026-03-01" },
    { id: "a", retainer_monthly_fee_cents: 100, created_at: "2026-01-01" },
  ];
  assertEquals(pickRetainerProject(rows), "a");
  assertEquals(pickRetainerProject([...rows].reverse()), "a");

  const sameDay = [
    { id: "zzz", retainer_monthly_fee_cents: 100, created_at: "2026-01-01" },
    { id: "aaa", retainer_monthly_fee_cents: 100, created_at: "2026-01-01" },
  ];
  assertEquals(pickRetainerProject(sameDay), "aaa");
  assertEquals(pickRetainerProject([...sameDay].reverse()), "aaa");
});

Deno.test("pickRetainerProject treats a missing fee as zero, not as a winner", () => {
  assertEquals(
    pickRetainerProject([
      { id: "unpriced", retainer_monthly_fee_cents: null, created_at: "2026-01-01" },
      { id: "priced", retainer_monthly_fee_cents: 1, created_at: "2026-02-01" },
    ]),
    "priced",
  );
});

// ── organiser slot ───────────────────────────────────────────────────────

const MEMBERS = new Map([
  ["brendan@convertedclick.co.za", "m-brendan"],
  ["lisa@convertedclick.co.za", "m-lisa"],
]);

Deno.test("pickOrganiser prefers the real organiser when they are one of ours", () => {
  assertEquals(
    pickOrganiser(
      [{ email: "brendan@convertedclick.co.za", responseStatus: "accepted" }],
      "lisa@convertedclick.co.za",
      MEMBERS,
    ),
    "m-lisa",
  );
});

Deno.test("pickOrganiser falls back to a stable staff attendee for a client-run meeting", () => {
  const staff = [
    { email: "lisa@convertedclick.co.za", responseStatus: "accepted" },
    { email: "brendan@convertedclick.co.za", responseStatus: "accepted" },
  ];
  assertEquals(pickOrganiser(staff, "kate@acme.com", MEMBERS), "m-brendan");
  assertEquals(pickOrganiser([...staff].reverse(), "kate@acme.com", MEMBERS), "m-brendan");
});

Deno.test("pickOrganiser returns null when nobody resolves to a member row", () => {
  assertEquals(pickOrganiser([{ email: "ghost@convertedclick.co.za", responseStatus: "accepted" }], null, MEMBERS), null);
});
