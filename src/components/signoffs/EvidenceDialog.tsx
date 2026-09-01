// src/components/signoffs/EvidenceDialog.tsx
//
// What a client actually agreed to, and how we know.
//
// The reason this screen exists at all: `client_title` and `ask` stay editable
// after someone signs. Reading a decision off the live row therefore answers
// "what does this item say today", not "what did they agree to" — and in the
// only conversation that matters those are different questions. 0142 freezes
// both onto the record at the click, and this shows the frozen copy, flagging
// it loudly when the live wording has since moved away from it.
//
// Staff-only. None of this crosses to the client.

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";
import { useSignoffEvidence } from "@/hooks/useClientSignoffs";
import { errorMessage } from "@/lib/utils";

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-1.5">
      <dt className="text-label-medium text-m-on-surface-variant">{label}</dt>
      <dd className="min-w-0 break-words text-body-medium text-m-on-surface">
        {value?.trim() ? value : "—"}
      </dd>
    </div>
  );
}

export function EvidenceDialog({
  open,
  onOpenChange,
  approvalId,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  approvalId: string | undefined;
  title: string;
}) {
  const { data, isPending, isError, error } = useSignoffEvidence(open ? approvalId : undefined);

  // Rows decided before 0142 have no frozen copy. Fall back to the live text
  // rather than showing nothing, but say which one you are reading — an
  // unlabelled fallback is exactly the ambiguity this dialog exists to remove.
  const frozenTitle = data?.decided_title ?? null;
  const frozenAsk = data?.decided_ask ?? null;
  const drifted =
    !!data &&
    ((frozenTitle !== null && frozenTitle !== data.client_title) ||
      (frozenAsk !== null && frozenAsk !== data.ask));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>What they agreed to</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>

        {isError ? (
          <p className="text-body-medium text-m-error">{errorMessage(error)}</p>
        ) : isPending || !data ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 rounded-md" />
            <Skeleton className="h-6 rounded-md" />
            <Skeleton className="h-6 rounded-md" />
          </div>
        ) : !data.decided_at ? (
          <p className="text-body-medium text-m-on-surface-variant">
            Nobody has decided this yet, so there is nothing on the record.
          </p>
        ) : (
          <>
            {drifted ? (
              <div className="flex items-start gap-2 rounded-lg border border-m-outline-variant bg-m-surface-container p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-m-error" />
                <p className="text-body-small text-m-on-surface-variant">
                  The wording has been edited since this was agreed. What follows is what
                  they actually saw and signed — not what the item says now.
                </p>
              </div>
            ) : null}

            <dl className="divide-y divide-m-outline-variant/60">
              <Row label="Signed by" value={data.decided_by_name} />
              <Row label="Email" value={data.decided_by_email} />
              <Row
                label="Identity"
                value={
                  data.decided_by_contact_id
                    ? "Their own link — resolved from the token, not typed"
                    : "Chosen from the contact list on a shared link"
                }
              />
              <Row
                label="When"
                value={new Date(data.decided_at).toLocaleString("en-ZA")}
              />
              <Row label="Title as signed" value={frozenTitle ?? `${data.client_title} (live — not frozen)`} />
              <Row label="Ask as signed" value={frozenAsk ?? `${data.ask} (live — not frozen)`} />
              <Row label="Their note" value={data.client_note} />
              <Row label="IP" value={data.decided_ip} />
              <Row label="Browser" value={data.decided_user_agent} />
            </dl>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
