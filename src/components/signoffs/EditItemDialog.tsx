// src/components/signoffs/EditItemDialog.tsx
//
// The rest of the CRUD on one ask: change what it says, when it is needed, what
// it points at — or take it off the list.
//
// SIX fields and no more. `item_type`, `state` and `owed_by` each have a check
// constraint hanging off them (an idea must be parked, an event must be noted,
// only an agreement may be owed by us, a decision must move with its stamp), so
// each of those is its own act with its own control: the state moves in
// ActivityPanel, and the type does not move at all — an idea that turns out to
// be a question gets asked as one, which is the whole point of 0148.
//
// Editing a settled row is allowed and rewrites nothing: decided_title and
// decided_ask were frozen at the click (0142), and EvidenceDialog reads those
// and flags the drift. The line at the top says so, because someone editing an
// approved item deserves to know it does not touch the record.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DocLinksField } from "@/components/systems/DocLinksField";
import { useDeleteApproval, useUpdateApproval } from "@/hooks/useClientAsks";
import { errorMessage } from "@/lib/utils";
import type { SignoffRow } from "@/hooks/useClientSignoffs";

export function EditItemDialog({
  row,
  onOpenChange,
}: {
  /** The item being edited. Undefined closes the dialog. */
  row: SignoffRow | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateApproval();
  const remove = useDeleteApproval();

  const [title, setTitle] = useState("");
  const [ask, setAsk] = useState("");
  const [detail, setDetail] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [weighty, setWeighty] = useState(false);
  const [links, setLinks] = useState<string[]>([]);

  // Reload the form whenever a different item is opened. Without this a
  // half-edited title follows the reader onto the next item and gets saved
  // over the wrong row.
  useEffect(() => {
    if (!row) return;
    setTitle(row.client_title);
    setAsk(row.ask);
    setDetail(row.detail ?? "");
    setDueDate(row.due_date ?? "");
    setWeighty(row.weighty);
    setLinks(row.links);
  }, [row]);

  const settled = row?.state === "approved" || row?.state === "changes_requested";
  const canSave = !!title.trim() && !!ask.trim();

  /**
   * window.confirm, as everywhere else destructive in this app (SystemsList,
   * SowList). The message is NAMED rather than "are you sure": what goes with
   * it is the whole conversation, including messages that were emailed to
   * somebody, and on a settled row the record that they agreed to it.
   */
  function destroy() {
    if (!row) return;
    const warning = settled
      ? ` It is also the record that they signed this off — once it's gone there's nothing to show them.`
      : "";
    if (
      !window.confirm(
        `Delete "${row.client_title}"? This takes the whole conversation with it, including anything we emailed them about it. There's no undo.${warning}`,
      )
    ) {
      return;
    }
    remove.mutate(row.id, {
      onSuccess: () => {
        toast.success("Deleted.");
        onOpenChange(false);
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  }

  function save() {
    if (!row || !canSave) return;
    update.mutate(
      {
        approvalId: row.id,
        patch: {
          client_title: title.trim(),
          ask: ask.trim(),
          detail: detail.trim() || null,
          due_date: dueDate || null,
          weighty,
          links,
        },
      },
      {
        onSuccess: () => {
          toast.success("Saved. The client sees this straight away.");
          onOpenChange(false);
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  }

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit this item</DialogTitle>
          <DialogDescription>
            {settled
              ? "This one is settled. Editing it changes what the client sees from now on — what they actually agreed to was frozen at the click and is unchanged."
              : "The client sees every word of this on their own page."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-title">Title</Label>
            <Input
              id="edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What they are looking at"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-ask">The ask</Label>
            <Textarea
              id="edit-ask"
              value={ask}
              rows={2}
              onChange={(e) => setAsk(e.target.value)}
              placeholder="What you need them to do"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-detail">Detail</Label>
            <Textarea
              id="edit-detail"
              value={detail}
              rows={4}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="Anything else they need to decide. Optional."
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Links</Label>
            <DocLinksField links={links} onWrite={setLinks} noun="item" />
            {/* Said out loud because nothing can enforce it: this column is
                rendered on the client's own page, so an internal ClickUp or
                Notion URL pasted here goes straight to them. */}
            <p className="text-label-small text-m-on-surface-variant">
              These show as buttons on the client&apos;s page — only paste things they may open.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-due">Needed by</Label>
            <Input
              id="edit-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-48"
            />
          </div>

          <label className="flex items-center gap-2">
            <Checkbox checked={weighty} onCheckedChange={(v) => setWeighty(v === true)} />
            <span className="text-body-medium text-m-on-surface">
              Carries liability — mark the sign-off as consequential
            </span>
          </label>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="outline"
            className="gap-1.5 text-m-error"
            disabled={remove.isPending}
            onClick={destroy}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={!canSave || update.isPending}>
              {update.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
