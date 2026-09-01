import { describe, expect, it } from "vitest";
import { buildMessageEmail, buildQuestionEmail, escapeHtml } from "@/lib/client-email";
import { countStages } from "@/lib/client-stage-counts";

describe("buildQuestionEmail", () => {
  const base = {
    title: "Open Day mailer copy",
    question: "Which of the two headlines do you want us to run with?",
    url: "https://conductor.convertedclick.co.za/review/abc123",
  };

  it("names the person when we know who we are asking", () => {
    const mail = buildQuestionEmail({ ...base, contactName: "Asavela" });
    expect(mail.bodyText).toContain("Hi Asavela,");
    expect(mail.bodyHtml).toContain("Hi Asavela,");
  });

  it("greets on first name only — the full name is for the record, not the salutation", () => {
    const mail = buildQuestionEmail({ ...base, contactName: "Asavela Ludidi" });
    expect(mail.bodyText).toContain("Hi Asavela,");
    expect(mail.bodyText).not.toContain("Ludidi");
  });

  it("keeps a hyphenated first name whole", () => {
    expect(buildQuestionEmail({ ...base, contactName: "Mary-Anne Smith" }).bodyText).toContain(
      "Hi Mary-Anne,",
    );
  });

  it("falls back to a greeting that is not addressed to nobody", () => {
    expect(buildQuestionEmail(base).bodyText).toContain("Hi there,");
    expect(buildQuestionEmail({ ...base, contactName: "  " }).bodyText).toContain("Hi there,");
  });

  it("puts the link in both the text and the html part", () => {
    const mail = buildQuestionEmail(base);
    expect(mail.bodyText).toContain(base.url);
    expect(mail.bodyHtml).toContain(`href="${base.url}"`);
  });

  it("shows the URL once, as the button — not printed out underneath as well", () => {
    const mail = buildQuestionEmail(base);
    expect(mail.bodyHtml.split(base.url).length - 1).toBe(1);
    expect(mail.bodyHtml).not.toContain("paste this into your browser");
    // A text-only reader still gets a pasteable address, from the plain part.
    expect(mail.bodyText).toContain(base.url);
  });

  it("is pinned to 600px so it does not fill a wide reading pane", () => {
    const html = buildQuestionEmail(base).bodyHtml;
    // Attribute for Outlook's Word engine, CSS for everything else.
    expect(html).toContain('width="600"');
    expect(html).toContain("max-width:600px");
  });

  it("carries a due date in words, without a UTC day-slip", () => {
    const mail = buildQuestionEmail({ ...base, dueDate: "2026-09-01" });
    expect(mail.bodyText).toContain("1 September");
  });

  it("leaves the date sentence out entirely when there is no date", () => {
    expect(buildQuestionEmail(base).bodyText).not.toContain("We'd like to have it by");
  });

  it("escapes a question containing markup — it is free text going into HTML", () => {
    const mail = buildQuestionEmail({
      ...base,
      question: 'Do we keep the <script>alert("hi")</script> block?',
    });
    expect(mail.bodyHtml).not.toContain("<script>");
    expect(mail.bodyHtml).toContain("&lt;script&gt;");
    // the plain-text part is not HTML and must stay verbatim
    expect(mail.bodyText).toContain('<script>alert("hi")</script>');
  });

  it("keeps line breaks in a multi-line question readable in HTML", () => {
    const mail = buildQuestionEmail({ ...base, question: "One?\nTwo?" });
    expect(mail.bodyHtml).toContain("One?<br>Two?");
  });

  it("subjects the email with what it is about", () => {
    expect(buildQuestionEmail(base).subject).toBe("Quick question — Open Day mailer copy");
  });
});

describe("escapeHtml", () => {
  it("covers the four characters that break an attribute or a tag", () => {
    expect(escapeHtml('&<>"')).toBe("&amp;&lt;&gt;&quot;");
  });
});

describe("buildMessageEmail", () => {
  const base = {
    title: "Open Day mailer copy",
    message: "Just checking in — are we still good for Friday?",
    url: "https://conductor.convertedclick.co.za/review/abc123",
  };

  it("threads on the item, not on us — the subject is what it is about", () => {
    expect(buildMessageEmail(base).subject).toBe(
      "Open Day mailer copy — an update from Converted Click",
    );
  });

  it("carries the sign-off link in both parts", () => {
    const mail = buildMessageEmail(base);
    expect(mail.bodyText).toContain(base.url);
    expect(mail.bodyHtml).toContain(`href="${base.url}"`);
  });

  it("escapes a message containing markup, and leaves the text part verbatim", () => {
    const mail = buildMessageEmail({ ...base, message: "Use <b>bold</b>?" });
    expect(mail.bodyHtml).toContain("&lt;b&gt;");
    expect(mail.bodyHtml).not.toContain("<b>bold</b>");
    expect(mail.bodyText).toContain("Use <b>bold</b>?");
  });

  it("signs off as the company, never a person", () => {
    const mail = buildMessageEmail(base);
    expect(mail.bodyText).toContain("Converted Click");
    expect(mail.bodyText).not.toMatch(/Brendan|Lisa/);
  });
});

