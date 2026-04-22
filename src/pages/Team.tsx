import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useDepartments } from "@/hooks/useDepartments";
import { useCreateTeamMember, useDeleteTeamMember, useTeam, useUpdateTeamMember } from "@/hooks/useTeam";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { formatZar } from "@/lib/utils";

export function Team() {
  const { data: members = [], isLoading } = useTeam();
  const { data: depts = [] } = useDepartments();
  const update = useUpdateTeamMember();
  const remove = useDeleteTeamMember();

  return (
    <div className="container mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
          <p className="text-sm text-muted-foreground">People who deliver the work. Primary department drives default assignment.</p>
        </div>
        <NewMemberDialog />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All members</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No team members yet. Click "New member".</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Name</th>
                  <th className="py-2">Email</th>
                  <th className="py-2">Primary dept</th>
                  <th className="py-2">Skills</th>
                  <th className="py-2 text-right">Cost / hr</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-b">
                    <td className="py-3 pr-2">
                      <Input
                        defaultValue={m.full_name}
                        onBlur={(e) => {
                          if (e.target.value !== m.full_name)
                            update.mutate({ id: m.id, patch: { full_name: e.target.value } });
                        }}
                      />
                    </td>
                    <td className="py-3 pr-2">
                      <Input
                        defaultValue={m.email ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value.trim() || null;
                          if (v !== m.email) update.mutate({ id: m.id, patch: { email: v } });
                        }}
                      />
                    </td>
                    <td className="py-3 pr-2 w-40">
                      <select
                        defaultValue={m.primary_department_id ?? ""}
                        onChange={(e) => {
                          const v = e.target.value || null;
                          update.mutate({ id: m.id, patch: { primary_department_id: v } });
                        }}
                        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                      >
                        <option value="">—</option>
                        {depts.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3 pr-2">
                      <SkillsEditor
                        skills={m.skills}
                        onChange={(skills) => update.mutate({ id: m.id, patch: { skills } })}
                      />
                    </td>
                    <td className="py-3 pl-2 w-32">
                      <Input
                        type="number"
                        className="text-right"
                        defaultValue={m.cost_rate_cents != null ? (m.cost_rate_cents / 100).toString() : ""}
                        placeholder="—"
                        onBlur={(e) => {
                          const raw = e.target.value.trim();
                          const cents = raw === "" ? null : Math.round(Number(raw) * 100);
                          if (cents !== m.cost_rate_cents)
                            update.mutate({ id: m.id, patch: { cost_rate_cents: cents } });
                        }}
                      />
                      {m.cost_rate_cents != null && (
                        <div className="mt-1 text-right text-xs text-muted-foreground">{formatZar(m.cost_rate_cents)}</div>
                      )}
                    </td>
                    <td className="py-3 pl-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (confirm(`Archive ${m.full_name}?`)) {
                            remove.mutate(m.id, {
                              onSuccess: () => toast.success(`Archived ${m.full_name}`),
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SkillsEditor({ skills, onChange }: { skills: string[]; onChange: (s: string[]) => void }) {
  const [input, setInput] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1">
      {skills.map((s) => (
        <Badge key={s} variant="secondary" className="gap-1">
          {s}
          <button onClick={() => onChange(skills.filter((x) => x !== s))} className="opacity-60 hover:opacity-100">×</button>
        </Badge>
      ))}
      <input
        placeholder="+ skill"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && input.trim()) {
            onChange([...skills, input.trim()]);
            setInput("");
          }
        }}
        className="h-7 w-24 rounded-md border-0 bg-transparent px-1 text-xs focus:outline-none focus:ring-0"
      />
    </div>
  );
}

function NewMemberDialog() {
  const { data: depts = [] } = useDepartments();
  const create = useCreateTeamMember();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [deptId, setDeptId] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" /> New member
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New team member</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Primary department</Label>
            <select value={deptId} onChange={(e) => setDeptId(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              <option value="">—</option>
              {depts.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
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
                {
                  full_name: name.trim(),
                  email: email.trim() || null,
                  primary_department_id: deptId || null,
                },
                {
                  onSuccess: () => {
                    setName(""); setEmail(""); setDeptId("");
                    setOpen(false);
                    toast.success("Member added");
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
