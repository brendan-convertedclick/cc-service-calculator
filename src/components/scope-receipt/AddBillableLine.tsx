import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ServicePicker } from "@/components/ServicePicker";

// Empty exclude set — a client can legitimately be quoted the same service more
// than once (e.g. two landing pages), so nothing is filtered out of the picker.
const ALLOW_DUPLICATES: Set<string> = new Set();

interface Props {
  /** Called with the chosen catalogue service id. */
  onPick: (serviceId: string) => void;
  /** True while an insert is in flight — disables the trigger. */
  pending?: boolean;
}

/**
 * Footer affordance under the New billable band: a ghost "+ Add billable line"
 * trigger that reveals the shared ServicePicker inline. Picking a service seeds
 * a new billable line (via the parent's onPick → useAddPlacement) and collapses
 * the picker. Mirrors the "+ Add task" pattern one level up.
 */
export function AddBillableLine({ onPick, pending = false }: Props) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="bg-m-surface px-2 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-amber-800 hover:bg-amber-100/60"
          onClick={() => setOpen(true)}
          disabled={pending}
        >
          <Plus className="h-4 w-4" />
          Add billable line
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 bg-m-surface px-3 py-2.5">
      <ServicePicker
        excludeIds={ALLOW_DUPLICATES}
        placeholder="Search services to add as a billable line…"
        onPick={(serviceId) => {
          onPick(serviceId);
          setOpen(false);
        }}
      />
      <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}

export default AddBillableLine;
