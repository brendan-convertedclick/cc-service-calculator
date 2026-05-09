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
import { useScopeById } from "@/hooks/useScopes";
import { mailto } from "@/lib/mailto";
import { sendQuoteEmail } from "@/content/email-templates";
import { supabase } from "@/lib/supabase";

export function QuoteSend() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data } = useQuote(id);
  const update = useUpdateQuote();
  const { data: scope } = useScopeById(data?.quote.scope_id);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipient, setRecipient] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (hydrated || !scope?.brief) return;
    const tmpl = sendQuoteEmail({
      subject: scope.brief.raw_subject ?? "",
      clientName: scope.brief.client?.name ?? null,
    });
    setSubject(tmpl.subject);
    setBody(tmpl.body);
    setRecipient(scope.brief.sender_email ?? "");
    setHydrated(true);
  }, [scope, hydrated]);

  if (!data) return <div className="p-6">Loading…</div>;
  const q = data.quote;

  const pushXero = async () => {
    const { error } = await supabase.functions.invoke("push-to-xero", {
      body: { quote_id: q.id },
    });
    if (error) toast.error(`Xero push failed: ${error.message}`);
    else toast.success("Quote pushed to Xero");
  };

  const openEmail = () => {
    if (q.sow_pdf_url) {
      const link = document.createElement("a");
      link.href = q.sow_pdf_url;
      link.download = `SOW-${q.id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
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

      {!q.sow_pdf_url && (
        <div className="rounded-md border border-m-outline-variant bg-m-surface-container-low/40 p-3 text-body-small text-m-on-surface-variant">
          No SOW PDF attached to this quote — you can still send the email, or{" "}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-m-primary"
            onClick={() => navigate(-1)}
          >
            go back to the builder
          </button>{" "}
          to draft one.
        </div>
      )}

      <div className="flex gap-2">
        <Button onClick={openEmail} disabled={!recipient}>
          {q.sow_pdf_url ? "Open email + download PDF" : "Open email"}
        </Button>
        <Button variant="secondary" onClick={markSent}>Mark as sent</Button>
        <FeatureFlagGate flag="xero_enabled">
          <Button variant="secondary" onClick={pushXero}>
            Push to Xero
          </Button>
        </FeatureFlagGate>
      </div>
    </div>
  );
}
