import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useDepartments } from "@/hooks/useDepartments";
import { useCreateRule, useDeleteRule, useRules, useUpdateRule, type RuleWithAllocations } from "@/hooks/useRules";
import { AllocationEditor, type AllocRow } from "@/components/AllocationEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { isSumValid } from "@/lib/allocation";

export function Rules() {
  const { data: rules = [], isLoading } = useRules();
  const { data: depts = [] } = useDepartments();
  const remove = useDeleteRule();

  return (
    <div className="container mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rules</h1>
          <p className="text-sm text-muted-foreground">Allocation templates. Each rule distributes % across departments; total must be 100.</p>
        </div>
        <NewRuleDialog />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rules.map((r) => (
            <RuleCard key={r.id} rule={r} depts={depts} onDelete={() => {
              if (confirm(`Archive rule "${r.name}"? Services using it will need a new rule.`)) {
                remove.mutate(r.id, {
                  onSuccess: () => toast.success(`Archived ${r.name}`),
                  onError: (e) => toast.error(e.message),
                });
              }
            }} />
          ))}
        </div>
      )}
    </div>
  );
}

function RuleCard({ rule, depts, onDelete }: { rule: RuleWithAllocations; depts: NonNullable<ReturnType<typeof useDepartments>["data"]>; onDelete: () => void }) {
  const update = useUpdateRule();
  const [allocations, setAllocations] = useState<AllocRow[]>(() =>
    rule.allocations.map((a) => ({ department_id: a.department_id, pct: Number(a.pct) }))
  );
  const [name, setName] = useState(rule.name);
  const [description, setDescription] = useState(rule.description ?? "");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setAllocations(rule.allocations.map((a) => ({ department_id: a.department_id, pct: Number(a.pct) })));
    setName(rule.name);
    setDescription(rule.description ?? "");
    setDirty(false);
  }, [rule.id, rule.allocations, rule.name, rule.description]);

  const valid = isSumValid(allocations);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            className="h-8 text-base font-semibold"
          />
        </CardTitle>
        <Button variant="ghost" size="icon" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label className="text-xs">Description</Label>
          <Textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setDirty(true);
            }}
            placeholder="e.g. Full website builds with SEO cleanup"
          />
        </div>
        <AllocationEditor
          allocations={allocations}
          departments={depts}
          onChange={(next) => {
            setAllocations(next);
            setDirty(true);
          }}
        />
        {dirty && (
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button
              variant="ghost"
              onClick={() => {
                setAllocations(rule.allocations.map((a) => ({ department_id: a.department_id, pct: Number(a.pct) })));
                setName(rule.name);
                setDescription(rule.description ?? "");
                setDirty(false);
              }}
            >
              Reset
            </Button>
            <Button
              disabled={!valid || !name.trim()}
              onClick={() => {
                update.mutate(
                  { id: rule.id, name: name.trim(), description: description || null, allocations },
                  {
                    onSuccess: () => {
                      setDirty(false);
                      toast.success("Rule saved");
                    },
                    onError: (e) => toast.error(e.message),
                  }
                );
              }}
            >
              Save
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NewRuleDialog() {
  const { data: depts = [] } = useDepartments();
  const create = useCreateRule();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [allocations, setAllocations] = useState<AllocRow[]>([]);

  return (
    <Dialog open={open} onOpenChange={(o) => {
      setOpen(o);
      if (o) { setName(""); setDescription(""); setAllocations([]); }
    }}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" /> New rule
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New rule</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Allocations</Label>
            <AllocationEditor allocations={allocations} departments={depts} onChange={setAllocations} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            disabled={!name.trim() || !isSumValid(allocations)}
            onClick={() => {
              create.mutate(
                { name: name.trim(), description: description || null, allocations },
                {
                  onSuccess: () => {
                    setOpen(false);
                    toast.success("Rule created");
                  },
                  onError: (e) => toast.error(e.message),
                }
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
