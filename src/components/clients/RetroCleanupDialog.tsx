import { toast } from "sonner";
import {
  useBriefsMatchingSender,
  useApplyRetroAction,
} from "@/hooks/useSenderRules";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function RetroCleanupDialog({
  clientId,
  pattern,
  open,
  onClose,
}: {
  clientId: string;
  pattern: string;
  open: boolean;
  onClose: () => void;
}) {
  const { data: matches = [], isLoading } = useBriefsMatchingSender(
    clientId,
    pattern,
    open,
  );
  const apply = useApplyRetroAction();

  const run = (action: "archive" | "delete") => {
    if (!matches.length) {
      onClose();
      return;
    }
    apply.mutate(
      { brief_ids: matches.map((m) => m.id), action },
      {
        onSuccess: (n) => {
          toast.success(
            `${action === "archive" ? "Archived" : "Deleted"} ${n} brief${
              n === 1 ? "" : "s"
            }`,
          );
          onClose();
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Clean up matching briefs?</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Searching…</p>
        ) : matches.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No existing briefs match <code>{pattern}</code>. Nothing to clean up.
          </p>
        ) : (
          <>
            <p className="text-sm">
              {matches.length} brief{matches.length === 1 ? "" : "s"} from{" "}
              <code>{pattern}</code> exist in the system.
            </p>
            <ul className="max-h-60 overflow-auto rounded border text-xs">
              {matches.map((b) => (
                <li
                  key={b.id}
                  className="border-b px-3 py-2 last:border-0"
                >
                  <div className="font-medium">
                    {b.raw_subject ?? "(no subject)"}
                  </div>
                  <div className="text-muted-foreground">
                    {b.sender_email} ·{" "}
                    {new Date(b.received_at).toLocaleDateString()}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>
            Leave
          </Button>
          <Button
            variant="secondary"
            disabled={!matches.length || apply.isPending}
            onClick={() => run("archive")}
          >
            Archive all
          </Button>
          <Button
            variant="destructive"
            disabled={!matches.length || apply.isPending}
            onClick={() => {
              if (
                confirm(
                  `Permanently delete ${matches.length} brief(s)? Cascades to messages and scopes.`,
                )
              )
                run("delete");
            }}
          >
            Delete all
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
