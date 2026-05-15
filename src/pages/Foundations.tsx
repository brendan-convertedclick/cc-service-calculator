import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { useClients, useClickUpFolders } from "@/hooks/useClients";
import { useSettings } from "@/hooks/useSettings";
import { useTaskGroups } from "@/hooks/useOngoingTasks";
import {
  useBaselineLists,
  useBaselineTasks,
  useCreateBaselineList,
  useArchiveBaselineList,
  useCreateBaselineTask,
  useUpdateBaselineTask,
  useArchiveBaselineTask,
  useApplyFoundations,
} from "@/hooks/useFoundations";
import { NewClientDialog, UNLINKED } from "@/components/clients/NewClientDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function Foundations() {
  const { data: clients = [] } = useClients();
  const { data: groups = [] } = useTaskGroups();
  const { data: settings } = useSettings();
  const { data: folders } = useClickUpFolders();
  const { data: baselines = [] } = useBaselineLists();
  const apply = useApplyFoundations();

  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
  const [selectedBaselines, setSelectedBaselines] = useState<Set<string>>(new Set());
  const [includeTasks, setIncludeTasks] = useState(true);
  const [catalogOpen, setCatalogOpen] = useState(false);

  const folderOptions = [
    { value: UNLINKED, label: "— Unlinked —" },
    ...(folders ?? []).map((f) => ({ value: f.id, label: f.name })),
  ];

  const activeClients = useMemo(
    () => clients.filter((c) => !c.archived_at),
    [clients],
  );

  // Seed tasks across all selected baselines.
  const { data: seedTasksByList = new Map<string, Array<{ id: string; name: string }>>() } =
    useSeedTasksForBaselines(Array.from(selectedBaselines));

  const totalSeedTaskCount = useMemo(() => {
    let n = 0;
    for (const id of selectedBaselines) {
      n += (seedTasksByList.get(id) ?? []).length;
    }
    return n;
  }, [seedTasksByList, selectedBaselines]);

  const clientsWithoutFolder = useMemo(
    () =>
      Array.from(selectedClients).filter((id) => {
        const c = activeClients.find((x) => x.id === id);
        return c && !c.clickup_folder_id;
      }),
    [selectedClients, activeClients],
  );

  const toggle = (set: Set<string>, id: string): Set<string> => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };

  const handleApply = async () => {
    if (selectedClients.size === 0) return toast.error("Pick at least one client");
    if (selectedBaselines.size === 0) return toast.error("Pick at least one baseline");
    if (clientsWithoutFolder.length > 0) {
      toast.error(
        `${clientsWithoutFolder.length} selected client(s) have no ClickUp folder. Set one before applying.`,
      );
      return;
    }
    try {
      const res = await apply.mutateAsync({
        client_ids: Array.from(selectedClients),
        baseline_list_ids: Array.from(selectedBaselines),
        include_tasks: includeTasks,
      });
      const lists = res.applied.reduce((n, a) => n + a.lists_created, 0);
      const tasks = res.applied.reduce((n, a) => n + a.tasks_created, 0);
      const errs = res.errors.length;
      const skipped = res.skipped.length;
      let msg = `${lists} list${lists === 1 ? "" : "s"} created, ${tasks} task${tasks === 1 ? "" : "s"} seeded`;
      if (skipped > 0) msg += ` · ${skipped} skipped`;
      if (errs > 0) msg += ` · ${errs} error${errs === 1 ? "" : "s"}`;
      if (errs > 0) toast.warning(msg);
      else toast.success(msg);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Apply failed");
    }
  };

  return (
    <div className="container mx-auto max-w-7xl p-6 space-y-6" data-testid="foundations-page">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Foundations</h1>
        <p className="text-body-medium text-m-on-surface-variant">
          Scaffold the baseline ClickUp Lists (and optional seed tasks) into one or more clients.
          Pick clients on the left, baselines in the middle, review the seed tasks, then apply.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Clients pane */}
        <Card data-testid="pane-clients">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-title-small">
              Clients ({selectedClients.size})
            </CardTitle>
            <NewClientDialog
              folderOptions={folderOptions}
              disabled={!settings?.clickup_clients_space_id}
              triggerLabel="New"
              variant="outline"
            />
          </CardHeader>
          <CardContent className="space-y-1 max-h-96 overflow-y-auto">
            <div className="flex items-center gap-2 pb-1 mb-1 border-b text-body-small">
              <Checkbox
                checked={
                  activeClients.length > 0 &&
                  selectedClients.size === activeClients.length
                }
                onCheckedChange={(v) => {
                  if (v) setSelectedClients(new Set(activeClients.map((c) => c.id)));
                  else setSelectedClients(new Set());
                }}
              />
              <span className="text-m-on-surface-variant">Select all</span>
            </div>
            {activeClients.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-2 cursor-pointer hover:bg-m-surface-container/40 px-1 py-0.5 rounded"
                data-testid={`client-row-${c.id}`}
              >
                <Checkbox
                  checked={selectedClients.has(c.id)}
                  onCheckedChange={() => setSelectedClients((s) => toggle(s, c.id))}
                />
                <span className="flex-1 truncate text-body-small">
                  {c.short_name ?? c.name}
                </span>
                {!c.clickup_folder_id ? (
                  <AlertTriangle
                    className="h-3.5 w-3.5 text-m-error"
                    aria-label="No ClickUp folder"
                  />
                ) : null}
              </label>
            ))}
          </CardContent>
        </Card>

        {/* Baselines pane */}
        <Card data-testid="pane-baselines">
          <CardHeader>
            <CardTitle className="text-title-small">
              Baselines ({selectedBaselines.size})
            </CardTitle>
            <CardDescription>The Lists every client folder needs.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 max-h-96 overflow-y-auto">
            <div className="flex items-center gap-2 pb-1 mb-1 border-b text-body-small">
              <Checkbox
                checked={
                  baselines.length > 0 &&
                  selectedBaselines.size === baselines.length
                }
                onCheckedChange={(v) => {
                  if (v) setSelectedBaselines(new Set(baselines.map((b) => b.id)));
                  else setSelectedBaselines(new Set());
                }}
              />
              <span className="text-m-on-surface-variant">Select all</span>
            </div>
            {baselines.map((bl) => (
              <label
                key={bl.id}
                className="flex items-center gap-2 cursor-pointer hover:bg-m-surface-container/40 px-1 py-0.5 rounded"
                data-testid={`baseline-row-${bl.id}`}
              >
                <Checkbox
                  checked={selectedBaselines.has(bl.id)}
                  onCheckedChange={() => setSelectedBaselines((s) => toggle(s, bl.id))}
                />
                <span className="flex-1 truncate text-body-small">{bl.label}</span>
              </label>
            ))}
            {baselines.length === 0 ? (
              <div className="text-body-small text-m-on-surface-variant pt-2">
                No baselines yet. Add some below in the catalog.
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Seed tasks pane */}
        <Card data-testid="pane-tasks">
          <CardHeader>
            <CardTitle className="text-title-small">
              Seed tasks ({includeTasks ? totalSeedTaskCount : 0})
            </CardTitle>
            <CardDescription>
              <label className="flex items-center gap-2 cursor-pointer mt-1">
                <Checkbox
                  checked={includeTasks}
                  onCheckedChange={(v) => setIncludeTasks(v === true)}
                />
                Include seed tasks
              </label>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 max-h-96 overflow-y-auto">
            {!includeTasks ? (
              <div className="text-body-small text-m-on-surface-variant">
                Lists-only mode. Toggle on above to also create seed tasks.
              </div>
            ) : selectedBaselines.size === 0 ? (
              <div className="text-body-small text-m-on-surface-variant">
                Pick a baseline first.
              </div>
            ) : (
              Array.from(selectedBaselines).map((blId) => {
                const baseline = baselines.find((b) => b.id === blId);
                const tasks = seedTasksByList.get(blId) ?? [];
                return (
                  <div key={blId} className="space-y-1">
                    <div className="text-label-small text-m-on-surface-variant uppercase tracking-wide">
                      {baseline?.label ?? "—"}
                    </div>
                    {tasks.length === 0 ? (
                      <div className="text-body-small text-m-on-surface-variant pl-1">
                        (no seed tasks)
                      </div>
                    ) : (
                      tasks.map((t) => (
                        <div
                          key={t.id}
                          className="text-body-small pl-1 truncate"
                        >
                          • {t.name}
                        </div>
                      ))
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Apply pane */}
        <Card data-testid="pane-apply">
          <CardHeader>
            <CardTitle className="text-title-small">Apply</CardTitle>
            <CardDescription>Review and run.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-body-small space-y-1">
              <div>
                <span className="font-semibold">{selectedClients.size}</span> client
                {selectedClients.size === 1 ? "" : "s"}
              </div>
              <div>
                <span className="font-semibold">{selectedBaselines.size}</span> baseline
                {selectedBaselines.size === 1 ? "" : "s"}
              </div>
              <div>
                <span className="font-semibold">
                  {includeTasks ? totalSeedTaskCount : 0}
                </span>{" "}
                seed task{includeTasks && totalSeedTaskCount === 1 ? "" : "s"}
              </div>
              {clientsWithoutFolder.length > 0 ? (
                <div className="pt-2 text-m-error text-body-small">
                  {clientsWithoutFolder.length} selected client
                  {clientsWithoutFolder.length === 1 ? "" : "s"} ha
                  {clientsWithoutFolder.length === 1 ? "s" : "ve"} no ClickUp folder.
                </div>
              ) : null}
            </div>
            <Button
              onClick={handleApply}
              disabled={
                apply.isPending ||
                selectedClients.size === 0 ||
                selectedBaselines.size === 0 ||
                clientsWithoutFolder.length > 0
              }
              className="w-full"
              data-testid="apply-foundations"
            >
              {apply.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              Apply foundations
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Catalog editor (collapsible secondary) */}
      <Card data-testid="foundations-catalog">
        <CardHeader
          className="cursor-pointer"
          onClick={() => setCatalogOpen((o) => !o)}
        >
          <CardTitle className="text-title-medium flex items-center gap-2">
            {catalogOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            Baseline catalog
          </CardTitle>
          <CardDescription>
            Manage the baselines and their seed tasks. Changes affect future Apply runs.
          </CardDescription>
        </CardHeader>
        {catalogOpen ? (
          <CardContent>
            <CatalogEditor
              groups={groups}
              baselines={baselines}
            />
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}

function CatalogEditor({
  groups,
  baselines,
}: {
  groups: Array<{ id: string; label: string }>;
  baselines: Array<{ id: string; label: string; group_id: string; description: string | null }>;
}) {
  const createBL = useCreateBaselineList();
  const archiveBL = useArchiveBaselineList();
  const [newGroupId, setNewGroupId] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [expandedListId, setExpandedListId] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!newGroupId || !newLabel.trim()) {
      toast.error("Pick a group and enter a label");
      return;
    }
    try {
      await createBL.mutateAsync({
        group_id: newGroupId,
        label: newLabel.trim(),
        display_order: baselines.length * 10 + 10,
      });
      toast.success(`Baseline "${newLabel.trim()}" added`);
      setNewLabel("");
      setNewGroupId("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add baseline");
    }
  };

  const handleArchive = async (id: string, label: string) => {
    if (!confirm(`Archive "${label}"? This won't remove anything from ClickUp.`)) return;
    try {
      await archiveBL.mutateAsync(id);
      toast.success("Baseline archived");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to archive");
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {baselines.map((bl) => (
          <div key={bl.id} className="rounded-md border p-2">
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  setExpandedListId(expandedListId === bl.id ? null : bl.id)
                }
                className="p-1 hover:bg-m-surface-container rounded"
                aria-label="Expand"
              >
                {expandedListId === bl.id ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
              <span className="flex-1 font-medium">{bl.label}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleArchive(bl.id, bl.label)}
                title="Archive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {expandedListId === bl.id ? (
              <div className="pl-7 pt-2">
                <SeedTasksEditor baselineListId={bl.id} />
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 pt-2 border-t">
        <Select value={newGroupId} onValueChange={setNewGroupId}>
          <SelectTrigger className="w-[200px]" data-testid="new-baseline-group">
            <SelectValue placeholder="Task group" />
          </SelectTrigger>
          <SelectContent>
            {groups
              .filter((g) => !baselines.some((b) => b.group_id === g.id))
              .map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Baseline label (e.g. Strategic)"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          className="max-w-sm"
          data-testid="new-baseline-label"
        />
        <Button
          onClick={handleAdd}
          disabled={createBL.isPending}
          data-testid="add-baseline"
        >
          <Plus className="h-4 w-4 mr-1" /> Add baseline
        </Button>
      </div>
    </div>
  );
}

function SeedTasksEditor({ baselineListId }: { baselineListId: string }) {
  const { data: tasks = [] } = useBaselineTasks(baselineListId);
  const create = useCreateBaselineTask();
  const update = useUpdateBaselineTask();
  const archive = useArchiveBaselineTask();
  const [newName, setNewName] = useState("");

  const onAdd = async () => {
    if (!newName.trim()) return;
    try {
      await create.mutateAsync({
        baseline_list_id: baselineListId,
        name: newName.trim(),
        display_order: tasks.length * 10 + 10,
      });
      setNewName("");
      toast.success("Task added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add task");
    }
  };

  return (
    <div className="space-y-2">
      {tasks.map((t) => (
        <div
          key={t.id}
          className="flex items-center gap-2"
          data-testid={`baseline-task-${t.id}`}
        >
          <Input
            defaultValue={t.name}
            onBlur={(e) => {
              if (e.target.value.trim() && e.target.value !== t.name) {
                update.mutate({
                  id: t.id,
                  baseline_list_id: baselineListId,
                  name: e.target.value.trim(),
                });
              }
            }}
            className="flex-1"
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (confirm(`Archive task "${t.name}"?`)) {
                archive.mutate({ id: t.id, baseline_list_id: baselineListId });
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2 pt-1">
        <Input
          placeholder="New seed task name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onAdd();
          }}
          data-testid="new-task-name"
        />
        <Button
          onClick={onAdd}
          disabled={create.isPending}
          size="sm"
          data-testid="add-task"
        >
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
      </div>
    </div>
  );
}

// Helper hook: load seed tasks for a set of baseline ids and return a Map.
function useSeedTasksForBaselines(baselineIds: string[]) {
  const key = baselineIds.sort().join(",");
  return useBatchSeedTasks(key, baselineIds);
}

function useBatchSeedTasks(key: string, baselineIds: string[]) {
  return useQuery<Map<string, Array<{ id: string; name: string }>>>({
    queryKey: ["baseline-tasks-batch", key],
    enabled: baselineIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("baseline_tasks")
        .select("id, name, baseline_list_id")
        .in("baseline_list_id", baselineIds)
        .is("archived_at", null)
        .order("display_order");
      if (error) throw error;
      const m = new Map<string, Array<{ id: string; name: string }>>();
      for (const r of data ?? []) {
        const arr = m.get(r.baseline_list_id) ?? [];
        arr.push({ id: r.id, name: r.name });
        m.set(r.baseline_list_id, arr);
      }
      return m;
    },
  });
}

export default Foundations;
