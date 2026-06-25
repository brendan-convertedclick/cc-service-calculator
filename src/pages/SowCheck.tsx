import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Calculator, ChevronRight, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useBrief } from "@/hooks/useBriefs";
import {
  useAnalyzeBrief,
  useApprovePlacements,
  useClientSows,
  useOverridePlacement,
  useScopeMapPlacements,
  type AnalyzeBriefInput,
  type SowOption,
} from "@/hooks/useScopeMap";
import { ScopeMapCanvas } from "@/components/scope-map/ScopeMapCanvas";
import { SowSelectionCard } from "@/components/scope-map/SowSelectionCard";
import { EstimateSheet } from "@/components/scope-map/EstimateSheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency } from "@/lib/format";
import {
  isBillablePlacement,
  placementDisposition,
  type BriefTaskSowPlacement,
} from "@/types/sow-placements";

/**
 * Scope map — Phase 4 of the brief pipeline (route /briefs/:id/sow-check).
 * Maps the request's discrete asks against the client's SOW(s): in-scope asks
 * land inside the circle, out-of-scope asks sit outside it with selectable
 * checkboxes that feed a cost estimate. Analysis auto-runs; the first brief
 * for a client asks which SOWs they have (persisted to client_sows).
 */
export function SowCheck() {
  const { id: briefId } = useParams<{ id: string }>();
  if (!briefId) {
    return <div className="p-6 text-body-medium">Brief not found.</div>;
  }
  // Keyed by briefId so all per-brief state (autoRanRef, selectionInitRef,
  // selection, selectedRefs, the analyze mutation) resets when navigating
  // between briefs — React Router reuses the mounted element across :id changes.
  return <SowCheckInner key={briefId} briefId={briefId} />;
}

