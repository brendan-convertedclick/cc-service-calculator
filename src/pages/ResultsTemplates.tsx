// src/pages/ResultsTemplates.tsx
//
// Master template library, admin/owner-gated by the route (App.tsx wraps
// /results/templates in RequireAdmin; RLS backs it up on the write side).
// See docs/superpowers/specs/2026-09-28-school-year-results-design.md,
// "Templates" and rules 3–6.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorMessage } from "@/lib/utils";
import { todayISO } from "@/lib/dates";
import { useAddTemplate, useFieldValueCounts, useResultTemplates, useSaveTemplate } from "@/hooks/useResults";
import type { ResultsTemplate, ResultsTemplateField } from "@/lib/results-grid";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { TemplateList } from "@/components/results/templates/TemplateList";
import { TemplateEditor } from "@/components/results/templates/TemplateEditor";
import { useTemplateUsage } from "@/components/results/templates/useTemplateUsage";
import type { DraftField } from "@/components/results/templates/types";

interface Draft {
  name: string;
  fields: DraftField[];
}

function fieldToDraft(f: ResultsTemplateField): DraftField {
  return {
    id: f.id,
    label: f.label,
    short_label: f.short_label,
    type: f.type,
    phase: f.phase,
    star: f.star,
    target_field_id: f.target_field_id,
    retired_at: f.retired_at,
    _key: f.id,
  };
}

function snapshot(t: ResultsTemplate): Draft {
  return { name: t.name, fields: t.fields.map(fieldToDraft) };
}

/** Content equality, ignoring `id`/`_key` — a freshly saved field has no id
 * in the draft until the next reselect, but its content already matches what
 * was written, so it must read as clean rather than permanently dirty. */
function normalize(d: Draft) {
  return {
    name: d.name,
    fields: d.fields.map((f) => ({
      label: f.label,
      short_label: f.short_label,
      type: f.type,
      phase: f.phase,
      star: f.star,
      target_field_id: f.target_field_id,
      retired_at: f.retired_at,
    })),
  };
}

let newFieldSeq = 0;

