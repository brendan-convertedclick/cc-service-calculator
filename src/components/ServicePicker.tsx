import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useServices } from "@/hooks/useServices";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Props {
  excludeIds: Set<string>;
  onPick: (serviceId: string) => void;
  placeholder?: string;
}

export function ServicePicker({ excludeIds, onPick, placeholder }: Props) {
  const { data: services = [], isLoading } = useServices();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const LIMIT = 50;
  const { results, matchCount } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = services
      .filter((s) => !excludeIds.has(s.id))
      .filter((s) => {
        if (!q) return true;
        const hay = `${s.name} ${s.code ?? ""}`.toLowerCase();
        return hay.includes(q);
      });
    return { results: matched.slice(0, LIMIT), matchCount: matched.length };
  }, [services, query, excludeIds]);

  const truncated = matchCount > results.length;

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={placeholder ?? "Search services to add…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
          />
        </div>
      </div>
      {open && !isLoading && results.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          {results.map((s) => (
            <li key={s.id}>
              <Button
                variant="ghost"
                className="w-full justify-start text-left"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(s.id);
                  setQuery("");
                }}
              >
                <span className="font-medium">{s.name}</span>
                {s.code && <span className="ml-2 font-mono text-xs text-muted-foreground">{s.code}</span>}
              </Button>
            </li>
          ))}
          {truncated && (
            <li className="sticky bottom-0 border-t bg-popover px-3 py-1.5 text-xs text-muted-foreground">
              Showing first {results.length} of {matchCount} — keep typing to narrow
            </li>
          )}
        </ul>
      )}
      {open && !isLoading && results.length === 0 && query.trim() && (
        <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover p-3 text-sm text-muted-foreground shadow-md">
          No matches.
        </div>
      )}
    </div>
  );
}
