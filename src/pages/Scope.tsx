import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ScopeEditor } from "@/components/ScopeEditor";
import { useBrief, useUpdateBrief } from "@/hooks/useBriefs";
import { useScope, useUpsertScope } from "@/hooks/useScopes";
import { useCurrentUserId } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { isMostlyAi } from "@/lib/scope-overlap";

type ScopeValues = {
  enhanced_prose: string;
  in_scope_md: string;
  out_of_scope_md: string;
  open_questions_md: string;
};

const EMPTY: ScopeValues = {
  enhanced_prose: "",
  in_scope_md: "",
  out_of_scope_md: "",
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
  const { data: scope, refetch } = useScope(id);
  const updateBrief = useUpdateBrief();
  const upsertScope = useUpsertScope();
  const [values, setValues] = useState<ScopeValues>(EMPTY);
  const [lastAiDraft, setLastAiDraft] = useState<string>("");
  const [nudge, setNudge] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [autoDraftAttempted, setAutoDraftAttempted] = useState(false);

  useEffect(() => {
    if (scope) {
      const v: ScopeValues = {
        enhanced_prose: scope.enhanced_prose ?? "",
        in_scope_md: scope.in_scope_md ?? "",
        out_of_scope_md: scope.out_of_scope_md ?? "",
        open_questions_md: scope.open_questions_md ?? "",
      };
      setValues(v);
      if (scope.ai_drafted) setLastAiDraft(concat(v));
    }
  }, [scope]);

  // Auto-draft on first load when no scope row exists yet.
  useEffect(() => {
    if (!brief || scope || drafting || autoDraftAttempted) return;
    setAutoDraftAttempted(true);
    void draft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, scope]);

  const draft = async () => {
    if (!id) return;
    setDrafting(true);
    const { data, error } = await supabase.functions.invoke("draft-scope", {
      body: { brief_id: id, nudge: nudge || undefined },
    });
    setDrafting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const s = data.scope;
    const v: ScopeValues = {
      enhanced_prose: s.enhanced_prose,
      in_scope_md: s.in_scope_md,
      out_of_scope_md: s.out_of_scope_md,
      open_questions_md: s.open_questions_md,
    };
    setValues(v);
    setLastAiDraft(concat(v));
    void refetch();
    toast.success("Drafted");
  };

  const save = async () => {
    if (!id) return;
    await upsertScope.mutateAsync({
      brief_id: id,
      ...values,
      ai_drafted: lastAiDraft ? isMostlyAi(concat(values), lastAiDraft) : false,
    });
    toast.success("Saved");
  };

  const lock = async () => {
    if (!id) return;
    await upsertScope.mutateAsync({
      brief_id: id,
      ...values,
      ai_drafted: lastAiDraft ? isMostlyAi(concat(values), lastAiDraft) : false,
      locked_at: new Date().toISOString(),
      locked_by: userId,
    });
    await updateBrief.mutateAsync({ id, patch: { status: "scoped" } });
    navigate(`/briefs/${id}/builder`);
  };

  if (!brief) return <div className="p-6">Loading…</div>;

  return (
    <div className="container mx-auto max-w-7xl p-6 grid gap-6 lg:grid-cols-[minmax(280px,380px)_1fr]">
      <aside className="space-y-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-label-small text-m-on-surface-variant">Subject</div>
            <div className="text-title-small">{brief.raw_subject}</div>
            <div className="mt-3 text-label-small text-m-on-surface-variant">From</div>
            <div>{brief.sender_email ?? "manual"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-label-small text-m-on-surface-variant mb-2">Raw body</div>
            <pre className="whitespace-pre-wrap text-body-small">{brief.raw_body}</pre>
          </CardContent>
        </Card>
      </aside>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Textarea
            placeholder="Optional redraft nudge…"
            rows={2}
            value={nudge}
            onChange={(e) => setNudge(e.target.value)}
          />
          <Button variant="secondary" onClick={draft} disabled={drafting}>
            {drafting ? "Drafting…" : scope ? "Redraft" : "Draft"}
          </Button>
        </div>
        <ScopeEditor value={values} onChange={(v) => setValues({ ...values, ...v })} />
        <div className="flex gap-2">
          <Button variant="secondary" onClick={save}>Save draft</Button>
          <Button onClick={lock}>Lock scope</Button>
        </div>
      </section>
    </div>
  );
}
