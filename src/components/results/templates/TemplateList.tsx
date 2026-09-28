// src/components/results/templates/TemplateList.tsx
//
// Left rail of the template editor: one master template per row, "+ New
// template" at the bottom. Selecting a template goes through the caller's
// unsaved-changes guard.

import { cn } from "@/lib/utils";
import type { ResultsTemplate } from "@/lib/results-grid";

export function TemplateList({
  templates,
  selectedId,
  onSelect,
  onNew,
}: {
  templates: ResultsTemplate[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1 border-r border-m-outline-variant pr-4" aria-label="Templates">
      {templates.map((t) => {
        const liveCount = t.fields.filter((f) => !f.retired_at).length;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            aria-current={t.id === selectedId}
            className={cn(
              "rounded-md px-3 py-2 text-left transition-colors hover:bg-m-surface-container-high",
              t.id === selectedId && "bg-m-secondary-container",
            )}
          >
            <div className="text-body-medium font-medium text-m-on-surface">{t.name}</div>
            <div className="text-label-small text-m-on-surface-variant">
              {liveCount} metric{liveCount === 1 ? "" : "s"}
            </div>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onNew}
        className="mt-2 rounded-md px-3 py-2 text-left text-label-large text-primary hover:bg-m-surface-container-high"
      >
        + New template
      </button>
    </nav>
  );
}
