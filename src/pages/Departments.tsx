import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useCreateDepartment, useDeleteDepartment, useDepartments, useUpdateDepartment } from "@/hooks/useDepartments";
import { useTeam } from "@/hooks/useTeam";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { cn, cellField, formatZar } from "@/lib/utils";

export function Departments() {
  const { data = [], isLoading } = useDepartments();
  const { data: team = [] } = useTeam();
  const update = useUpdateDepartment();
  const remove = useDeleteDepartment();

  return (
    <div className="container mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-headline-medium">Departments</h1>
          <p className="text-body-small text-m-on-surface-variant">
            {data.length} departments · Each takes a share of every service; the sell rate drives the price-to-hours math.
          </p>
        </div>
        <NewDeptDialog />
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : data.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No departments yet. Add one with “New department”.
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="border-b px-4 py-2.5">Name</th>
                  <th className="border-b px-3 py-2.5">Primary member</th>
                  <th className="border-b px-3 py-2.5 text-right">Sell rate / hr</th>
                  <th className="border-b px-3 py-2.5 text-right">Cost rate / hr</th>
                  <th className="border-b px-3 py-2.5">Order</th>
                  <th className="border-b px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.id} className="border-b transition-colors hover:bg-m-surface-container-low">
                    <td className="px-2 py-1.5">
                      <Input
                        className={cellField}
                        defaultValue={d.name}
                        onBlur={(e) => {
                          if (e.target.value !== d.name)
                            update.mutate({ id: d.id, patch: { name: e.target.value } });
                        }}
                      />
                    </td>
                    <td className="px-1 py-1.5">
                      <Select
                        value={d.primary_team_member_id ?? "__none__"}
                        onValueChange={(v) => {
                          const val = v === "__none__" ? null : v;
                          if (val !== d.primary_team_member_id)
                            update.mutate({ id: d.id, patch: { primary_team_member_id: val } });
                        }}
                      >
                        <SelectTrigger className={cn(cellField, "w-full")}>
                          <SelectValue placeholder="Unassigned" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Unassigned</SelectItem>
                          {team.map((t) => (
                            <SelectItem key={t.id} value={t.id}>{t.full_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-1 py-1.5">
                      <Input
                        type="number"
                        className={cn(cellField, "text-right")}
                        defaultValue={(d.hourly_rate_cents / 100).toString()}
                        onBlur={(e) => {
                          const cents = Math.round(Number(e.target.value) * 100);
                          if (cents !== d.hourly_rate_cents)
                            update.mutate({ id: d.id, patch: { hourly_rate_cents: cents } });
                        }}
                      />
                      <div className="mt-0.5 px-2 text-right text-xs text-muted-foreground font-mono tabular-nums">{formatZar(d.hourly_rate_cents)}</div>
                    </td>
                    <td className="px-1 py-1.5">
                      <Input
                        type="number"
                        className={cn(cellField, "text-right")}
                        defaultValue={d.cost_rate_cents != null ? (d.cost_rate_cents / 100).toString() : ""}
                        placeholder="—"
                        onBlur={(e) => {
                          const raw = e.target.value.trim();
                          const cents = raw === "" ? null : Math.round(Number(raw) * 100);
                          if (cents !== d.cost_rate_cents)
                            update.mutate({ id: d.id, patch: { cost_rate_cents: cents } });
                        }}
                      />
                    </td>
                    <td className="w-24 px-1 py-1.5">
                      <Input
                        type="number"
                        className={cellField}
                        defaultValue={d.display_order.toString()}
                        onBlur={(e) => {
                          const n = Number(e.target.value);
                          if (n !== d.display_order)
                            update.mutate({ id: d.id, patch: { display_order: n } });
                        }}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm(`Archive "${d.name}"?`)) {
                            remove.mutate(d.id, {
                              onSuccess: () => toast.success(`Archived ${d.name}`),
                              onError: (e) => toast.error(e.message),
                            });
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NewDeptDialog() {
  const create = useCreateDepartment();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [rate, setRate] = useState("1075");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" /> New department
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New department</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label>Sell rate per hour (ZAR)</Label>
            <Input type="number" value={rate} onChange={(e) => setRate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            onClick={() => {
              if (!name.trim()) return toast.error("Name required");
              create.mutate(
                { name: name.trim(), hourly_rate_cents: Math.round(Number(rate) * 100) },
                {
                  onSuccess: () => {
                    setName("");
                    setOpen(false);
                    toast.success(`Created ${name}`);
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
