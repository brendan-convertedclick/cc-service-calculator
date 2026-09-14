import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Trash2, Plus } from "lucide-react";
import {
  useClientLists,
  useSyncClientStructure,
  useUpdateClientList,
  useArchiveClientList,
  useCreateClientList,
} from "@/hooks/useClientLists";
import { useTaskGroups } from "@/hooks/useOngoingTasks";
import { errorMessage } from "@/lib/utils";
import { PanelSection } from "@/components/clients/PanelSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const UNMAPPED = "__unmapped__";

export function ClickUpListsPanel({
  clientId,
  clickupFolderId,
}: {
  clientId: string;
  clickupFolderId: string | null;
}) {
  const { data: lists = [], isLoading } = useClientLists(clientId);
  const { data: groups = [] } = useTaskGroups();
  const sync = useSyncClientStructure();
  const update = useUpdateClientList();
  const archive = useArchiveClientList();
  const create = useCreateClientList();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newGroupId, setNewGroupId] = useState<string>("__custom__");

  const handleSync = () => {
    sync.mutate(clientId, {
      onSuccess: (r) => {
        toast.success(
          `Sync complete: ${r.discovered} discovered, ${r.refreshed} refreshed, ${r.archived} archived`,
        );
      },
      onError: (e) =>
        toast.error(`Sync failed: ${errorMessage(e)}`),
    });
  };

  if (!clickupFolderId) {
    return (
      <PanelSection title="Lists" description="No folder linked yet. Pick one above, then sync.">
        {null}
      </PanelSection>
    );
  }

  return (
    <PanelSection
      title="Lists"
      description="Map each ClickUp list inside this client's folder to a task group. Ongoing tasks are provisioned into the mapped list."
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={sync.isPending}
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${sync.isPending ? "animate-spin" : ""}`}
          />
          {sync.isPending ? "Syncing…" : "Sync from ClickUp"}
        </Button>
      }
    >
      <div className="space-y-2">
        {isLoading && (
          <div className="text-body-small text-m-on-surface-variant">
            Loading…
          </div>
        )}
        {!isLoading && lists.length === 0 && (
          <div className="text-body-small text-m-on-surface-variant">
            No lists synced yet. Click "Sync from ClickUp" to discover this
            client's lists.
          </div>
        )}
        {lists.map((row) => (
          <div key={row.id} className="flex items-center gap-2">
            <div className="flex-1 truncate" title={row.clickup_list_name}>
              {row.clickup_list_name}
              {row.custom_label && (
                <span className="ml-2 text-body-small text-m-on-surface-variant">
                  (custom: {row.custom_label})
                </span>
              )}
            </div>
            <Select
              value={row.group_id ?? UNMAPPED}
              onValueChange={(v) => {
                setBusyId(row.id);
                update.mutate(
                  {
                    id: row.id,
                    group_id: v === UNMAPPED ? null : v,
                    client_id: clientId,
                  },
                  {
                    onSettled: () => setBusyId(null),
                    onError: (e) =>
                      toast.error(
                        `Update failed: ${errorMessage(e)}`,
                      ),
                  },
                );
              }}
              disabled={busyId === row.id || !!row.custom_label}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Unmapped" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNMAPPED}>Unmapped</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (
                  confirm(
                    `Archive "${row.clickup_list_name}"? Re-syncing will re-discover it.`,
                  )
                ) {
                  archive.mutate({ id: row.id, client_id: clientId });
                }
              }}
              aria-label={`Archive ${row.clickup_list_name}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}

        <div className="flex items-center gap-2 pt-3 border-t">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="New list name (creates in ClickUp)"
            className="flex-1"
          />
          <Select value={newGroupId} onValueChange={setNewGroupId}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__custom__">Custom (no group)</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={create.isPending || (!newLabel.trim() && newGroupId === "__custom__")}
            onClick={() => {
              const isCustom = newGroupId === "__custom__";
              const label = newLabel.trim();
              if (isCustom && !label) {
                toast.error("Custom list needs a name");
                return;
              }
              create.mutate(
                {
                  client_id: clientId,
                  group_id: isCustom ? null : newGroupId,
                  custom_label: isCustom ? label : null,
                },
                {
                  onSuccess: (r) => {
                    toast.success(`Created "${r.clickup_list_name}" in ClickUp`);
                    setNewLabel("");
                    setNewGroupId("__custom__");
                  },
                  onError: (e) =>
                    toast.error(`Create failed: ${errorMessage(e)}`),
                },
              );
            }}
          >
            <Plus className="h-4 w-4 mr-1" /> New list
          </Button>
        </div>
      </div>
    </PanelSection>
  );
}
