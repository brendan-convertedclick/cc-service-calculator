import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  useCreateQuote,
  useQuote,
  useReplaceQuoteServices,
  useUpdateQuote,
} from "@/hooks/useQuotes";
import { useSettings } from "@/hooks/useSettings";
import { useCurrentUserName } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { formatZar } from "@/lib/utils";

export function QuoteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data } = useQuote(id);
  const { data: settings } = useSettings();
  const user = useCurrentUserName();
  const update = useUpdateQuote();
  const create = useCreateQuote();
  const replaceSvcs = useReplaceQuoteServices();

  if (!data) return <div className="p-6">Loading…</div>;
  const q = data.quote;

  const accept = async () => {
    await update.mutateAsync({
      id: q.id,
      patch: {
        status: "accepted",
        accepted_at: new Date().toISOString(),
        accepted_by: user,
      },
    });
    if (settings?.clickup_enabled) {
      const { error } = await supabase.functions.invoke("push-to-clickup", {
        body: { quote_id: q.id },
      });
      if (error) toast.error(`ClickUp push failed: ${error.message}`);
      else toast.success("Accepted + pushed to ClickUp");
    } else {
      toast.success("Accepted (ClickUp disabled — use Retry push when ready)");
    }
  };

  const reject = async () => {
    const reason = window.prompt("Rejection reason:") ?? "";
    await update.mutateAsync({
      id: q.id,
      patch: { status: "rejected", rejection_reason: reason || null },
    });
  };

  const retryPush = async () => {
    const { error } = await supabase.functions.invoke("push-to-clickup", {
      body: { quote_id: q.id },
    });
    if (error) toast.error(error.message);
    else toast.success("Pushed");
  };

  const revise = async () => {
    await update.mutateAsync({ id: q.id, patch: { status: "superseded" } });
    const newQuote = await create.mutateAsync({
      scope_id: q.scope_id,
      version: q.version + 1,
      status: "draft",
      sow_html: q.sow_html,
      margin_pct: q.margin_pct,
      discount_room_pct: q.discount_room_pct,
    });
    await replaceSvcs.mutateAsync({
      quoteId: newQuote.id,
      rows: data.services.map((s) => ({
        service_id: s.service_id,
        qty: Number(s.qty),
        allocation_override: s.allocation_override,
        hours_override: s.hours_override,
        ordinal: s.ordinal,
        notes: s.notes,
      })),
    });
    const { data: scope } = await supabase
      .from("scopes").select("brief_id").eq("id", q.scope_id).single();
    if (scope) navigate(`/briefs/${scope.brief_id}/builder`);
  };

  return (
    <div className="container mx-auto max-w-3xl p-6 space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <h1 className="text-headline-small">Quote v{q.version}</h1>
            <Badge>{q.status}</Badge>
          </div>
          <div>
            Total: <strong>{formatZar(Number(q.total_cents))}</strong>
          </div>
          {q.sow_pdf_url && (
            <a
              className="text-primary underline"
              href={q.sow_pdf_url}
              target="_blank"
              rel="noreferrer"
            >
              Download PDF
            </a>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2 flex-wrap">
        {q.status === "sent" && (
          <>
            <Button onClick={accept}>Mark accepted</Button>
            <Button variant="secondary" onClick={reject}>Mark rejected</Button>
            <Button variant="ghost" onClick={revise}>Revise</Button>
          </>
        )}
        {q.status === "draft" && (
          <Button onClick={() => navigate(`/quotes/${q.id}/send`)}>Go to send</Button>
        )}
        {q.status === "accepted" && !settings?.clickup_enabled && (
          <Button variant="secondary" onClick={retryPush}>Retry ClickUp push</Button>
        )}
      </div>
    </div>
  );
}
