import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useDepartments } from "@/hooks/useDepartments";
import { useCreateTeamMember, useDeleteTeamMember, useTeam, useUpdateTeamMember } from "@/hooks/useTeam";
import {
  useTimeCategories,
  useOngoingTasksForMember,
  useProvisionOngoingTasks,
} from "@/hooks/useOngoingTasks";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { cn, cellField, formatZar } from "@/lib/utils";

export function Team() {
  const { data: members = [], isLoading } = useTeam();
  const { data: depts = [] } = useDepartments();
  const update = useUpdateTeamMember();
  const remove = useDeleteTeamMember();

  return (
    <div className="container mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-headline-medium">Team</h1>
          <p className="text-body-small text-m-on-surface-variant">
            {members.length} members · Primary department drives default assignment.
          </p>
        </div>
        <NewMemberDialog />
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : members.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No team members yet. Add one with “New member”.
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="border-b px-4 py-2.5">Name</th>
                  <th className="border-b px-3 py-2.5">Email</th>
                  <th className="border-b px-3 py-2.5">Primary dept</th>
                  <th className="border-b px-3 py-2.5">Skills</th>
                  <th className="border-b px-3 py-2.5">Ongoing</th>
                  <th className="border-b px-3 py-2.5 text-right">Cost / hr</th>
                  <th className="border-b px-3 py-2.5">Access</th>
                  <th className="border-b px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-b transition-colors hover:bg-m-surface-container-low">
                    <td className="px-2 py-1.5">
                      <Input
                        className={cellField}
                        defaultValue={m.full_name}
                        onBlur={(e) => {
                          if (e.target.value !== m.full_name)
                            update.mutate({ id: m.id, patch: { full_name: e.target.value } });
                        }}
                      />
                    </td>
                    <td className="px-1 py-1.5">
                      <Input
                        className={cellField}
                        defaultValue={m.email ?? ""}
                        placeholder="—"
                        onBlur={(e) => {
                          const v = e.target.value.trim() || null;
                          if (v !== m.email) update.mutate({ id: m.id, patch: { email: v } });
                        }}
                      />
                    </td>
                    <td className="w-40 px-1 py-1.5">
                      <select
                        defaultValue={m.primary_department_id ?? ""}
                        onChange={(e) => {
                          const v = e.target.value || null;
                          update.mutate({ id: m.id, patch: { primary_department_id: v } });
                        }}
                        className="h-9 w-full rounded-md border border-transparent bg-transparent px-2 text-sm text-m-on-surface transition-colors hover:bg-m-surface-container focus:bg-m-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="">—</option>
                        {depts.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-1.5">
                      <SkillsEditor
                        skills={m.skills}
                        onChange={(skills) => update.mutate({ id: m.id, patch: { skills } })}
                      />
                    </td>
                    <OngoingCell memberId={m.id} />
                    <td className="w-32 px-1 py-1.5">
                      <Input
                        type="number"
                        className={cn(cellField, "text-right")}
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
                        <div className="mt-0.5 px-2 text-right text-xs text-muted-foreground font-mono tabular-nums">{formatZar(m.cost_rate_cents)}</div>
                      )}
                    </td>
                    <AccessCell member={m} onChangeRole={(role) => update.mutate({ id: m.id, patch: { role } })} />
                    <td className="px-3 py-1.5">
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
            </div>
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
            <select value={deptId} onChange={(e) => setDeptId(e.target.value)} className="h-9 w-full rounded-md border border-m-outline bg-m-surface px-2 text-sm text-m-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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

function AccessCell({
  member,
  onChangeRole,
}: {
  member: { role: string; auth_user_id: string | null; email: string | null };
  onChangeRole: (role: string) => void;
}) {
  return (
    <td className="px-3 py-1.5">
      <div className="flex items-center gap-2">
        <select
          defaultValue={member.role}
          onChange={(e) => onChangeRole(e.target.value)}
          className="h-9 rounded-md border border-transparent bg-transparent px-2 text-sm text-m-on-surface transition-colors hover:bg-m-surface-container focus:bg-m-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="staff">Staff</option>
          <option value="admin">Admin</option>
          <option value="owner">Owner</option>
        </select>
        <Badge
          variant={member.auth_user_id ? "secondary" : "outline"}
          className="whitespace-nowrap"
          title={
            member.auth_user_id
              ? "Signed in at least once"
              : member.email
                ? "Hasn't signed in with Google yet"
                : "No email on file — can't sign in"
          }
        >
          {member.auth_user_id ? "Active" : "No login"}
        </Badge>
      </div>
    </td>
  );
}

function OngoingCell({ memberId }: { memberId: string }) {
  const { data: cats = [] } = useTimeCategories();
  const { data: tasks = [], isLoading } = useOngoingTasksForMember(memberId);
  const provision = useProvisionOngoingTasks();
  const missing = cats.length - tasks.length;

  return (
    <td className="px-3 py-1.5">
      <div className="flex items-center gap-2">
        <Badge variant={missing > 0 ? "destructive" : "secondary"}>
          {isLoading ? "…" : `${tasks.length}/${cats.length}`}
        </Badge>
        {missing > 0 && (
          <Button
            size="sm"
            variant="outline"
            disabled={provision.isPending}
            onClick={() =>
              provision.mutate(memberId, {
                onSuccess: (d) => toast.success(`Provisioned ${d.provisioned} task(s)`),
                onError: (e) => toast.error(e.message),
              })
            }
          >
            {provision.isPending ? "…" : "Provision"}
          </Button>
        )}
      </div>
    </td>
  );
}
