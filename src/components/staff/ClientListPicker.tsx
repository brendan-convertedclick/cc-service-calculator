import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ClientOption } from "./ClientSelectField";

type ClientListPickerProps = {
  /** Id of the search box, which the "Client" label points at. */
  id: string;
  clients: ClientOption[];
  value: string;
  onValueChange: (value: string) => void;
  /** Defaults to "Client"; the speed brief reuses this list for procedures. */
  label?: string;
  /** Enter in the search box picks the top match. Off by default: on the staff
   *  forms the picker sits inside a form, where Enter belongs to the form. */
  pickOnEnter?: boolean;
  autoFocus?: boolean;
};

/**
 * The left-hand client column on the staff brief and meeting forms: a
 * searchable, always-open list in a panel, so the client is one click rather
 * than a dropdown to open and scroll.
 */
export function ClientListPicker({
  id,
  clients,
  value,
  onValueChange,
  label = "Client",
  pickOnEnter = false,
  autoFocus = false,
}: ClientListPickerProps) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients;
  }, [clients, query]);

  // A default or saved client can sit far down the list; bring it into view
  // inside the panel (not the page) so the selection is never hidden.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !el) return;
    const top = el.offsetTop;
    if (top < list.scrollTop || top + el.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top - list.clientHeight / 2;
    }
  }, [value, clients]);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="space-y-2 rounded-lg border border-m-outline-variant bg-m-surface-container-low p-2">
        <Input
          id={id}
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Only once something is typed: an empty search + Enter is left to
            // the enclosing form, so it can mean "skip" rather than "pick row 1".
            if (!pickOnEnter || e.key !== "Enter" || !query.trim() || !visible[0]) return;
            // preventDefault tells an enclosing key handler this Enter is spent.
            e.preventDefault();
            onValueChange(visible[0].id);
          }}
          placeholder="Search…"
        />
        <div
          ref={listRef}
          role="listbox"
          aria-label={label}
          className="relative max-h-64 space-y-0.5 overflow-y-auto sm:max-h-[36rem]"
        >
          {visible.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={c.id === value}
              onClick={() => onValueChange(c.id)}
              className={`flex w-full rounded-md px-2.5 py-1.5 text-left text-label-large tracking-normal transition-colors ${
                c.id === value
                  ? "bg-m-primary-container font-medium text-m-on-primary-container"
                  : "text-m-on-surface hover:bg-m-surface-container-high"
              }`}
            >
              {c.name}
            </button>
          ))}
          {visible.length === 0 && (
            <p className="px-2.5 py-1.5 text-label-medium text-m-on-surface-variant">No match</p>
          )}
        </div>
      </div>
    </div>
  );
}
