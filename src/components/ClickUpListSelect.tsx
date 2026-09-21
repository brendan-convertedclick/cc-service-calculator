// The one "List" dropdown (Lisa, 2026-09-21). Five screens asked the same
// question with five copies of the same flat `lists.map(...)`, which is why
// every client's dropdown looked different: they were showing ClickUp's real
// list names, in alphabetical order, with a campaign plan sitting between
// Content and Development.
//
// Grouping is the whole change. The names stay exactly as ClickUp has them,
// because that is what the user will look for there and what gets written to
// briefs.clickup_list_name; only the headings and the order are Conductor's.
// See @/lib/clickup-list-groups for the order and why it is not alphabetical.
import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { groupListsByWorkStream, type ClickUpListOption } from "@/lib/clickup-list-groups";

export interface ClickUpListSelectProps {
  id: string;
  lists: ClickUpListOption[];
  value: string;
  onValueChange: (v: string) => void;
  /** No client picked yet — the dropdown has nothing to offer and says so. */
  hasClient?: boolean;
  loading?: boolean;
  error?: string | null;
  label?: string;
  disabled?: boolean;
  /** Overrides the default placeholder. Each screen words the empty state for
   *  its own situation — the quick brief can fall back to a server-picked
   *  list, the staff form cannot — so the copy stays with the caller. */
  placeholder?: string;
  /** Rendered inside the field's own block, under the select. */
  children?: ReactNode;
  /** Width and spacing are the caller's; the dropdown is not. */
  className?: string;
}

export function ClickUpListSelect({
  id,
  lists,
  value,
  onValueChange,
  hasClient = true,
  loading = false,
  error = null,
  label = "List / department",
  disabled,
  placeholder,
  children,
  className = "space-y-2",
}: ClickUpListSelectProps) {
  const groups = useMemo(() => groupListsByWorkStream(lists), [lists]);

  const fallbackPlaceholder = !hasClient
    ? "Pick a client first"
    : loading
      ? "Loading lists…"
      : lists.length === 0
        ? "No lists found"
        : "Pick a list";

  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onValueChange} disabled={disabled ?? !hasClient}>
        <SelectTrigger id={id}>
          <SelectValue placeholder={placeholder ?? fallbackPlaceholder} />
        </SelectTrigger>
        <SelectContent>
          {groups.map((g) => (
            <SelectGroup key={g.label}>
              <SelectLabel>{g.label}</SelectLabel>
              {g.options.map((l) => (
                <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {children}
      {error && !children && <p className="text-body-small text-destructive">{error}</p>}
    </div>
  );
}