export function ResultsTemplates() {
  const { data: templates = [], isLoading } = useResultTemplates();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const saveTemplate = useSaveTemplate();
  const addTemplate = useAddTemplate();
  const { data: lockedIds = new Set<string>() } = useFieldValueCounts(selectedId ?? undefined);
  const { data: usage } = useTemplateUsage(selectedId ?? undefined);
  const navigate = useNavigate();

  const base = useMemo(() => {
    const t = templates.find((t) => t.id === selectedId);
    return t ? snapshot(t) : null;
  }, [templates, selectedId]);

  const dirty = !!draft && !!base && JSON.stringify(normalize(draft)) !== JSON.stringify(normalize(base));
  const { pending, setPending, guard } = useUnsavedChanges(dirty);

  // Auto-select the first template once the library loads, and pick up a
  // template just selected/created below.
  useEffect(() => {
    if (!selectedId && templates.length) {
      setSelectedId(templates[0].id);
      setDraft(snapshot(templates[0]));
    }
  }, [templates, selectedId]);

  function selectTemplate(id: string) {
    if (id === selectedId) return;
    guard(() => {
      const t = templates.find((t) => t.id === id);
      if (!t) return;
      setSelectedId(id);
      setDraft(snapshot(t));
    });
  }

  function newTemplate() {
    guard(() => {
      addTemplate.mutate("New template", {
        onSuccess: (id) => {
          setSelectedId(id);
          setDraft({
            name: "New template",
            fields: [
              {
                id: undefined,
                label: "What we'll do",
                short_label: null,
                type: "text",
                phase: "plan",
                star: false,
                target_field_id: null,
                retired_at: null,
                _key: `new-${++newFieldSeq}`,
              },
              {
                id: undefined,
                label: "What we'd change",
                short_label: null,
                type: "text",
                phase: "result",
                star: false,
                target_field_id: null,
                retired_at: null,
                _key: `new-${++newFieldSeq}`,
              },
            ],
          });
        },
        onError: (e) => toast.error(`Could not create the template: ${errorMessage(e)}`),
      });
    });
  }

  function updateField(key: string, patch: Partial<DraftField>) {
    setDraft((d) => (d ? { ...d, fields: d.fields.map((f) => (f._key === key ? { ...f, ...patch } : f)) } : d));
  }

  function toggleStar(key: string) {
    setDraft((d) => {
      if (!d) return d;
      const target = d.fields.find((f) => f._key === key);
      if (!target || target.phase !== "result" || target.retired_at) return d;
      if (target.star) {
        return { ...d, fields: d.fields.map((f) => (f._key === key ? { ...f, star: false } : f)) };
      }
      // Rule 5: at most two stars — starring a third unstars the oldest
      // (earliest by ordinal, i.e. array order).
      const starred = d.fields.filter((f) => f.star && f.phase === "result");
      const toUnstar = starred.length >= 2 ? starred[0]._key : null;
      return {
        ...d,
        fields: d.fields.map((f) => {
          if (f._key === key) return { ...f, star: true };
          if (f._key === toUnstar) return { ...f, star: false };
          return f;
        }),
      };
    });
  }

  function toggleRetire(key: string) {
    setDraft((d) => {
      if (!d) return d;
      return {
        ...d,
        fields: d.fields.map((f) => {
          if (f._key !== key) return f;
          const retiring = !f.retired_at;
          return { ...f, retired_at: retiring ? todayISO() : null, star: retiring ? false : f.star };
        }),
      };
    });
  }

  function addField(phase: "plan" | "result") {
    setDraft((d) =>
      d
        ? {
            ...d,
            fields: [
              ...d.fields,
              {
                id: undefined,
                label: "New metric",
                short_label: "",
                type: "number",
                phase,
                star: false,
                target_field_id: null,
                retired_at: null,
                _key: `new-${++newFieldSeq}`,
              },
            ],
          }
        : d,
    );
  }

  function save() {
    if (!draft || !selectedId) return;
    saveTemplate.mutate(
      { templateId: selectedId, name: draft.name, fields: draft.fields.map(({ _key: _k, ...f }) => f) },
      { onError: (e) => toast.error(`Could not save: ${errorMessage(e)}`) },
    );
  }

  function discard() {
    if (base) setDraft(base);
  }

  if (isLoading) return <div className="p-6 text-body-medium text-m-on-surface-variant">Loading templates…</div>;

  return (
    <div className="grid gap-6 p-6 lg:grid-cols-[220px_1fr_280px]">
      <TemplateList templates={templates} selectedId={selectedId} onSelect={selectTemplate} onNew={newTemplate} />

      <div>
        {draft && selectedId ? (
          <TemplateEditor
            name={draft.name}
            fields={draft.fields}
            usage={usage}
            lockedIds={lockedIds}
            saving={saveTemplate.isPending}
            dirty={dirty}
            onNameChange={(name) => setDraft((d) => (d ? { ...d, name } : d))}
            onFieldChange={updateField}
            onToggleStar={toggleStar}
            onToggleRetire={toggleRetire}
            onAddField={addField}
            onSave={save}
            onDiscard={discard}
          />
        ) : (
          <p className="text-body-medium text-m-on-surface-variant">No templates yet. Start one with "+ New template".</p>
        )}
      </div>

      <aside className="grid gap-3 rounded-lg border border-m-outline-variant bg-m-surface-container p-4 text-body-small">
        <h3 className="text-title-small">How templates stay comparable</h3>
        <ul className="grid gap-2 text-m-on-surface-variant">
          <li>
            <b className="text-m-on-surface">One master, every client.</b> A template is edited here once and every
            client's rows pick it up. There are no per-client copies to drift apart.
          </li>
          <li>
            <b className="text-m-on-surface">Each metric has a fixed identity.</b> Renaming a metric keeps every past
            value attached, so this year still compares with last year.
          </li>
          <li>
            <b className="text-m-on-surface">Metrics are retired, never deleted.</b> A retired metric stops being
            asked for. Past values stay and still show when you compare.
          </li>
          <li>
            <b className="text-m-on-surface">A metric's type locks once it has data.</b> A number can't quietly
            become text. Need a different kind of value? Add a new metric.
          </li>
          <li>
            <b className="text-m-on-surface">Stars choose what the grid shows.</b> Up to two starred results appear
            in each cell. The first star is the one shown for compared years.
          </li>
        </ul>
      </aside>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>Leaving now throws them away. Save them first, or discard them and go.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Stay here
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const exit = pending;
                if (base) setDraft(base);
                setPending(null);
                if (exit?.kind === "href") navigate(exit.href);
                else exit?.run();
              }}
            >
              Discard and leave
            </Button>
            <Button
              disabled={saveTemplate.isPending}
              onClick={() => {
                const exit = pending;
                setPending(null);
                if (!draft || !selectedId) return;
                saveTemplate.mutate(
                  { templateId: selectedId, name: draft.name, fields: draft.fields.map(({ _key: _k, ...f }) => f) },
                  {
                    onSuccess: () => {
                      if (exit?.kind === "href") navigate(exit.href);
                      else exit?.run();
                    },
                    onError: (e) => toast.error(`Could not save: ${errorMessage(e)}`),
                  },
                );
              }}
            >
              Save and leave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
