export function needsInfoReply(subject: string, senderName?: string): { subject: string; body: string } {
  return {
    subject: `Re: ${subject}`,
    body: [
      `Hi ${senderName ?? "there"},`,
      "",
      "Thanks for getting in touch. Before we put a scope together, could you share a little more detail on the following:",
      "",
      "  • <question 1>",
      "  • <question 2>",
      "",
      "Once we have that, we'll come back with a proposal.",
      "",
      "Best,",
      "Brendan",
    ].join("\n"),
  };
}

export function sendQuoteEmail(input: { subject: string; clientName: string | null }): { subject: string; body: string } {
  return {
    subject: `Proposal: ${input.subject}`,
    body: [
      `Hi ${input.clientName ?? "there"},`,
      "",
      "Please find attached our proposal covering the scope we discussed.",
      "",
      "Let me know if you'd like to tweak anything before we proceed.",
      "",
      "Best,",
      "Brendan",
    ].join("\n"),
  };
}