describe("the stage-counts reminder", () => {
  const base = {
    title: "Open Day mailer copy",
    question: "Which of the two headlines do you want us to run with?",
    url: "https://conductor.convertedclick.co.za/review/abc123",
  };
  const counts = { waitingOnYou: 3, withUs: 1, signedOff: 12, oldestDays: 32 };

  it("renders the three figures and their labels", () => {
    const mail = buildQuestionEmail({ ...base, counts });
    for (const bit of ["3", "Waiting on you", "1", "With us", "12", "Signed off"]) {
      expect(mail.bodyHtml).toContain(bit);
    }
  });

  it("carries the oldest-waiting line — the figure that actually moves people", () => {
    const mail = buildQuestionEmail({ ...base, counts });
    expect(mail.bodyHtml).toContain("The oldest has been waiting <strong>32 days</strong>.");
    expect(mail.bodyText).toContain("The oldest has been waiting 32 days.");
  });

  it("says day, not days, at one", () => {
    const mail = buildQuestionEmail({ ...base, counts: { ...counts, oldestDays: 1 } });
    expect(mail.bodyText).toContain("waiting 1 day.");
  });

  it("drops the oldest line when nothing is late or sitting", () => {
    const mail = buildQuestionEmail({ ...base, counts: { ...counts, oldestDays: 0 } });
    expect(mail.bodyHtml).toContain("Waiting on you");
    expect(mail.bodyHtml).not.toContain("The oldest has been waiting");
  });

  it("still reports when they are all clear — 0 · 0 · 1 is reassurance, not noise", () => {
    const settled = { waitingOnYou: 0, withUs: 2, signedOff: 40, oldestDays: 0 };
    const mail = buildQuestionEmail({ ...base, counts: settled });
    expect(mail.bodyHtml).toContain("Waiting on you");
    expect(mail.bodyText).toContain("Signed off: 40");
  });

  it("SHOWS NOTHING for a client with a genuinely empty page", () => {
    const empty = { waitingOnYou: 0, withUs: 0, signedOff: 0, oldestDays: 0 };
    const mail = buildQuestionEmail({ ...base, counts: empty });
    expect(mail.bodyHtml).not.toContain("Waiting on you");
    expect(mail.bodyText).not.toContain("Signed off");
  });

  it("shows nothing when no counts were passed at all", () => {
    const mail = buildQuestionEmail(base);
    expect(mail.bodyHtml).not.toContain("Waiting on you");
  });

  it("sits above the button, never below it", () => {
    const mail = buildQuestionEmail({ ...base, counts });
    expect(mail.bodyHtml.indexOf("Waiting on you")).toBeLessThan(
      mail.bodyHtml.indexOf("Answer the question"),
    );
  });

  it("reaches the message email too, not just questions", () => {
    const mail = buildMessageEmail({
      title: base.title,
      message: "Any news?",
      url: base.url,
      counts,
    });
    expect(mail.bodyHtml).toContain("Waiting on you");
  });

  it("uses tables only — no flexbox or grid reaches an inbox", () => {
    const mail = buildQuestionEmail({ ...base, counts });
    expect(mail.bodyHtml).toContain("<table");
    expect(mail.bodyHtml).not.toMatch(/display:\s*(flex|grid)/);
  });
});

describe("countStages", () => {
  const row = (over = {}) => ({
    state: "pending",
    owed_by: "client",
    due_date: null,
    briefs: null,
    ...over,
  });

  it("splits the three buckets the way the client's own page does", () => {
    expect(
      countStages([
        row(),
        row(),
        row({ state: "changes_requested" }),
        row({ state: "approved" }),
        row({ state: "approved" }),
        row({ state: "approved" }),
      ]),
    ).toEqual({ waitingOnYou: 2, withUs: 1, signedOff: 3, oldestDays: 0 });
  });

  it("counts an agreement WE made as with us, not waiting on them", () => {
    const c = countStages([row({ owed_by: "us" }), row()]);
    expect(c).toMatchObject({ waitingOnYou: 1, withUs: 1 });
  });

  it("takes the oldest from the longest-waiting item only", () => {
    const day = 86_400_000;
    const c = countStages([
      row({ briefs: { client_wait_ms: 3 * day } }),
      row({ briefs: { client_wait_ms: 11 * day } }),
      // decided items never contribute an age
      row({ state: "approved", briefs: { client_wait_ms: 99 * day } }),
    ]);
    expect(c.oldestDays).toBe(11);
  });

  it("handles a client with nothing at all", () => {
    expect(countStages([])).toEqual({
      waitingOnYou: 0,
      withUs: 0,
      signedOff: 0,
      oldestDays: 0,
    });
  });
});
