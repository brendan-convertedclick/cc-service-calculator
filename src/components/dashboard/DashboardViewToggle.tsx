import { Columns3, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DashboardView } from "@/hooks/useDashboardView";

const OPTIONS: { key: DashboardView; label: string; Icon: typeof LayoutGrid; title: string }[] = [
  { key: "bento", label: "Grid", Icon: LayoutGrid, title: "Bento grid" },
  { key: "board", label: "Board", Icon: Columns3, title: "Status board" },
];

interface Props {
  view: DashboardView;
  onChange: (v: DashboardView) => void;
}

/** Segmented control that switches the operations overview between the two layouts. */
export function DashboardViewToggle({ view, onChange }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Dashboard layout"
      className="inline-flex shrink-0 items-center rounded-md border border-m-outline-variant bg-m-surface-container-low p-0.5"
    >
      {OPTIONS.map(({ key, label, Icon, title }) => {
        const active = key === view;
        return (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={active}
            title={title}
            onClick={() => onChange(key)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-3 text-label-medium font-medium transition-all",
              active
                ? "bg-m-surface text-m-on-surface shadow-elev-1"
                : "text-m-on-surface-variant hover:text-m-on-surface",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
