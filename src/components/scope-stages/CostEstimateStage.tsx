// Stage 4 of the brief flow: build the Cost Estimate from the confirmed
// billable placements — CE row + line items + rendered PDF — then hand off to
// the email composer with everything prefilled. No AI involved: lines come
// straight from the Scope Receipt the operator already confirmed.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink, FileText, Mail, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Money } from "@/components/ui/money";
import { errorMessage, formatZar } from "@/lib/utils";
import { useServices } from "@/hooks/useServices";
import { useScopeMapPlacements } from "@/hooks/useScopeMap";
import { useBriefCE, useCreateBriefCE, useRenderCePdf } from "@/hooks/useBriefCE";
import { useCurrentUserId } from "@/context/AuthContext";
import { isBillablePlacement } from "@/types/sow-placements";
import {
  CE_STATUS_LABEL,
  rollupCE,
  type CELineKind,
  type CEStatus,
  type ChangeEstimateLineItem,
} from "@/types/change-estimates";

type DraftLine = Omit<ChangeEstimateLineItem, "id" | "change_estimate_id"> & { tmpId: string };

const STATUS_VARIANT: Record<CEStatus, "muted" | "warning" | "success" | "destructive"> = {
  draft: "muted",
  sent: "warning",
  approved: "success",
  rejected: "destructive",
  cancelled: "muted",
};

interface Props {
  briefId: string;
  clientId: string | null;
  parentProjectId: string | null;
  /** Prefill for the client-facing summary (scope prose / intelligence summary). */
  summaryPrefill: string;
}

