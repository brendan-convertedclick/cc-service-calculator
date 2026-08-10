import { useState } from "react";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  usePendingInbox,
  useApprovePendingClient,
  useDismissPendingClient,
  useDismissPendingSender,
  type PendingClient,
} from "@/hooks/usePendingInbox";
import { useResolvePendingSender } from "@/hooks/useSenderRules";

export function DetectedInboxDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { pendingClients, pendingSenders, isLoading } = usePendingInbox();
  const approve = useApprovePendingClient();
  const dismissClient = useDismissPendingClient();
  const dismissSender = useDismissPendingSender();
  const resolveSender = useResolvePendingSender();

  const [openApproveId, setOpenApproveId] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Detected new clients & senders</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-6">
            <section>
              <h3 className="mb-2 text-sm font-semibold">New client domains</h3>
              {pendingClients.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No new domains. Inbound email from unrecognised domains will appear here.
                </p>
              ) : (
                <ul className="divide-y border rounded-lg">
                  {pendingClients.map((p) => (
                    <li key={p.id} className="p-3">
                      <PendingClientRow
                        pending={p}
                        expanded={openApproveId === p.id}
                        onExpand={() => setOpenApproveId(openApproveId === p.id ? null : p.id)}
                        onApprove={(name, folderId) =>
                          approve.mutate(
                            {
                              pending: p,
                              name,
                              primary_domain: p.domain,
                              clickup_folder_id: folderId,
                            },
                            {
                              onSuccess: () => {
                                toast.success(`Created ${name}`);
                                setOpenApproveId(null);
                              },
                              onError: (e) => toast.error(e.message),
                            },
                          )
                        }
                        onDismiss={() =>
                          dismissClient.mutate(p.id, {
                            onSuccess: () => toast.success(`Dismissed ${p.domain}`),
                          })
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold">Senders on existing clients</h3>
              {pendingSenders.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No pending senders. Senders on a known client domain without an allow/block rule appear here.
                </p>
              ) : (
                <ul className="divide-y border rounded-lg">
                  {pendingSenders.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 p-3 text-sm">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{s.email}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {s.client_name} · {s.sample_subject ?? "—"} · {s.seen_count}×
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          resolveSender.mutate(
                            {
                              pending: {
                                id: s.id,
                                client_id: s.client_id,
                                email: s.email,
                                sample_subject: s.sample_subject,
                                sample_brief_id: null,
                                last_seen_at: s.last_seen_at,
                                seen_count: s.seen_count,
                              },
                              action: "allow",
                            },
                            { onSuccess: () => toast.success(`Allowed ${s.email}`) },
                          )
                        }
                      >
                        <Check className="h-4 w-4" />
                        Allow
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          resolveSender.mutate(
                            {
                              pending: {
                                id: s.id,
                                client_id: s.client_id,
                                email: s.email,
                                sample_subject: s.sample_subject,
                                sample_brief_id: null,
                                last_seen_at: s.last_seen_at,
                                seen_count: s.seen_count,
                              },
                              action: "block",
                            },
                            { onSuccess: () => toast.success(`Blocked ${s.email}`) },
                          )
                        }
                      >
                        <X className="h-4 w-4" />
                        Block
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          dismissSender.mutate(s.id, {
                            onSuccess: () => toast.success(`Dismissed ${s.email}`),
                          })
                        }
                      >
                        Dismiss
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PendingClientRow({
  pending,
  expanded,
  onExpand,
  onApprove,
  onDismiss,
}: {
  pending: PendingClient;
  expanded: boolean;
  onExpand: () => void;
  onApprove: (name: string, folderId: string | null) => void;
  onDismiss: () => void;
}) {
  const defaultName = pending.domain
    .split(".")[0]
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
  const [name, setName] = useState(defaultName);

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{pending.domain}</div>
          <div className="text-xs text-muted-foreground truncate">
            {pending.sample_sender ?? "—"} · {pending.sample_subject ?? "—"} · {pending.seen_count}×
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={onExpand}>
          {expanded ? "Cancel" : "Approve as client"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      {expanded && (
        <div className="flex items-end gap-2 rounded-lg border bg-muted/30 p-2">
          <div className="flex-1">
            <Label className="text-xs">Client name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button size="sm" onClick={() => onApprove(name, null)} disabled={!name.trim()}>
            Create client
          </Button>
        </div>
      )}
    </div>
  );
}
