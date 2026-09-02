// src/components/pipeline/AddSchoolDialog.tsx
//
// "Add a school" flags an EXISTING client — Media Mixology schools are
// clients like any other, they just get a year. There is no new-client form
// here; NewClientDialog already does that, and a school with no client row
// yet should be created there first. This only sets is_school/town
// (0150 §9 — the board's own dialog is the sole writer of both).

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { GraduationCap, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useClients } from "@/hooks/useClients";
import { useEnrolSchool } from "@/hooks/usePipelineBoard";
import { errorMessage } from "@/lib/utils";

export function AddSchoolDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: clients } = useClients();
  const enrol = useEnrolSchool();
  const [clientId, setClientId] = useState("");
  const [town, setTown] = useState("");

  useEffect(() => {
    if (!open) return;
    setClientId("");
    setTown("");
  }, [open]);

  const candidates = (clients ?? []).filter((c) => !c.is_school);
  const ready = !!clientId && !!town.trim();

  async function save() {
    try {
      await enrol.mutateAsync({ clientId, town });
      toast.success("Added to the pipeline board.");
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a school</DialogTitle>
          <DialogDescription>
            Puts an existing client on the pipeline board, in Not started. Run its planning session next to
            give it a year.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Client</Label>
            <Combobox
              options={candidates.map((c) => ({ value: c.id, label: c.name }))}
              value={clientId}
              onChange={setClientId}
              placeholder="Search clients…"
              emptyLabel="No clients available — every client is already on the board, or none exist yet."
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="school-town">Town</Label>
            <Input
              id="school-town"
              value={town}
              onChange={(e) => setTown(e.target.value)}
              placeholder="Knysna"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enrol.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!ready || enrol.isPending}>
            {enrol.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <GraduationCap className="mr-1.5 h-4 w-4" />
            )}
            Add to board
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
