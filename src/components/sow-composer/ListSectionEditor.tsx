import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Section } from "@/types/sow-composer";

type ListSection = Extract<Section, { type: "list" }>;

export interface ListSectionEditorProps {
  section: ListSection;
  onChange: (props: Partial<ListSection["props"]>) => void;
}

export function ListSectionEditor({ section, onChange }: ListSectionEditorProps) {
  const [draft, setDraft] = useState("");
  const items = section.props.items;

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onChange({ items: [...items, v] });
    setDraft("");
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Select
          value={section.props.variant}
          onValueChange={(v) => onChange({ variant: v as ListSection["props"]["variant"] })}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inclusions">Inclusions</SelectItem>
            <SelectItem value="exclusions">Exclusions</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="flex-1 text-body-medium text-m-on-surface">{item}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={`Remove "${item}"`}
              onClick={() => onChange({ items: items.filter((_, j) => j !== i) })}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2">
        <Input
          aria-label="New list item"
          placeholder="Add an item…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1" onClick={add}>
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>
    </div>
  );
}
