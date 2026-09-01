import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { useServices, useCreateService } from "@/hooks/useServices";
import { useXeroItems } from "@/hooks/useXeroItems";
import { useRules } from "@/hooks/useRules";
import { errorMessage } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface Props {
  excludeIds: Set<string>;
  onPick: (serviceId: string) => void;
  placeholder?: string;
}

export function ServicePicker({ excludeIds, onPick, placeholder }: Props) {
  const { data: services = [], isLoading } = useServices();
  const { data: rules = [] } = useRules();
  const createService = useCreateService();
  // A service created here is sold like any other, so it needs the Xero line it
  // will be invoiced as — otherwise this quiet path around the Services form
  // would keep reintroducing exactly the unmapped services we are working
  // through.
  const { data: xeroItems = [] } = useXeroItems();
  const [newXeroCode, setNewXeroCode] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  // Inline "add a service that isn't in the catalogue yet" mini-form.
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newRuleId, setNewRuleId] = useState("");

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

  function startAdding() {
    setNewName(query.trim());
    setNewPrice("");
    setNewRuleId("");
    setAdding(true);
  }
  function cancelAdding() {
    setAdding(false);
  }
  function handleCreate() {
    const name = newName.trim();
    if (!name || !newRuleId || !newXeroCode || createService.isPending) return;
    createService.mutate(
      {
        name,
        pricing_model: "fixed",
        sell_price_cents: Math.round((Number(newPrice) || 0) * 100),
        rule_id: newRuleId,
        status: "active",
        xero_item_code: newXeroCode,
      },
      {
        onSuccess: (created) => {
          onPick(created.id);
          setAdding(false);
          setNewXeroCode("");
          setQuery("");
          setOpen(false);
          toast.success(`Added "${created.name}"`);
        },
        onError: (e) =>
          toast.error(`Failed to create service: ${errorMessage(e)}`),
      },
    );
  }

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
            // Don't collapse while the add-form is open — interacting with it
            // blurs the search input.
            onBlur={() => setTimeout(() => { if (!adding) setOpen(false); }, 150)}
          />
        </div>
      </div>

      {open && !adding && !isLoading && results.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border bg-popover p-1 shadow-md">
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

      {open && !adding && !isLoading && results.length === 0 && query.trim() && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border bg-popover p-2 text-sm shadow-md">
          <p className="px-1 py-1 text-muted-foreground">No matching service.</p>
          <Button
            variant="ghost"
            className="w-full justify-start text-left"
            onMouseDown={(e) => {
              e.preventDefault();
              startAdding();
            }}
          >
            <Plus className="mr-1 h-4 w-4" /> Add "{query.trim()}" as a new service
          </Button>
        </div>
      )}

      {adding && (
        <div className="absolute z-10 mt-1 w-full space-y-3 rounded-lg border bg-popover p-3 shadow-md">
          <div className="text-title-small">New service</div>
          <div className="space-y-1.5">
            <Label className="text-label-small text-m-on-surface-variant">Name</Label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Service name" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-label-small text-m-on-surface-variant">Price (ZAR)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-label-small text-m-on-surface-variant">Department</Label>
              <select
                value={newRuleId}
                onChange={(e) => setNewRuleId(e.target.value)}
                className="h-10 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="">Select…</option>
                {rules.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-label-small text-m-on-surface-variant">Invoice line (Xero)</Label>
            <select
              value={newXeroCode}
              onChange={(e) => setNewXeroCode(e.target.value)}
              className="h-10 w-full rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Select…</option>
              {xeroItems.map((x) => (
                <option key={x.code} value={x.code}>{x.name}</option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={cancelAdding} disabled={createService.isPending}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!newName.trim() || !newRuleId || !newXeroCode || createService.isPending}
            >
              {createService.isPending ? "Adding…" : "Add & select"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