export function CostEstimateStage({ briefId, clientId, parentProjectId, summaryPrefill }: Props) {
  const navigate = useNavigate();
  const userId = useCurrentUserId();
  const { data: ce, isLoading } = useBriefCE(briefId);
  const { data: placements } = useScopeMapPlacements(briefId);
  const { data: services } = useServices();
  const createCE = useCreateBriefCE(briefId);
  const renderPdf = useRenderCePdf(briefId);

  const serviceById = useMemo(
    () => new Map((services ?? []).map((s) => [s.id, s])),
    [services],
  );

  const [reason, setReason] = useState("Approved scope from brief intake");
  const [summary, setSummary] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const prefilled = useRef(false);

  // Prefill the draft once from the confirmed billable placements.
  useEffect(() => {
    if (prefilled.current || ce || !placements) return;
    prefilled.current = true;
    setSummary(summaryPrefill);
    setLines(
      placements.filter(isBillablePlacement).map((p, i) => {
        const svc = p.suggested_service_id ? serviceById.get(p.suggested_service_id) : undefined;
        const qty =
          typeof p.quantity === "number" && Number.isFinite(p.quantity) && p.quantity > 0
            ? p.quantity
            : 1;
        return {
          tmpId: p.task_ref,
          service_id: p.suggested_service_id,
          description: p.item_name ?? p.task_ref,
          detail: p.item_description ?? null,
          qty,
          unit_points: 1,
          unit_value_cents:
            p.estimated_cents && p.estimated_cents > 0
              ? p.estimated_cents
              : (svc?.sell_price_cents ?? 0),
          line_kind: "add" as CELineKind,
          target_task_id: null,
          sort_order: i,
        };
      }),
    );
  }, [ce, placements, serviceById, summaryPrefill]);

  const totals = useMemo(
    () => rollupCE(lines.map((l) => ({ ...l, id: l.tmpId, change_estimate_id: "x" }))),
    [lines],
  );

  const patchLine = (tmpId: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.tmpId === tmpId ? { ...l, ...patch } : l)));

  const handleCreate = async () => {
    if (!clientId) {
      toast.error("Link this brief to a client before creating an estimate.");
      return;
    }
    if (lines.length === 0) {
      toast.error("No billable lines — confirm scope items first.");
      return;
    }
    try {
      await createCE.mutateAsync({
        brief_id: briefId,
        client_id: clientId,
        project_id: parentProjectId,
        created_by: userId,
        reason,
        summary,
        lines: lines.map(({ tmpId: _t, ...l }) => l),
      });
      toast.success("Cost estimate created — PDF rendered.");
    } catch (e) {
      toast.error(`Failed to create the estimate: ${errorMessage(e)}`);
    }
  };

  const composeHref = ce
    ? `/comms/new?brief_id=${briefId}&ce_id=${ce.id}` +
      (clientId ? `&client_id=${clientId}` : "") +
      (parentProjectId ? `&project_id=${parentProjectId}` : "")
    : "";

  if (isLoading) return <p className="text-body-small text-m-on-surface-variant">Loading…</p>;

  // ---- Existing CE: review card -------------------------------------------
  if (ce) {
    const exVat = ce.delta_value_cents;
    const incVat = Math.round(exVat * 1.15);
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_VARIANT[ce.status]}>{CE_STATUS_LABEL[ce.status]}</Badge>
          <span className="text-body-small text-m-on-surface-variant">{ce.reason}</span>
        </div>
        {ce.summary && (
          <p className="max-w-prose text-body-medium text-m-on-surface">{ce.summary}</p>
        )}
        <Card>
          <CardContent className="divide-y divide-m-outline-variant p-0">
            {ce.lines.map((l) => (
              <div key={l.id} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-body-medium">{l.description}</span>
                  {l.detail && (
                    <span className="block text-label-small text-m-on-surface-variant">
                      {l.detail}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono tabular-nums text-body-small text-m-on-surface-variant">
                  {l.qty} × {formatZar(l.unit_value_cents)}
                </span>
                <span className="w-24 shrink-0 text-right font-mono tabular-nums text-body-medium">
                  <Money cents={Math.round(l.qty * l.unit_value_cents)} />
                </span>
              </div>
            ))}
            <div className="flex items-baseline justify-between px-4 py-2.5">
              <span className="text-label-large">Total (ex VAT) · {ce.delta_points} pts</span>
              <span className="font-mono tabular-nums text-title-small">
                <Money cents={exVat} />
              </span>
            </div>
            <div className="flex items-baseline justify-between px-4 py-2.5 text-m-on-surface-variant">
              <span className="text-label-medium">Total inc. VAT (15%)</span>
              <span className="font-mono tabular-nums text-body-medium">
                <Money cents={incVat} />
              </span>
            </div>
          </CardContent>
        </Card>
        <div className="flex flex-wrap items-center gap-2">
          {ce.pdf_url ? (
            <Button variant="outline" size="sm" asChild className="gap-2">
              <a href={ce.pdf_url} target="_blank" rel="noreferrer">
                <FileText className="h-4 w-4" />
                Cost estimate PDF
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          ) : (
            <span className="text-body-small text-m-on-surface-variant">No PDF yet.</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            disabled={renderPdf.isPending}
            onClick={() =>
              renderPdf
                .mutateAsync(ce.id)
                .then(() => toast.success("PDF re-rendered"))
                .catch((e) => toast.error(`PDF render failed: ${errorMessage(e)}`))
            }
          >
            <RefreshCw className="h-4 w-4" />
            {renderPdf.isPending ? "Rendering…" : "Regenerate PDF"}
          </Button>
          <div className="ml-auto">
            <Button className="gap-2" onClick={() => navigate(composeHref)}>
              <Mail className="h-4 w-4" />
              Compose client email
            </Button>
          </div>
        </div>
        {ce.status === "draft" && (
          <p className="text-label-small text-m-on-surface-variant">
            Sending the email marks this estimate as awaiting approval.
          </p>
        )}
      </div>
    );
  }

  // ---- No CE yet: draft editor ---------------------------------------------
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="ce-reason">Reason</Label>
          <Input id="ce-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="ce-summary">Client-facing summary (appears on the PDF)</Label>
        <Textarea
          id="ce-summary"
          rows={3}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label>Lines — from the confirmed scope</Label>
        {lines.length === 0 ? (
          <p className="text-body-small text-m-on-surface-variant">
            No billable lines. Confirm scope items in Stage 1 first.
          </p>
        ) : (
          <Card>
            <CardContent className="divide-y divide-m-outline-variant p-0">
              {lines.map((l) => (
                <div key={l.tmpId} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 break-words text-body-medium">
                    {l.description}
                  </span>
                  <label className="flex shrink-0 items-center gap-1 text-label-small text-m-on-surface-variant">
                    Qty
                    <Input
                      className="h-8 w-16 text-right font-mono tabular-nums"
                      inputMode="decimal"
                      value={String(l.qty)}
                      onChange={(e) =>
                        patchLine(l.tmpId, { qty: Math.max(0, Number(e.target.value) || 0) })
                      }
                      aria-label={`Quantity for ${l.description}`}
                    />
                  </label>
                  <label className="flex shrink-0 items-center gap-1 text-label-small text-m-on-surface-variant">
                    R
                    <Input
                      className="h-8 w-24 text-right font-mono tabular-nums"
                      inputMode="decimal"
                      value={String(l.unit_value_cents / 100)}
                      onChange={(e) =>
                        patchLine(l.tmpId, {
                          unit_value_cents: Math.max(
                            0,
                            Math.round((Number(e.target.value) || 0) * 100),
                          ),
                        })
                      }
                      aria-label={`Unit price (rands) for ${l.description}`}
                    />
                  </label>
                  <label className="flex shrink-0 items-center gap-1 text-label-small text-m-on-surface-variant">
                    Pts
                    <Input
                      className="h-8 w-14 text-right font-mono tabular-nums"
                      inputMode="decimal"
                      value={String(l.unit_points)}
                      onChange={(e) =>
                        patchLine(l.tmpId, {
                          unit_points: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      aria-label={`Points for ${l.description}`}
                    />
                  </label>
                  <span className="w-24 shrink-0 text-right font-mono tabular-nums text-body-medium">
                    <Money cents={Math.round(l.qty * l.unit_value_cents)} />
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    aria-label={`Remove ${l.description}`}
                    onClick={() =>
                      setLines((prev) => prev.filter((x) => x.tmpId !== l.tmpId))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-m-outline-variant pt-3">
        <span className="text-body-medium">
          Total{" "}
          <span className="font-mono tabular-nums text-title-small">
            <Money cents={totals.delta_value_cents} />
          </span>{" "}
          <span className="text-body-small text-m-on-surface-variant">
            ex VAT · {totals.delta_points} pts
          </span>
        </span>
        <Button
          className="gap-2"
          disabled={createCE.isPending || lines.length === 0}
          onClick={handleCreate}
        >
          <FileText className="h-4 w-4" />
          {createCE.isPending ? "Creating…" : "Create estimate & PDF"}
        </Button>
      </div>
    </div>
  );
}
