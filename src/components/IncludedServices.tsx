import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  useServiceChildren,
  useAddServiceChild,
  useUpdateServiceChildQuantity,
  useRemoveServiceChild,
  useReorderServiceChildren,
  useServiceAncestors,
} from "@/hooks/useServiceChildren";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ServicePicker } from "@/components/ServicePicker";

interface Props {
  serviceId: string;
}

export function IncludedServices({ serviceId }: Props) {
  const { data: children = [], isLoading } = useServiceChildren(serviceId);
  const { data: ancestors = new Set<string>() } = useServiceAncestors(serviceId);
  const add = useAddServiceChild();
  const updateQty = useUpdateServiceChildQuantity();
  const remove = useRemoveServiceChild();
  const reorder = useReorderServiceChildren();

  const excludeIds = useMemo(() => {
    const s = new Set<string>();
    s.add(serviceId);
    for (const a of ancestors) s.add(a);
    for (const c of children) s.add(c.child_id);
    return s;
  }, [serviceId, ancestors, children]);

  function move(childId: string, direction: -1 | 1) {
    const ordered = children.map((c) => c.child_id);
    const i = ordered.indexOf(childId);
    const j = i + direction;
    if (j < 0 || j >= ordered.length) return;
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    reorder.mutate(
      { parentId: serviceId, orderedChildIds: ordered },
      { onError: (e: Error) => toast.error(e.message) }
    );
  }

  return (
    <div className="space-y-3">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : children.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          No included services yet. Add one below to make this a bundle.
        </p>
      ) : (
        <ol className="space-y-2">
          {children.map((c, i) => (
            <li key={c.child_id} className="rounded-lg border bg-background p-3">
              <div className="flex items-center gap-3">
                <div className="text-xs font-mono text-muted-foreground w-6">{i + 1}</div>
                <div className="flex-1">
                  <Link
                    to={`/services/${c.child_id}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {c.child.name}
                  </Link>
                  {c.child.code && (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{c.child.code}</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">×</span>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    className="h-10 w-16 text-right"
                    defaultValue={String(c.quantity)}
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
                        toast.error("Quantity must be a positive integer");
                        e.target.value = String(c.quantity);
                        return;
                      }
                      if (n === c.quantity) return;
                      updateQty.mutate(
                        { parentId: serviceId, childId: c.child_id, quantity: n },
                        { onError: (err: Error) => toast.error(err.message) }
                      );
                    }}
                  />
                </div>
                <div className="flex flex-col">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => move(c.child_id, -1)}
                    disabled={i === 0}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => move(c.child_id, 1)}
                    disabled={i === children.length - 1}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() =>
                    remove.mutate(
                      { parentId: serviceId, childId: c.child_id },
                      { onError: (e: Error) => toast.error(e.message) }
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <ServicePicker
        excludeIds={excludeIds}
        placeholder="Add a service to include…"
        onPick={(childId) =>
          add.mutate(
            { parentId: serviceId, childId },
            {
              onError: (e: Error) => {
                const msg = e.message.includes("cycle")
                  ? "Cannot add — this would create a loop."
                  : e.message;
                toast.error(msg);
              },
            }
          )
        }
      />
    </div>
  );
}
