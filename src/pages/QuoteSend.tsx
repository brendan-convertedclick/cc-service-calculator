import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { FeatureFlagGate } from "@/components/FeatureFlagGate";
import { useQuote, useUpdateQuote } from "@/hooks/useQuotes";
import { supabase } from "@/lib/supabase";
import { mailto } from "@/lib/mailto";
import { sendQuoteEmail } from "@/content/email-templates";

export function QuoteSend() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data } = useQuote(id);
  const update = useUpdateQuote();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipient, setRecipient] = useState("");

  useEffect(() => {
    if (!data) return;
    void (async () => {
      const { data: scope } = await supabase
        .from("scopes")
        .select("*, brief:briefs(*, client:clients(*))")
        .eq("id", data.quote.scope_id)
        .single();
      const brief = (scope as { brief: { raw_subject: string | null; sender_email: string | null; client: { name: string } | null } | null })
        ?.brief;
      if (!brief) return;
      const tmpl = sendQuoteEmail({
        subject: brief.raw_subject ?? "",
        clientName: brief.client?.name ?? null,
      });
      setSubject(tmpl.subject);
      setBody(tmpl.body);
      setRecipient(brief.sender_email ?? "");
    })();
  }, [data]);

  if (!data) return <div className="p-6">Loading…</div>;
  const q = data.quote;

  const openEmail = () => {
    if (!q.sow_pdf_url) {
      toast.error("No PDF on this quote");
      return;
    }
    const link = document.createElement("a");
    link.href = q.sow_pdf_url;
    link.download = `SOW-${q.id}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.open(mailto({ to: recipient, subject, body }), "_blank");
  };

  const markSent = async () => {
    await update.mutateAsync({
      id: q.id,
      patch: { status: "sent", sent_at: new Date().toISOString() },
    });
    toast.success("Marked sent");
    navigate(`/quotes/${q.id}`);
  };

  return (
    <div className="container mx-auto max-w-3xl p-6 space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="space-y-2">
            <Label>To</Label>
            <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} type="email" />
          </div>
          <div className="space-y-2">
            <Label>Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Body</Label>
            <Textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button onClick={openEmail} disabled={!recipient}>Open email + download PDF</Button>
        <Button variant="secondary" onClick={markSent}>Mark as sent</Button>
        <FeatureFlagGate flag="xero_enabled">
          <Button variant="secondary" onClick={() => toast("Phase 2 — not yet implemented")}>
            Push to Xero
          </Button>
        </FeatureFlagGate>
      </div>
    </div>
  );
}
