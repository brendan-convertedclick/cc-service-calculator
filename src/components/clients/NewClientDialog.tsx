import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useCreateClient } from "@/hooks/useClients";
import { useApplyFoundations } from "@/hooks/useFoundations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";

export const UNLINKED = "__unlinked__";

export function NewClientDialog({
  folderOptions,
  disabled,
  triggerLabel = "New client",
  variant = "default",
}: {
  folderOptions: Array<{ value: string; label: string }>;
  disabled: boolean;
  triggerLabel?: string;
  variant?: "default" | "outline" | "ghost";
}) {
  const create = useCreateClient();
  const applyFoundations = useApplyFoundations();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [folderId, setFolderId] = useState<string>(UNLINKED);
  const [xeroContactId, setXeroContactId] = useState("");
  const [marginTarget, setMarginTarget] = useState("40");
  const [applyFoundationsOnCreate, setApplyFoundationsOnCreate] = useState(true);
  const [includeSeedTasks, setIncludeSeedTasks] = useState(true);
  const folderSelected = folderId !== UNLINKED;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size="sm" data-testid="open-new-client-dialog">
          <Plus className="h-4 w-4" /> {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New client</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label>Primary domain (optional)</Label>
            <Input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="example.co.za"
            />
          </div>
          {!disabled && (
            <div className="space-y-2">
              <Label>ClickUp folder (optional)</Label>
              <Combobox
                options={folderOptions}
                value={folderId}
                onChange={setFolderId}
                placeholder="Pick a folder..."
              />
            </div>
          )}
          <div className="space-y-2">
            <Label>Margin target (%)</Label>
            <Input
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={marginTarget}
              onChange={(e) => setMarginTarget(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Xero Contact ID (optional)</Label>
            <Input
              value={xeroContactId}
              onChange={(e) => setXeroContactId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            />
          </div>
          <div className="space-y-2 pt-2 border-t">
            <label className="flex items-center gap-2 text-sm" data-testid="apply-foundations-toggle">
              <Checkbox
                checked={applyFoundationsOnCreate && folderSelected}
                disabled={!folderSelected}
                onCheckedChange={(v) => setApplyFoundationsOnCreate(v === true)}
              />
              Apply Foundations baseline on create
              {!folderSelected ? (
                <span className="text-muted-foreground">(needs ClickUp folder)</span>
              ) : null}
            </label>
            {applyFoundationsOnCreate && folderSelected ? (
              <label className="flex items-center gap-2 text-sm pl-6">
                <Checkbox
                  checked={includeSeedTasks}
                  onCheckedChange={(v) => setIncludeSeedTasks(v === true)}
                />
                Include seed tasks
              </label>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            onClick={() => {
              const trimmed = name.trim();
              if (!trimmed) return toast.error("Name required");
              const marginNum = parseFloat(marginTarget);
              create.mutate(
                {
                  name: trimmed,
                  primary_domain: domain.trim() || null,
                  clickup_folder_id: folderId === UNLINKED ? null : folderId,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  margin_target_pct: (!isNaN(marginNum) ? marginNum : 40) as any,
                  xero_contact_id: xeroContactId.trim() || null,
                },
                {
                  onSuccess: (created) => {
                    setName("");
                    setDomain("");
                    setFolderId(UNLINKED);
                    setXeroContactId("");
                    setMarginTarget("40");
                    setOpen(false);
                    toast.success(`Created ${trimmed}`);
                    if (applyFoundationsOnCreate && folderSelected && created?.id) {
                      applyFoundations
                        .mutateAsync({
                          client_ids: [created.id],
                          include_tasks: includeSeedTasks,
                        })
                        .then((res) => {
                          const lists = res.applied.reduce((n, a) => n + a.lists_created, 0);
                          const tasks = res.applied.reduce((n, a) => n + a.tasks_created, 0);
                          toast.success(
                            `Foundations: ${lists} list${lists === 1 ? "" : "s"}, ${tasks} task${tasks === 1 ? "" : "s"} created`,
                          );
                        })
                        .catch((e) =>
                          toast.warning(
                            `Foundations apply failed: ${e instanceof Error ? e.message : String(e)}`,
                          ),
                        );
                    }
                  },
                  onError: (e) => toast.error(e.message),
                },
              );
            }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
