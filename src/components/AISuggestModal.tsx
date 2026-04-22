import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type Suggestion = {
  service_id: string;
  service_name: string;
  qty: number;
  confidence: number;
  reasoning: string;
};

type Props = {
  open: boolean;
  suggestions: Suggestion[];
  onClose: () => void;
  onAccept: (accepted: Suggestion[]) => void;
};

export function AISuggestModal({ open, suggestions, onClose, onAccept }: Props) {
  const [decisions, setDecisions] = useState<Record<string, "accept" | "reject" | "skip">>({});

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Suggested services</DialogTitle></DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-auto">
          {suggestions.map((s) => (
            <div key={s.service_id} className="rounded-md border border-m-outline-variant p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-title-small">{s.service_name}</div>
                  <div className="text-label-small text-m-on-surface-variant">
                    Qty {s.qty} · Confidence {(s.confidence * 100).toFixed(0)}%
                  </div>
                  <div className="mt-1 text-body-small">{s.reasoning}</div>
                </div>
                <div className="flex gap-1">
                  {(["accept", "reject", "skip"] as const).map((d) => (
                    <Button
                      key={d}
                      size="sm"
                      variant={decisions[s.service_id] === d ? "default" : "secondary"}
                      onClick={() => setDecisions({ ...decisions, [s.service_id]: d })}
                    >
                      {d}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              const accepted = suggestions.filter((s) => decisions[s.service_id] === "accept");
              onAccept(accepted);
            }}
          >
            Add accepted
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
