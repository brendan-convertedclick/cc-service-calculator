import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import MDEditor from "@uiw/react-md-editor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type ScopeValues = {
  enhanced_prose: string;
  in_scope_md: string;
  out_of_scope_md: string;
  open_questions_md: string;
};

type Props = {
  value: ScopeValues;
  onChange: (v: Partial<ScopeValues>) => void;
  disabled?: boolean;
};

type CheckItem = { id: number; text: string; checked: boolean };

/** Markdown bullet list → items (bullets or bare lines, one item per line). */
function parseItems(md: string): string[] {
  return md
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean);
}

/** Only ticked items survive into the stored markdown — unticked is left out. */
function serialize(items: CheckItem[]): string {
  return items
    .filter((i) => i.checked && i.text.trim())
    .map((i) => `- ${i.text.trim()}`)
    .join("\n");
}

/**
 * Checklist over a markdown bullet list. Every item defaults to ticked;
 * unticking excludes it from the saved scope (it stays visible, struck
 * through, until you leave the page). Item text stays editable inline.
 */
function ChecklistSection({
  label,
  md,
  disabled,
  onMdChange,
}: {
  label: string;
  md: string;
  disabled?: boolean;
  onMdChange: (md: string) => void;
}) {
  const [items, setItems] = useState<CheckItem[]>([]);
  const [newText, setNewText] = useState("");
  const nextId = useRef(0);
  const seeded = useRef(false);

  // Seed once from the incoming markdown (the scope row loads async). After
  // seeding, this component is the source of truth and pushes serialized
  // (ticked-only) markdown up on every change.
  useEffect(() => {
    if (seeded.current || !md.trim()) return;
    seeded.current = true;
    setItems(
      parseItems(md).map((text) => ({ id: nextId.current++, text, checked: true })),
    );
  }, [md]);

  const commit = (next: CheckItem[]) => {
    setItems(next);
    onMdChange(serialize(next));
  };

  const addItem = () => {
    const text = newText.trim();
    if (!text) return;
    commit([...items, { id: nextId.current++, text, checked: true }]);
    setNewText("");
  };

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-4">
        <Label>{label}</Label>
        <span className="text-label-small text-m-on-surface-variant">
          Unticked items are left out of the scope
        </span>
      </div>
      <div className="rounded-lg border border-input">
        {items.length === 0 && (
          <p className="px-3 py-2.5 text-body-small text-m-on-surface-variant">
            Nothing here yet — add an item below.
          </p>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2.5 border-b border-m-outline-variant px-3 py-1.5 last:border-b-0"
          >
            <Checkbox
              checked={item.checked}
              disabled={disabled}
              aria-label={`Include "${item.text}"`}
              onCheckedChange={(checked) =>
                commit(
                  items.map((i) =>
                    i.id === item.id ? { ...i, checked: checked === true } : i,
                  ),
                )
              }
            />
            <Input
              value={item.text}
              disabled={disabled}
              aria-label={`Text for "${item.text}"`}
              className={cn(
                "h-10 border-transparent px-1 shadow-none focus-visible:border-input",
                !item.checked && "text-m-on-surface-variant line-through",
              )}
              onChange={(e) =>
                commit(
                  items.map((i) =>
                    i.id === item.id ? { ...i, text: e.target.value } : i,
                  ),
                )
              }
            />
          </div>
        ))}
        <div className="flex items-center gap-2 px-3 py-1.5">
          <Plus className="h-4 w-4 shrink-0 text-m-outline" aria-hidden />
          <Input
            value={newText}
            disabled={disabled}
            placeholder="Add an item…"
            aria-label={`Add ${label} item`}
            className="h-10 border-transparent px-1 shadow-none focus-visible:border-input"
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addItem();
              }
            }}
            onBlur={addItem}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || !newText.trim()}
            onClick={addItem}
          >
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ScopeEditor({ value, onChange, disabled }: Props) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Clarified summary</Label>
        <div data-color-mode="light">
          <MDEditor
            value={value.enhanced_prose}
            onChange={(v) => onChange({ enhanced_prose: v ?? "" })}
            height={4 * 28}
            textareaProps={{ disabled }}
            preview="edit"
          />
        </div>
      </div>
      <ChecklistSection
        label="In scope"
        md={value.in_scope_md}
        disabled={disabled}
        onMdChange={(md) => onChange({ in_scope_md: md })}
      />
      <ChecklistSection
        label="Out of scope"
        md={value.out_of_scope_md}
        disabled={disabled}
        onMdChange={(md) => onChange({ out_of_scope_md: md })}
      />
      <ChecklistSection
        label="Open questions"
        md={value.open_questions_md}
        disabled={disabled}
        onMdChange={(md) => onChange({ open_questions_md: md })}
      />
    </div>
  );
}
