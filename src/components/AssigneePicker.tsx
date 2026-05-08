import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useTeam } from "@/hooks/useTeam";
import { useUpdateBriefAssignee } from "@/hooks/useBriefActions";
import { toast } from "sonner";
import type { Database } from "@/types/db";

type TeamMember = Database["public"]["Tables"]["team_members"]["Row"];

interface AssigneePickerProps {
  briefId: string;
  assigneeId: string | null;
}

export function AssigneePicker({ briefId, assigneeId }: AssigneePickerProps) {
  const [open, setOpen] = useState(false);
  const { data: team = [] } = useTeam();
  const update = useUpdateBriefAssignee();

  const activeMembers = (team as TeamMember[]).filter((m) => !m.archived_at);
  const current = activeMembers.find((m) => m.id === assigneeId);
  const label = current ? current.full_name : "Unassigned";

  const assign = async (id: string | null) => {
    try {
      await update.mutateAsync({ briefId, assigneeId: id });
      setOpen(false);
    } catch {
      toast.error("Failed to update assignee");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-label-small">
          {label}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1">
        <button
          onClick={() => assign(null)}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-body-medium hover:bg-m-surface-container"
        >
          {!assigneeId && <Check className="h-4 w-4" />}
          {assigneeId && <span className="h-4 w-4" />}
          Unassigned
        </button>
        {activeMembers.map((m) => (
          <button
            key={m.id}
            onClick={() => assign(m.id)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-body-medium hover:bg-m-surface-container"
          >
            {assigneeId === m.id ? <Check className="h-4 w-4" /> : <span className="h-4 w-4" />}
            {m.full_name}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
