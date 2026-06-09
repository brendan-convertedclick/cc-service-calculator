// src/pages/Scope.tsx
import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { ScopeEditor } from "@/components/ScopeEditor";
import { BriefIntelligenceView } from "@/components/BriefIntelligenceView";
import { useBrief, useUpdateBrief } from "@/hooks/useBriefs";
import { useScope, useUpsertScope } from "@/hooks/useScopes";
import {
  useBriefIntelligence,
  useApproveBriefIntelligence,
  useRejectBriefIntelligence,
} from "@/hooks/useBriefIntelligence";
import { useCurrentUserId } from "@/context/AuthContext";
import { isMostlyAi } from "@/lib/scope-overlap";

const INTENT_LABEL: Record<string, string> = {
  new_brief:       "New brief",
  project_thread:  "Project thread",
  retainer_thread: "Retainer",
  general_query:   "General query",
  quick_response:  "Quick response",
};

type ScopeValues = {
  enhanced_prose:   string;
  in_scope_md:      string;
  out_of_scope_md:  string;
  open_questions_md: string;
};

const EMPTY: ScopeValues = {
  enhanced_prose:   "",
  in_scope_md:      "",
  out_of_scope_md:  "",
  open_questions_md: "",
};

function concat(v: ScopeValues) {
  return `${v.enhanced_prose}\n${v.in_scope_md}\n${v.out_of_scope_md}\n${v.open_questions_md}`;
}

export function Scope() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const userId = useCurrentUserId();

  const { data: brief } = useBrief(id);
  const { data: intelligence, isLoading: intelLoading } = useBriefIntelligence(id);
  const { data: scope } = useScope(id);
  const updateBrief = useUpdateBrief();
  const upsertScope = useUpsertScope();
  const approve = useApproveBriefIntelligence(id ?? "");
  const reject = useRejectBriefIntelligence(id ?? "");

  const [rejectNotes, setRejectNotes] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [scopeValues, setScopeValues] = useState<ScopeValues>(EMPTY);
  const [lastAiDraft, setLastAiDraft] = useState("");

  // Pre-populate scopeValues from an existing scope row (e.g. on page reload).
  useEffect(() => {
    if (scope) {
      const v: ScopeValues = {
        enhanced_prose:   scope.enhanced_prose   ?? "",
        in_scope_md:      scope.in_scope_md      ?? "",
        out_of_scope_md:  scope.out_of_scope_md  ?? "",
        open_questions_md: scope.open_questions_md ?? "",
      };
      setScopeValues(v);
      if (scope.ai_drafted) setLastAiDraft(concat(v));
    }
  }, [scope]);

  if (!brief) return <div className="p-6 text-body-medium">Loading…</div>;

  const amStatus = intelligence?.am_status ?? "pending";
  const isApproved = amStatus === "approved";
  const isRejected = amStatus === "rejected";

  const handleApprove = async () => {
    try {
      await approve.mutateAsync();
      toast.success("Brief approved — you can now build the scope");
    } catch {
      toast.error("Failed to approve");
    }
  };

  const handleReject = async () => {
    if (!rejectNotes.trim()) {
      toast.error("Add notes so the AI knows what to fix");
      return;
    }
    try {
      await reject.mutateAsync({ notes: rejectNotes });
      setRejectNotes("");
      setShowRejectInput(false);
      toast.success("Rejected — intake will regenerate on next run");
    } catch {
      toast.error("Failed to reject");
    }
  };

  const lockScope = async () => {
    if (!id) return;
    try {
      await upsertScope.mutateAsync({
        brief_id: id,
        ...scopeValues,
        ai_drafted: lastAiDraft ? isMostlyAi(concat(scopeValues), lastAiDraft) : false,
        locked_at: new Date().toISOString(),
        locked_by: userId,
      });
      await updateBrief.mutateAsync({ id, patch: { status: "scoped" } });
      navigate(`/briefs/${id}/sow-check`);
    } catch {
      toast.error("Failed to lock scope");
    }
  };

  return (
    <div className="container mx-auto max-w-5xl p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/inbox"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-title-large truncate">{brief.raw_subject ?? "(no subject)"}</h1>
          <div className="flex items-center gap-2 mt-1">
            {brief.intent_type && (
              <Badge className="text-label-small">
                {INTENT_LABEL[brief.intent_type] ?? brief.intent_type}
              </Badge>
            )}
            {brief.sender_email && (
              <span className="text-body-small text-m-on-surface-variant">
                {brief.sender_email}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Intelligence view — always visible */}
      <BriefIntelligenceView
        intelligence={intelligence ?? null}
        isLoading={intelLoading}
      />

      {/* AM Review actions — only when pending and intelligence exists */}
      {!isApproved && !isRejected && intelligence && (
        <Card>
          <CardContent className="p-4 space-y-3">
            {showRejectInput ? (
              <div className="space-y-2">
                <Textarea
                  placeholder="What needs to change? The AI will use these notes when it regenerates…"
                  rows={3}
                  value={rejectNotes}
                  onChange={(e) => setRejectNotes(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowRejectInput(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleReject}
                    disabled={reject.isPending}
                  >
                    {reject.isPending ? "Rejecting…" : "Reject & regenerate"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex justify-between items-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowRejectInput(true)}
                >
                  Reject — needs changes
                </Button>
                <Button
                  onClick={handleApprove}
                  disabled={approve.isPending}
                >
                  {approve.isPending ? "Approving…" : "Approve → build scope"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Rejected state */}
      {isRejected && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-body-small text-red-800">
          Rejected. Intake will regenerate the intelligence on the next run.
          {intelligence?.am_notes && (
            <p className="mt-1 font-medium">Notes: {intelligence.am_notes}</p>
          )}
        </div>
      )}

      {/* Scope editor — only after approval */}
      {isApproved && (
        <div className="space-y-4 pt-2">
          <h2 className="text-title-medium">Scope</h2>
          <ScopeEditor
            value={scopeValues}
            onChange={(v) => setScopeValues({ ...scopeValues, ...v })}
          />
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                upsertScope.mutateAsync({ brief_id: id!, ...scopeValues, ai_drafted: false })
                  .then(() => toast.success("Saved"))
                  .catch(() => toast.error("Failed to save"))
              }
            >
              Save draft
            </Button>
            <Button onClick={lockScope}>Lock scope</Button>
          </div>
        </div>
      )}
    </div>
  );
}
