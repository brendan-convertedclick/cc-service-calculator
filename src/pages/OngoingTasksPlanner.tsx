import { useState, useMemo } from "react";
import { toast } from "sonner";
import { useClients } from "@/hooks/useClients";
import { useTeam } from "@/hooks/useTeam";
import {
  useTaskGroups,
  useTimeCategories,
  useProvisionMatrix,
  type MatrixResult,
} from "@/hooks/useOngoingTasks";
import { useClientLists } from "@/hooks/useClientLists";
import { supabase } from "@/lib/supabase";
import { useQuery } from "@tanstack/react-query";
import type { ClientList } from "@/types/ongoing";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Loads every active client_lists row across the selected clients, so the
// planner can show mapping-readiness inline (red banner if a client has no
// list mapped for the chosen group).
function useClientListsForClients(clientIds: string[]) {
  return useQuery<ClientList[]>({
    queryKey: ["client-lists-bulk", clientIds.sort().join(",")],
    enabled: clientIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_lists")
        .select("*")
        .in("client_id", clientIds)
        .is("archived_at", null);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function OngoingTasksPlanner() {
  const { data: clients = [] } = useClients();
  const { data: team = [] } = useTeam();
  const { data: groups = [] } = useTaskGroups();
  const { data: templates = [] } = useTimeCategories();
  const provision = useProvisionMatrix();

  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [selectedTemplates, setSelectedTemplates] = useState<Set<string>>(new Set());
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<MatrixResult | null>(null);

  const activeClients = useMemo(
    () => clients.filter((c) => !c.archived_at),
    [clients],
  );

  // Restrict template picker to the chosen group's templates, hiding custom
  // templates not scoped to one of the currently-selected clients.
  const visibleTemplates = useMemo(() => {
    if (!selectedGroupId) return [];
    return templates.filter((t) => {
      if (t.group_id !== selectedGroupId) return false;
      if (t.is_custom) {
        return t.client_id ? selectedClients.has(t.client_id) : false;
      }
      return true;
    });
  }, [templates, selectedGroupId, selectedClients]);

  const clientIdsList = Array.from(selectedClients);
  const { data: clientLists = [] } = useClientListsForClients(clientIdsList);
  const mappingReady = useMemo(() => {
    if (!selectedGroupId || clientIdsList.length === 0) return new Map<string, boolean>();
    const m = new Map<string, boolean>();
    for (const cid of clientIdsList) {
      m.set(
        cid,
        clientLists.some(
          (r) =>
            r.client_id === cid &&
            r.group_id === selectedGroupId &&
            !r.custom_label,
        ),
      );
    }
    return m;
  }, [selectedGroupId, clientIdsList, clientLists]);

  const unmappedClients = clientIdsList.filter((cid) => !mappingReady.get(cid));

  const cellCount =
    selectedClients.size * selectedTemplates.size * selectedMembers.size;
  const readyClients = clientIdsList.length - unmappedClients.length;
  const readyCellCount =
    readyClients * selectedTemplates.size * selectedMembers.size;

  const handleCreate = () => {
    if (selectedMembers.size === 0) {
      toast.error("Pick at least one member");
      return;
    }
    if (selectedTemplates.size === 0) {
      toast.error("Pick at least one task");
      return;
    }
    if (selectedClients.size === 0) {
      toast.error("Pick at least one client (or use Team page for overhead)");
      return;
    }
    if (unmappedClients.length > 0) {
      toast.error(
        `${unmappedClients.length} client(s) need a ClickUp list mapped for this list. Visit the client page to map.`,
      );
      return;
    }

    provision.mutate(
      {
        member_ids: Array.from(selectedMembers),
        client_ids: Array.from(selectedClients),
        task_template_ids: Array.from(selectedTemplates),
        group_id: selectedGroupId,
      },
      {
        onSuccess: (r) => {
          setResult(r);
          toast.success(
            `Provisioned ${r.provisioned}, skipped ${r.skipped}, failed ${r.failed.length}`,
          );
        },
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Provision failed"),
      },
    );
  };

  return (
    <div className="container mx-auto max-w-7xl p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Live tasks</h1>
        <p className="text-body-medium text-m-on-surface-variant">
          Bulk-provision perpetual ClickUp tasks across the matrix of clients,
          lists, tasks, and team members.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-title-small">
              Clients ({selectedClients.size})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-96 overflow-y-auto">
            {activeClients.map((c) => (
              <label key={c.id} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={selectedClients.has(c.id)}
                  onCheckedChange={(v) => {
                    const next = new Set(selectedClients);
                    if (v) next.add(c.id);
                    else next.delete(c.id);
                    setSelectedClients(next);
                  }}
                />
                <span className="flex-1 truncate text-body-small">
                  {c.short_name ?? c.name}
                </span>
                {selectedGroupId && selectedClients.has(c.id) &&
                  mappingReady.get(c.id) === false && (
                    <span
                      className="text-body-small text-destructive"
                      title="No ClickUp list mapped for this list"
                    >
                      ⚠
                    </span>
                  )}
              </label>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-title-small">List</CardTitle>
            <CardDescription>One list per planning run.</CardDescription>
          </CardHeader>
          <CardContent>
            <Select
              value={selectedGroupId}
              onValueChange={(v) => {
                setSelectedGroupId(v);
                setSelectedTemplates(new Set());
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pick a list" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-title-small">
              Tasks ({selectedTemplates.size})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-96 overflow-y-auto">
            {!selectedGroupId && (
              <div className="text-body-small text-m-on-surface-variant">
                Pick a list first.
              </div>
            )}
            {selectedGroupId && visibleTemplates.length === 0 && (
              <div className="text-body-small text-m-on-surface-variant">
                No tasks in this list. Add some in Settings → Task catalog.
              </div>
            )}
            {visibleTemplates.map((t) => (
              <label key={t.id} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={selectedTemplates.has(t.id)}
                  onCheckedChange={(v) => {
                    const next = new Set(selectedTemplates);
                    if (v) next.add(t.id);
                    else next.delete(t.id);
                    setSelectedTemplates(next);
                  }}
                />
                <span className="flex-1 truncate text-body-small">
                  {t.label}
                  {t.is_custom && (
                    <span className="ml-1 text-m-on-surface-variant">(custom)</span>
                  )}
                </span>
              </label>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-title-small">
              Team ({selectedMembers.size})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-96 overflow-y-auto">
            {team.map((m) => (
              <label key={m.id} className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={selectedMembers.has(m.id)}
                  onCheckedChange={(v) => {
                    const next = new Set(selectedMembers);
                    if (v) next.add(m.id);
                    else next.delete(m.id);
                    setSelectedMembers(next);
                  }}
                />
                <span className="flex-1 truncate text-body-small">
                  {m.full_name}
                </span>
              </label>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-title-medium">Preview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-body-medium">
            <span className="font-semibold">{cellCount}</span> cell(s) selected
            {unmappedClients.length > 0 && (
              <>
                {" — "}
                <span className="text-destructive">
                  {unmappedClients.length} client(s) without a list mapped
                </span>
                {", "}
                <span>only {readyCellCount} will provision</span>
              </>
            )}
          </div>
          {unmappedClients.length > 0 && (
            <div className="text-body-small text-m-on-surface-variant">
              Missing mappings:{" "}
              {unmappedClients
                .map(
                  (cid) =>
                    activeClients.find((c) => c.id === cid)?.short_name ?? cid,
                )
                .join(", ")}
              . Map each via Clients → [client] → ClickUp lists.
            </div>
          )}
          <Button
            onClick={handleCreate}
            disabled={provision.isPending || cellCount === 0}
          >
            {provision.isPending ? "Provisioning…" : "Create"}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-title-medium">Last run</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-body-small">
            <div>
              Provisioned: <strong>{result.provisioned}</strong> · Skipped:{" "}
              <strong>{result.skipped}</strong> · Failed:{" "}
              <strong>{result.failed.length}</strong>
            </div>
            {result.failed.length > 0 && (
              <div className="space-y-1">
                <div className="font-semibold">Failures:</div>
                {result.failed.slice(0, 20).map((f, i) => {
                  const member = team.find((m) => m.id === f.member_id);
                  const client = activeClients.find((c) => c.id === f.client_id);
                  const tmpl = templates.find((t) => t.id === f.task_template_id);
                  return (
                    <div key={i} className="text-m-on-surface-variant">
                      <span className="text-foreground">
                        {member?.full_name ?? f.member_id} ·{" "}
                        {client?.short_name ?? "Overhead"} · {tmpl?.label ?? f.task_template_id}
                      </span>
                      {" — "}
                      {f.reason}
                    </div>
                  );
                })}
                {result.failed.length > 20 && (
                  <div className="text-m-on-surface-variant">
                    + {result.failed.length - 20} more
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
