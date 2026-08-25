// src/components/signoffs/DraftSignoffsDialog.tsx
//
// Bulk-drafting sign-offs from the briefs ClickUp already flags as waiting on
// a client. The suggested title is a starting point, never an answer: nothing
// is written until a person has read every row, and a row with an empty ask
// cannot be included. That constraint is the point — the ask is the one field
// that makes a client understand what is actually wanted from them.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCreateSignoffs,
  useSignoffCandidates,
  type SignoffCandidate,
} from "@/hooks/useSignoffCandidates";
import { looksInternal } from "@/lib/client-title";
import { errorMessage } from "@/lib/utils";

type DraftState = Record<string, { include: boolean; title: string; ask: string }>;

function seedState(candidates: SignoffCandidate[]): DraftState {
  const next: DraftState = {};
  for (const c of candidates) {
    next[c.briefId] = { include: false, title: c.suggestedTitle, ask: "" };
  }
  return next;
}

export function DraftSignoffsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: candidates = [], isPending, isError, error } = useSignoffCandidates();
  const create = useCreateSignoffs();
  const [state, setState] = useState<DraftState>({});

  // Re-seed whenever the dialog opens on a fresh candidate set, so a row
  // someone already sent does not linger with stale text.
  useEffect(() => {
    if (open) setState(seedState(candidates));
  }, [open, candidates]);

  function patch(id: string, next: Partial<DraftState[string]>) {
    setState((prev) => ({ ...prev, [id]: { ...prev[id], ...next } }));
  }

  const ready = candidates.filter((c) => {
    const row = state[c.briefId];
    return row?.include && row.title.trim() && row.ask.trim();
  });
  const incomplete = candidates.filter((c) => {
    const row = state[c.briefId];
    return row?.include && (!row.title.trim() || !row.ask.trim());
  });

  function handleCreate() {
    create.mutate(
      ready.map((c) => ({
        briefId: c.briefId,
        clientId: c.clientId,
        clientTitle: state[c.briefId].title,
        ask: state[c.briefId].ask,
        dueDate: c.dueDate,
      })),
      {
        onSuccess: (n) => {
          toast.success(`${n} ${n === 1 ? "sign-off" : "sign-offs"} created`);
          onOpenChange(false);
        },
        onError: (e) => toast.error(`Could not create: ${errorMessage(e)}`),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Grid children default to min-width:auto, so a long subject would push
          the track wider than the panel and clip every row's right edge.
          min-w-0 on the children is what keeps the inputs inside the dialog. */}
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>Draft sign-offs from ClickUp</DialogTitle>
          <DialogDescription>
            Briefs sitting in a waiting-on-client status that haven&apos;t been sent for
            sign-off yet. Titles are suggestions with the internal tags stripped — read
            each one, because this is the text the client sees. The ask is what tells them
            what you actually need, so it can&apos;t be left blank.
          </DialogDescription>
        </DialogHeader>

        {isError ? (
          <p className="text-body-medium text-m-error">
            Could not load candidates: {errorMessage(error)}
          </p>
        ) : isPending ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-20 rounded-md" />
            ))}
          </div>
        ) : candidates.length === 0 ? (
          <p className="py-6 text-body-medium text-m-on-surface-variant">
            Nothing to draft. Every brief ClickUp has flagged as waiting on a client has
            already been sent for sign-off.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {candidates.map((c) => {
              const row = state[c.briefId] ?? { include: false, title: "", ask: "" };
              const noisy = looksInternal(row.title);
              return (
                <div
                  key={c.briefId}
                  className="rounded-lg border border-m-outline-variant p-3"
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id={`inc-${c.briefId}`}
                      checked={row.include}
                      onCheckedChange={(v) => patch(c.briefId, { include: v === true })}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1 space-y-2">
                      <label
                        htmlFor={`inc-${c.briefId}`}
                        className="block text-label-medium text-m-on-surface-variant"
                      >
                        {c.clientName}
                        {c.dueDate ? ` · was due ${c.dueDate}` : ""}
                      </label>

                      <Input
                        value={row.title}
                        onChange={(e) => patch(c.briefId, { title: e.target.value })}
                        placeholder="What the client sees"
                        aria-label={`Client-facing title for ${c.clientName}`}
                      />
                      <Input
                        value={row.ask}
                        onChange={(e) => patch(c.briefId, { ask: e.target.value })}
                        placeholder="What we need from them, in one line"
                        aria-label={`The ask for ${c.clientName}`}
                      />

                      {noisy && (
                        <p className="flex items-center gap-1.5 text-label-small text-m-error">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Still has internal tags in it — a client will see this.
                        </p>
                      )}
                      <p className="truncate text-label-small text-m-on-surface-variant">
                        From: {c.rawSubject}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <p className="text-body-small text-m-on-surface-variant">
            {incomplete.length > 0
              ? `${incomplete.length} ticked ${incomplete.length === 1 ? "row needs" : "rows need"} a title and an ask.`
              : `${ready.length} ready to create.`}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={ready.length === 0 || create.isPending}>
              {create.isPending ? "Creating…" : `Create ${ready.length || ""}`.trim()}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
