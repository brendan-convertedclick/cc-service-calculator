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

  const triggerDownload = (url: string, filename: string) => {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const openEmail = () => {
    if (q.cost_estimate_pdf_url) {
      triggerDownload(q.cost_estimate_pdf_url, `CostEstimate-${q.id}.pdf`);
    }
    if (q.sow_pdf_url) {
      triggerDownload(q.sow_pdf_url, `SOW-${q.id}.pdf`);
    }
    window.open(mailto({ to: recipient, subject, body }), "_blank");
  };

  const hasAttachments = Boolean(q.cost_estimate_pdf_url || q.sow_pdf_url);

  const markSent = async () => {
    const now = new Date().toISOString();
    await update.mutateAsync({
      id: q.id,
      patch: { status: "sent", sent_at: now },
    });

    // Set first_delivery_at on the linked project if not already set
    const projectId = scope?.brief?.parent_project_id;
    if (projectId) {
      const { data: proj } = await supabase
        .from("projects")
        .select("first_delivery_at")
        .eq("id", projectId)
        .single();
      if (proj && proj.first_delivery_at == null) {
        await supabase
          .from("projects")
          .update({ first_delivery_at: now })
          .eq("id", projectId);
      }
    }

    toast.success("Marked sent");
    navigate(`/quotes/${q.id}`);
  };

  const editQuote = async () => {
    if (!scope?.brief_id) return;
    navigate(`/briefs/${scope.brief_id}/builder`);
  };

  return (
    <div className="container mx-auto max-w-7xl p-6 space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="overflow-hidden">
          <CardContent className="p-0 h-[80vh]">
            {q.cost_estimate_pdf_url ? (
              <iframe
                src={`${q.cost_estimate_pdf_url}#toolbar=0&navpanes=0&view=FitH`}
                title="Cost estimate preview"
                className="w-full h-full border-0"
              />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-body-small text-m-on-surface-variant text-center">
                No cost estimate PDF yet — go back to the builder and finalise to generate one.
              </div>
            )}
          </CardContent>
        </Card>

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
              <Textarea rows={14} value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
          </CardContent>
        </Card>
      </div>

      {!hasAttachments && (
        <div className="rounded-md border border-m-outline-variant bg-m-surface-container-low/40 p-3 text-body-small text-m-on-surface-variant">
          No PDFs attached to this quote — you can still send the email, or{" "}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-m-primary"
            onClick={editQuote}
          >
            go back to the builder
          </button>{" "}
          to generate them.
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <Button onClick={openEmail} disabled={!recipient}>
          {hasAttachments ? "Open email + download PDFs" : "Open email"}
        </Button>
        <Button variant="secondary" onClick={markSent}>Mark as sent</Button>
        <Button variant="ghost" onClick={editQuote} disabled={!scope?.brief_id}>
          Edit quote
        </Button>
        <FeatureFlagGate flag="xero_enabled">
          <Button variant="secondary" onClick={pushXero}>
            Push to Xero
          </Button>
        </FeatureFlagGate>
      </div>
    </div>
  );
}