function SowCheckInner({ briefId }: { briefId: string }) {
  const navigate = useNavigate();

  const briefQuery = useBrief(briefId);
  const brief = briefQuery.data;
  const placementsQuery = useScopeMapPlacements(briefId);
  const placements = placementsQuery.data;
  const clientSowsQuery = useClientSows(brief?.client_id);
  const clientSows = useMemo(() => clientSowsQuery.data ?? [], [clientSowsQuery.data]);

  const analyze = useAnalyzeBrief(briefId);
  const override = useOverridePlacement(briefId);
  const approve = useApprovePlacements(briefId);

  // slug → title for badges + canvas chips (master_sows is a typed table).
  const { data: masterSows } = useQuery({
    queryKey: ["master-sows"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<SowOption[]> => {
      const { data, error } = await supabase
        .from("master_sows")
        .select("slug, title")
        .order("title");
      if (error) throw error;
      return (data ?? []) as SowOption[];
    },
  });
  const sowTitleBySlug = useMemo(
    () => new Map((masterSows ?? []).map((s) => [s.slug, s.title])),
    [masterSows],
  );

  const [selection, setSelection] = useState<{
    available: SowOption[];
    suggested: string[];
  } | null>(null);
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());
  const [estimateOpen, setEstimateOpen] = useState(false);
  const [reanalyseOpen, setReanalyseOpen] = useState(false);
  const autoRanRef = useRef(false);
  const selectionInitRef = useRef(false);

  const runAnalyze = (input: AnalyzeBriefInput) => {
    setSelection(null);
    analyze.mutate(input, {
      onSuccess: (res) => {
        if (res.needs_sow_selection) {
          setSelection({ available: res.available, suggested: res.suggested_slugs });
          return;
        }
        // Fresh placements → default-select every new-billable item for the
        // estimate. out_of_scope items are never billable, so they stay unticked.
        setSelectedRefs(
          new Set(res.placements.filter(isBillablePlacement).map((p) => p.task_ref)),
        );
        selectionInitRef.current = true;
        toast.success(
          `Mapped ${res.placements.length} item(s) against ${res.sow_slugs.length} SOW(s).`,
        );
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Analysis failed"),
    });
  };

  // Auto-run the analysis exactly once when the brief loads with no placements.
  // The edge fn decides between suggest mode (no client→SOW link) and analyze.
  useEffect(() => {
    if (autoRanRef.current) return;
    if (!brief || placements === undefined) return;
    if (placements.length > 0) return;
    if (brief.client_id && clientSowsQuery.isPending) return;
    autoRanRef.current = true;
    runAnalyze({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, placements, clientSowsQuery.isPending]);

  // Default-select all outside items when placements arrive already persisted
  // (page reload) — analyze success handles the fresh-analysis path.
  useEffect(() => {
    if (selectionInitRef.current) return;
    if (!placements || placements.length === 0) return;
    selectionInitRef.current = true;
    setSelectedRefs(new Set(placements.filter(isBillablePlacement).map((p) => p.task_ref)));
  }, [placements]);

  const handleToggleSelect = (ref: string) => {
    setSelectedRefs((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  };

  const handleOverride = (ref: string, isInside: boolean) => {
    override.mutate(
      {
        task_ref: ref,
        is_inside: isInside,
        service_area_id: null,
        ...(isInside ? {} : { sow_slug: null }),
        override_reason: isInside ? "Operator moved inside" : "Operator moved outside",
      },
      {
        // Selection follows the placement only once the write lands — on error
        // the chip rolls back, so the estimate selection must not move either.
        onSuccess: () => {
          setSelectedRefs((prev) => {
            const next = new Set(prev);
            if (isInside) next.delete(ref);
            else next.add(ref);
            return next;
          });
        },
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Failed to update placement"),
      },
    );
  };

  const approvedCount = useMemo(
    () => (placements ?? []).filter((p) => p.approved_at !== null).length,
    [placements],
  );

  const handleReanalyse = () => {
    if (approvedCount > 0) setReanalyseOpen(true);
    else runAnalyze({ force: false });
  };

  const handleApprove = () => {
    approve.mutate(undefined, {
      onSuccess: () => {
        toast.success("Placements approved.");
        navigate(`/briefs/${briefId}/builder`);
      },
      onError: (e) =>
        toast.error(e instanceof Error ? e.message : "Failed to approve placements"),
    });
  };

  // SOW badges: the client's saved engagements, else the slugs the analysis used.
  const sowSlugs = useMemo(() => {
    if (clientSows.length > 0) return clientSows.map((s) => s.sow_slug);
    const fromPlacements = new Set(
      (placements ?? []).map((p) => p.sow_slug).filter((s): s is string => !!s),
    );
    return Array.from(fromPlacements);
  }, [clientSows, placements]);
  const sowTitles = sowSlugs.map((slug) => sowTitleBySlug.get(slug) ?? slug);

  const selectedItems = useMemo(
    () =>
      // Only new_billable items can feed the estimate — out_of_scope lines are
      // never billable, even if their ref somehow lingers in the selection set.
      (placements ?? []).filter(
        (p) => isBillablePlacement(p) && selectedRefs.has(p.task_ref),
      ),
    [placements, selectedRefs],
  );
  const selectedEstimateCents = selectedItems.reduce(
    (sum, p) => sum + (p.estimated_cents ?? 0),
    0,
  );

  // Read failures must surface explicitly — without this branch a failed
  // placements fetch left the page on a permanent fake "Mapping…" spinner
  // (the idle analyze mutation looked like in-flight work).
  if (briefQuery.isError || placementsQuery.isError) {
    const error = briefQuery.isError ? briefQuery.error : placementsQuery.error;
    return (
      <div className="p-6">
        <Card className="mx-auto max-w-md border-destructive/30 shadow-elev-1">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-body-medium text-destructive">
              {briefQuery.isError
                ? "Failed to load the brief."
                : "Failed to load scope placements."}
            </p>
            <p className="text-body-small text-m-on-surface-variant">
              {error instanceof Error ? error.message : String(error)}
            </p>
            <Button
              variant="outline"
              onClick={() => {
                if (briefQuery.isError) void briefQuery.refetch();
                if (placementsQuery.isError) void placementsQuery.refetch();
              }}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  if (briefQuery.isLoading || (placementsQuery.isLoading && placements === undefined)) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mx-auto aspect-square w-full max-w-[760px] rounded-xl" />
      </div>
    );
  }
  if (!brief) {
    return <div className="p-6 text-body-medium">Brief not found.</div>;
  }

  const analyzing = analyze.isPending;
  const hasPlacements = (placements?.length ?? 0) > 0;

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-headline-small">Scope map</h1>
          <p className="truncate text-body-small text-m-on-surface-variant">
            {brief.raw_subject ?? "(no subject)"} — in-scope asks land inside the
            circle; anything outside can become a cost estimate.
          </p>
          {sowTitles.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {sowTitles.map((title) => (
                <Badge key={title} variant="muted">
                  {title}
                </Badge>
              ))}
            </div>
          )}
        </div>
        {hasPlacements && (
          <Button
            variant="outline"
            disabled={analyzing}
            onClick={handleReanalyse}
            className="gap-2"
          >
            <Sparkles className={`h-4 w-4 ${analyzing ? "animate-pulse" : ""}`} />
            {analyzing ? "Analysing…" : "Re-analyse"}
          </Button>
        )}
      </header>

      {selection ? (
        <SowSelectionCard
          available={selection.available}
          suggestedSlugs={selection.suggested}
          confirming={analyzing}
          onConfirm={(slugs) => runAnalyze({ sow_slugs: slugs, persist_client_sows: true })}
        />
      ) : !hasPlacements ? (
        // Spinner only while work is genuinely pending/expected: an idle
        // mutation counts (auto-run is imminent) but never when the read errored.
        analyzing ||
        placementsQuery.isFetching ||
        (analyze.isIdle && !placementsQuery.isError) ? (
          <Card className="mx-auto max-w-md border-m-outline-variant shadow-elev-1">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <Sparkles className="h-8 w-8 animate-pulse text-m-primary" />
              <p className="text-body-medium text-m-on-surface">
                {clientSows.length > 0
                  ? `Mapping request against ${clientSows.length} SOW(s)…`
                  : "Checking which SOW engagements this client has…"}
              </p>
              <p className="text-body-small text-m-on-surface-variant">
                Extracting every discrete ask and classifying it against the SOW
                clauses.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="mx-auto max-w-md border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-body-medium text-m-on-surface-variant">
                {analyze.isError
                  ? "Analysis failed. Fix the issue and try again."
                  : "The analysis didn't extract any scope items from this brief."}
              </p>
              <Button variant="outline" onClick={() => runAnalyze({})} className="gap-2">
                <Sparkles className="h-4 w-4" />
                {analyze.isError ? "Run analysis" : "Re-run analysis"}
              </Button>
            </CardContent>
          </Card>
        )
      ) : (
        <>
          <Tabs defaultValue="map">
            <TabsList>
              <TabsTrigger value="map">Map</TabsTrigger>
              <TabsTrigger value="list">List</TabsTrigger>
            </TabsList>
            <TabsContent value="map" className="pt-6">
              <ScopeMapCanvas
                items={placements ?? []}
                sowTitles={sowTitles}
                selectedRefs={selectedRefs}
                onToggleSelect={handleToggleSelect}
                onOverride={handleOverride}
              />
            </TabsContent>
            <TabsContent value="list" className="pt-2">
              <PlacementsTable
                placements={placements ?? []}
                sowTitleBySlug={sowTitleBySlug}
                onOverride={handleOverride}
              />
            </TabsContent>
          </Tabs>

          {selectedItems.length > 0 && (
            <div className="sticky bottom-4 z-20">
              <Card className="border-m-outline-variant bg-m-surface-container shadow-elev-3">
                <CardContent className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <span className="text-body-medium text-m-on-surface">
                    <strong>{selectedItems.length}</strong> item(s) selected · est.{" "}
                    <strong>{formatCurrency(selectedEstimateCents / 100)}</strong>
                  </span>
                  <Button onClick={() => setEstimateOpen(true)} className="gap-2">
                    <Calculator className="h-4 w-4" />
                    Build cost estimate
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button disabled={approve.isPending} onClick={handleApprove} className="gap-2">
              Approve placements
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}

      <EstimateSheet
        open={estimateOpen}
        onOpenChange={setEstimateOpen}
        brief={{
          id: brief.id,
          client_id: brief.client_id,
          parent_project_id: brief.parent_project_id,
        }}
        items={selectedItems}
      />

      <Dialog open={reanalyseOpen} onOpenChange={setReanalyseOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approved placements exist</DialogTitle>
            <DialogDescription>
              {approvedCount} placement(s) on this brief are already approved. Keep
              them and re-analyse the rest, or replace everything from scratch.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReanalyseOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setReanalyseOpen(false);
                runAnalyze({ force: false });
              }}
            >
              Keep approved & re-analyse
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setReanalyseOpen(false);
                runAnalyze({ force: true });
              }}
            >
              Replace all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Accessible List tab — the screen-reader path for the map. */
function PlacementsTable({
  placements,
  sowTitleBySlug,
  onOverride,
}: {
  placements: BriefTaskSowPlacement[];
  sowTitleBySlug: Map<string, string>;
  onOverride: (ref: string, isInside: boolean) => void;
}) {
  return (
    <div className="rounded-xl border border-m-outline-variant bg-m-surface">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead>Verdict</TableHead>
            <TableHead className="w-24">Confidence</TableHead>
            <TableHead>Reasoning</TableHead>
            <TableHead>SOW</TableHead>
            <TableHead className="w-36">Override</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {placements.map((p) => (
            <TableRow key={p.task_ref}>
              <TableCell>
                <div className="text-body-medium text-m-on-surface">
                  {p.item_name ?? p.task_ref}
                </div>
                {p.item_description && (
                  <div className="max-w-xs truncate text-label-small text-m-on-surface-variant">
                    {p.item_description}
                  </div>
                )}
              </TableCell>
              <TableCell>
                {(() => {
                  const d = placementDisposition(p);
                  const meta = {
                    in_agreed_scope: { variant: "success" as const, label: "In agreed scope" },
                    new_billable: { variant: "warning" as const, label: "New billable" },
                    out_of_scope: { variant: "muted" as const, label: "Out of scope" },
                  }[d];
                  return (
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      {p.needs_review && (
                        <Badge variant="destructive" className="text-label-small">
                          Review
                        </Badge>
                      )}
                    </div>
                  );
                })()}
              </TableCell>
              <TableCell className="text-body-small text-m-on-surface-variant">
                {p.ai_confidence !== null ? `${Math.round(p.ai_confidence * 100)}%` : "—"}
              </TableCell>
              <TableCell className="max-w-sm">
                <span className="line-clamp-2 text-body-small text-m-on-surface-variant">
                  {p.ai_match_quote ?? "—"}
                </span>
              </TableCell>
              <TableCell className="text-body-small text-m-on-surface-variant">
                {p.sow_slug ? (sowTitleBySlug.get(p.sow_slug) ?? p.sow_slug) : "—"}
              </TableCell>
              <TableCell>
                <Select
                  value={p.is_inside ? "inside" : "outside"}
                  onValueChange={(v) => onOverride(p.task_ref, v === "inside")}
                >
                  <SelectTrigger aria-label={`Override placement for ${p.item_name ?? p.task_ref}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inside">Inside</SelectItem>
                    <SelectItem value="outside">Outside</SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default SowCheck;
