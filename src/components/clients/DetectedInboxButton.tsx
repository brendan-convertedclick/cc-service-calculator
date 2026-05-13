import { useState } from "react";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePendingInbox } from "@/hooks/usePendingInbox";
import { DetectedInboxDialog } from "./DetectedInboxDialog";

export function DetectedInboxButton() {
  const { total } = usePendingInbox();
  const [open, setOpen] = useState(false);

  if (total === 0) return null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        title="Detected new clients & senders"
      >
        <Inbox className="h-4 w-4" />
        Inbox
        <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
          {total}
        </span>
      </Button>
      <DetectedInboxDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
