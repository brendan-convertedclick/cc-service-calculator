import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Trash2 } from "lucide-react";
import {
  useClientLists,
  useSyncClientStructure,
  useUpdateClientList,
  useArchiveClientList,
} from "@/hooks/useClientLists";
import { useTaskGroups } from "@/hooks/useOngoingTasks";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  const [busyId, setBusyId] = useState<string | null>(null);

  const handleSync = () => {
    sync.mutate(clientId, {
      onSuccess: (r) => {
        toast.success(
          `Sync complete: ${r.discovered} discovered, ${r.refreshed} refreshed`,
        );
      },
      onError: (e) =>
        toast.error(e instanceof Error ? e.message : "Sync failed"),
    });
  };

  if (!clickupFolderId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>ClickUp lists</CardTitle>
          <CardDescription>
            This client has no <code>clickup_folder_id</code>. Set one in the
            ClickUp folder picker before mapping lists.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div className="space-y-1">
          <CardTitle>ClickUp lists</CardTitle>
          <CardDescription>
            Map each ClickUp list inside this client's folder to a task group.
            Ongoing tasks are provisioned into the mapped list.
          </CardDescription>
        </div>
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
      </CardHeader>
      <CardContent className="space-y-2">
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
                        e instanceof Error ? e.message : "Update failed",
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
      </CardContent>
    </Card>
  );
}
