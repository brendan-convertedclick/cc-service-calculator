import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, ChevronRight, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  bucketPlacements,
  placementCounts,
  type BriefTaskSowPlacement,
  type ProposedTaskForPlacement,
  type SowServiceArea,
} from "@/types/sow-placements";

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

type DraftPlacement = Omit<BriefTaskSowPlacement, "id" | "created_at" | "updated_at"> & {
  task_name: string;
};

/**
 * Phase 4 — SoW visualization step. Sits between scope and builder in the
 * brief pipeline. Shows proposed tasks bucketed into service-area bubbles
 * (inside) or the outside zone. Operator can override each placement and
 * approve to proceed.
 *
 * V1 takes a non-DnD approach for accessibility + simplicity: each task
 * has a Select that moves it between service areas or "outside". A future
 * DnD layer can be added on top without changing the data model.
 */
export function SowCheck() {
  const { id: briefId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentUserId } = useAuth();

  const [brief, setBrief] = useState<{ id: string; client_id: string | null } | null>(null);
  const [sowSlug, setSowSlug] = useState<string>("");
  const [availableSows, setAvailableSows] = useState<Array<{ slug: string; title: string }>>([]);
  const [areas, setAreas] = useState<SowServiceArea[]>([]);
  const [tasks, setTasks] = useState<ProposedTaskForPlacement[]>([]);
  const [drafts, setDrafts] = useState<DraftPlacement[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiRunning, setAiRunning] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load brief + master SoWs + (when slug set) service areas.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!briefId) return;
      const [{ data: b }, { data: sows }] = await Promise.all([
        supabase.from("briefs").select("id, client_id").eq("id", briefId).single(),
        supabase.from("master_sows").select("slug, title").order("title"),
      ]);
      if (cancelled) return;
      setBrief(b ?? null);
      setAvailableSows((sows ?? []) as Array<{ slug: string; title: string }>);
      // Load proposed tasks from the brief's scope.line_items as a starting
      // point. Schema may vary — we accept the simplest shape.
      const { data: scope } = await supabase
        .from("scopes")
        .select("line_items")
        .eq("brief_id", briefId)
        .maybeSingle();
      const proposed: ProposedTaskForPlacement[] = ((scope?.line_items as unknown as Array<{
        id?: string;
        service_name?: string;
        description?: string;
      }>) ?? []).map((li, i) => ({
        task_ref: li.id ?? `line_${i}`,
        name: li.service_name ?? `Task ${i + 1}`,
        description: li.description,
      }));
      setTasks(proposed);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [briefId]);

  useEffect(() => {
    if (!sowSlug) return;
    let cancelled = false;
    (async () => {
      const [{ data: a }, { data: existing }] = await Promise.all([
        supabase
          // @ts-expect-error sow_service_areas added by migration 0059
          .from("sow_service_areas")
          .select("*")
          .eq("sow_slug", sowSlug)
          .order("sort_order"),
        supabase
          // @ts-expect-error brief_task_sow_placements added by migration 0059
          .from("brief_task_sow_placements")
          .select("*")
          .eq("brief_id", briefId),
      ]);
      if (cancelled) return;
      setAreas((a ?? []) as unknown as SowServiceArea[]);
      // Hydrate drafts from existing placements, falling back to "outside" defaults.
      const existingMap = new Map<string, BriefTaskSowPlacement>(
        ((existing ?? []) as unknown as BriefTaskSowPlacement[]).map((p) => [p.task_ref, p]),
      );
      setDrafts(
        tasks.map((t) => {
          const ex = existingMap.get(t.task_ref);
          return {
            task_name: t.name,
            brief_id: briefId!,
            task_ref: t.task_ref,
            service_area_id: ex?.service_area_id ?? null,
            is_inside: ex?.is_inside ?? false,
            ai_match_quote: ex?.ai_match_quote ?? null,
            ai_confidence: ex?.ai_confidence ?? null,
            override_reason: ex?.override_reason ?? null,
            approved_by: ex?.approved_by ?? null,
            approved_at: ex?.approved_at ?? null,
          };
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [sowSlug, briefId, tasks]);

  const runAi = async () => {
    if (!sowSlug || tasks.length === 0) return;
    setAiRunning(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(`${FUNCTIONS_BASE}/match-tasks-to-sow`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({
          brief_id: briefId,
          sow_slug: sowSlug,
          service_areas: areas.map((a) => ({
            id: a.id,
            name: a.name,
            description: a.description,
          })),
          tasks,
        }),
      });
      const body = (await res.json()) as {
        placements?: Array<{
          task_ref: string;
          is_inside: boolean;
          service_area_id: string | null;
          ai_confidence: number;
          ai_match_quote: string;
        }>;
        error?: string;
      };
      if (!res.ok) {
        toast.error(body.error ?? "AI matcher failed");
        return;
      }
      const map = new Map(body.placements!.map((p) => [p.task_ref, p]));
      setDrafts((prev) =>
        prev.map((d) => {
          const m = map.get(d.task_ref);
          if (!m) return d;
          return {
            ...d,
            is_inside: m.is_inside,
            service_area_id: m.service_area_id,
            ai_confidence: m.ai_confidence,
            ai_match_quote: m.ai_match_quote,
          };
        }),
      );
      toast.success("AI placement complete.");
    } finally {
      setAiRunning(false);
    }
  };

  const updateDraft = (taskRef: string, patch: Partial<DraftPlacement>) => {
    setDrafts((prev) => prev.map((d) => (d.task_ref === taskRef ? { ...d, ...patch } : d)));
  };

  const approveAll = async () => {
    if (!briefId || !currentUserId) return;
    setSaving(true);
    try {
      const payload = drafts.map((d) => ({
        brief_id: briefId,
        task_ref: d.task_ref,
        service_area_id: d.is_inside ? d.service_area_id : null,
        is_inside: d.is_inside,
        ai_match_quote: d.ai_match_quote,
        ai_confidence: d.ai_confidence,
        override_reason: d.override_reason,
        approved_by: currentUserId,
        approved_at: new Date().toISOString(),
      }));
      const { error } = await supabase
        // @ts-expect-error brief_task_sow_placements added by migration 0059
        .from("brief_task_sow_placements")
        .upsert(payload, { onConflict: "brief_id,task_ref" });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Placements approved.");
      const counts = placementCounts(drafts as unknown as BriefTaskSowPlacement[]);
      if (counts.outside > 0) {
        toast.info(
          `${counts.outside} task(s) fall outside the SoW — generate a Change Estimate from the brief's builder.`,
        );
      }
      navigate(`/briefs/${briefId}/builder`);
    } finally {
      setSaving(false);
    }
  };

  const buckets = useMemo(
    () => bucketPlacements(drafts as unknown as BriefTaskSowPlacement[]),
    [drafts],
  );

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!brief) {
    return <div className="p-6 text-body-medium">Brief not found.</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-headline-small">SoW check</h1>
          <p className="text-body-small text-m-on-surface-variant">
            Confirm which proposed tasks are covered by the active SoW. Anything
            outside becomes a Change Estimate.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={sowSlug} onValueChange={setSowSlug}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Pick the active SoW" />
            </SelectTrigger>
            <SelectContent>
              {availableSows.map((s) => (
                <SelectItem key={s.slug} value={s.slug}>
                  {s.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={!sowSlug || aiRunning}
            onClick={runAi}
            className="gap-2"
          >
            <Sparkles className={`h-4 w-4 ${aiRunning ? "animate-pulse" : ""}`} />
            {aiRunning ? "Matching…" : "AI match"}
          </Button>
        </div>
      </header>

      {sowSlug ? (
        <div className="grid gap-4 lg:grid-cols-[1fr,360px]">
          {/* Inside bubbles */}
          <section className="space-y-4">
            <h2 className="text-title-medium text-m-on-surface">Inside scope</h2>
            {areas.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-10 text-center text-body-medium text-m-on-surface-variant">
                  No service areas defined for this SoW yet. Add some in the SoW page.
                </CardContent>
              </Card>
            ) : (
              areas.map((area) => {
                const inBucket = buckets.get(area.id) ?? [];
                return (
                  <Card key={area.id} className="border-m-primary/40 shadow-elev-1">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-title-small">
                        <span className="rounded-full bg-m-primary-container px-3 py-0.5 text-label-medium text-m-on-primary-container">
                          {area.name}
                        </span>
                        <Badge variant="muted">{inBucket.length}</Badge>
                      </CardTitle>
                      {area.description && (
                        <p className="text-label-small text-m-on-surface-variant">{area.description}</p>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {inBucket.length === 0 ? (
                        <p className="text-body-small text-m-on-surface-variant">
                          No tasks here yet.
                        </p>
                      ) : (
                        inBucket.map((p) => {
                          const draft = drafts.find((d) => d.task_ref === p.task_ref);
                          if (!draft) return null;
                          return (
                            <TaskRow
                              key={p.task_ref}
                              draft={draft}
                              areas={areas}
                              onChange={(patch) => updateDraft(p.task_ref, patch)}
                            />
                          );
                        })
                      )}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </section>

          {/* Outside zone */}
          <aside>
            <Card className="border-2 border-dashed border-rose-300">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-title-small text-rose-700">
                  Outside scope
                  <Badge variant="destructive">
                    {(buckets.get("__outside") ?? []).length}
                  </Badge>
                </CardTitle>
                <p className="text-label-small text-m-on-surface-variant">
                  These will become a Change Estimate.
                </p>
              </CardHeader>
              <CardContent className="space-y-2">
                {(buckets.get("__outside") ?? []).length === 0 ? (
                  <p className="text-body-small text-m-on-surface-variant">
                    Nothing outside scope.
                  </p>
                ) : (
                  (buckets.get("__outside") ?? []).map((p) => {
                    const draft = drafts.find((d) => d.task_ref === p.task_ref);
                    if (!draft) return null;
                    return (
                      <TaskRow
                        key={p.task_ref}
                        draft={draft}
                        areas={areas}
                        onChange={(patch) => updateDraft(p.task_ref, patch)}
                      />
                    );
                  })
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-body-medium text-m-on-surface-variant">
            Pick the active SoW above to load service areas and AI-match the tasks.
          </CardContent>
        </Card>
      )}

      {sowSlug && drafts.length > 0 && (
        <div className="flex items-center justify-end gap-2 pt-4">
          <Button disabled={saving} onClick={approveAll} className="gap-2">
            Approve placements
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function TaskRow({
  draft,
  areas,
  onChange,
}: {
  draft: { task_ref: string; task_name: string; is_inside: boolean; service_area_id: string | null; ai_match_quote: string | null; ai_confidence: number | null };
  areas: SowServiceArea[];
  onChange: (patch: Partial<{ is_inside: boolean; service_area_id: string | null; override_reason: string | null }>) => void;
}) {
  const value = draft.is_inside ? (draft.service_area_id ?? "") : "__outside";
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-m-surface px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-body-medium text-m-on-surface">{draft.task_name}</div>
        {draft.ai_match_quote && (
          <p
            className="truncate text-label-small text-m-on-surface-variant"
            title={draft.ai_match_quote}
          >
            {draft.ai_confidence !== null && (
              <span className="mr-1 inline-flex items-center gap-1">
                {draft.is_inside ? <Check className="h-3 w-3 text-emerald-600" /> : <X className="h-3 w-3 text-rose-600" />}
                {(draft.ai_confidence * 100).toFixed(0)}%
              </span>
            )}
            {draft.ai_match_quote}
          </p>
        )}
      </div>
      <Select
        value={value}
        onValueChange={(v) => {
          if (v === "__outside") {
            onChange({ is_inside: false, service_area_id: null, override_reason: "moved to outside" });
          } else {
            onChange({ is_inside: true, service_area_id: v, override_reason: null });
          }
        }}
      >
        <SelectTrigger className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {areas.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
          <SelectItem value="__outside">— Outside —</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

export default SowCheck;
