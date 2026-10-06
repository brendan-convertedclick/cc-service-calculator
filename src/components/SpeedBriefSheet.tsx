import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ClientListPicker } from "@/components/staff/ClientListPicker";
import { checklistFromSteps, pointsFromSteps, NO_WORKFLOW } from "@/components/systems/WorkflowSelect";
import { initials } from "@/components/systems/SystemBlockNode";
import { useAuth } from "@/context/AuthContext";
import { useClients } from "@/hooks/useClients";
import { memberColors, useTeam } from "@/hooks/useTeam";
import { useDepartments } from "@/hooks/useDepartments";
import { useRetainers, billableRetainersFor } from "@/hooks/useRetainers";
import { useSystemDefinitions } from "@/hooks/useSystemDefinitions";
import { useSystemSteps } from "@/hooks/useProcessSteps";
import { useCreateQuickBriefTask } from "@/hooks/useCreateQuickBriefTask";
import { defaultListId, useClientClickUpLists } from "@/hooks/useClientClickUpLists";
import { WAITING_STATUSES } from "@/hooks/useSignoffCandidates";
import { supabase } from "@/lib/supabase";
import { toISODate } from "@/lib/dates";
import { cn, errorMessage } from "@/lib/utils";

// "With the client" is not a person: the task stays unassigned and carries the
// list's waiting-on-client status, which is what Client sign-offs reads.
const CLIENT = "__client__";
const STATUS_DEFAULT = "__default__";
const UNITS = ["creatives", "posts", "pages", "ads", "videos", "exports"];
const HOUR_PRESETS = [0.5, 1, 2, 4];
type Billing = "retainer" | "adhoc" | "internal";
const BILLING: { v: Billing; label: string; key: string }[] = [
  { v: "retainer", label: "Retainer", key: "r" },
  { v: "adhoc", label: "Ad hoc", key: "a" },
  { v: "internal", label: "Internal", key: "i" },
];

// One question per screen. The four with `required` gate Next; the rest skip
// on Enter, and Review lists every field whichever way it was reached.
const STEPS = [
  { label: "Client", q: "Who's it for?" },
  { label: "Task", q: "What needs doing?" },
  { label: "Done", q: "What does done look like?", optional: true },
  { label: "Workflow", q: "Which kind of work is it?" },
  { label: "Checklist", q: "Anything to tick off?", optional: true },
  { label: "Who", q: "Who's doing it?" },
  { label: "Time", q: "How long will it take?", optional: true },
  { label: "Due", q: "When is it due?", optional: true },
  { label: "Billing", q: "Who pays for it?" },
  { label: "Where", q: "Where does it go in ClickUp?", optional: true },
  { label: "Review", q: "Check it and brief it" },
] as const;
const REVIEW = STEPS.length - 1;

function hoursLabel(h: number): string {
  const m = Math.round(h * 60);
  const H = Math.floor(m / 60);
  const M = m % 60;
  return [H && `${H}h`, M && `${M}m`].filter(Boolean).join(" ") || "0m";
}

function dueChoices(): { label: string; date: string }[] {
  const at = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return toISODate(d);
  };
  const next = (dow: number) => (dow - new Date().getDay() + 7) % 7 || 7;
  return [
    { label: "Today", date: at(0) },
    { label: "Tomorrow", date: at(1) },
    { label: "Friday", date: at(next(5)) },
    { label: "Next Monday", date: at(next(1)) },
    { label: "In 2 weeks", date: at(14) },
  ];
}

const niceDate = (iso: string) =>
  iso
    ? new Date(`${iso}T12:00`).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" })
    : "No due date";

const isTyping = (el: EventTarget) =>
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLInputElement && !["range", "checkbox", "file", "button"].includes(el.type));

/**
 * The + button's brief: one question per screen, every field the Brief sheet
 * has, then a review of the whole thing. It writes the briefs row and creates
 * the ClickUp task in one go, through the same edge function as QuickBriefSheet,
 * so a task reads the same whichever sheet made it.
 *
 * AppShell remounts it on every open (a `key` bump), which is the reset.
 */
export function SpeedBriefSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { currentUserId } = useAuth();
  const { data: clients = [] } = useClients();
  const { data: team = [] } = useTeam();
  const memberColor = useMemo(() => memberColors(team), [team]);
  const { data: departments = [] } = useDepartments();
  const { data: allRetainers = [] } = useRetainers();
  const { data: systems = [] } = useSystemDefinitions();
  const createTask = useCreateQuickBriefTask();

  const [step, setStep] = useState(0);
  const [clientId, setClientId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [success, setSuccess] = useState("");
  const [outCount, setOutCount] = useState<number | null>(null);
  const [outUnit, setOutUnit] = useState("");
  const [systemId, setSystemId] = useState(NO_WORKFLOW);
  const [unticked, setUnticked] = useState<string[]>([]);
  const [extraItems, setExtraItems] = useState<string[]>([]);
  const [draftItem, setDraftItem] = useState("");
  const [workStream, setWorkStream] = useState("");
  const [assignee, setAssignee] = useState<string | null>(null);
  const [briefedByPick, setBriefedBy] = useState<string | null>(null);
  const [hours, setHours] = useState<number | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [billingPick, setBilling] = useState<Billing | null>(null);
  const [retainerPick, setRetainer] = useState<string | null>(null);
  const [listId, setListId] = useState("");
  const [status, setStatus] = useState(STATUS_DEFAULT);
  // Held across a failed Create so a retry reuses the brief it already wrote.
  // Once it exists the client is locked: the row already carries it.
  const [createdBriefId, setCreatedBriefId] = useState<string | null>(null);
  const [writingBrief, setWritingBrief] = useState(false);

  // Defaults that stay live until someone overrides them.
  const briefedBy = briefedByPick ?? currentUserId;
  const workflows = useMemo(() => systems.filter((s) => s.step_count > 0), [systems]);
  const workflow = workflows.find((s) => s.id === systemId) ?? null;
  const { data: steps = [], isLoading: stepsLoading } = useSystemSteps(
    systemId === NO_WORKFLOW ? undefined : systemId,
  );
  const usableSteps = steps.filter((s) => s.materialise_as !== "none");
  const tickedSteps = usableSteps.filter((s) => !unticked.includes(s.id));
  const checklist = [...checklistFromSteps(tickedSteps).split("\n").filter(Boolean), ...extraItems];
  // Hours come from the ticked steps, so unticking one lowers the estimate.
  const workflowPoints = systemId === NO_WORKFLOW ? null : pointsFromSteps(tickedSteps);
  const effHours = hours ?? (workflowPoints != null ? workflowPoints / 4 : 1);

  const retainers = billableRetainersFor(allRetainers, clientId || null);
  const billing: Billing = billingPick ?? (retainers.length ? "retainer" : "adhoc");
  const retainerId =
    billing === "retainer" ? (retainerPick ?? (retainers.length === 1 ? retainers[0].id : null)) : null;

  // Fetched as soon as the client is answered, so the Where step is ready.
  const listsQuery = useClientClickUpLists(open && clientId ? clientId : null);
  const lists = useMemo(() => listsQuery.data?.lists ?? [], [listsQuery.data]);
  const workStreamOptions = listsQuery.data?.work_stream_options ?? [];
  // ClickUp's own Work Stream options; Conductor's department names only when
  // that fetch failed, so the brief is never blocked on it.
  const workStreamSource = workStreamOptions.length > 0 ? workStreamOptions : departments;
  const workStreamValid = workStreamSource.some((d) => d.name === workStream);
  useEffect(() => {
    setListId(defaultListId(lists));
    setStatus(STATUS_DEFAULT);
  }, [lists]);
  const selectedList = lists.find((l) => l.id === listId);
  const waitingStatus =
    (selectedList?.statuses ?? []).find((s) => (WAITING_STATUSES as readonly string[]).includes(s.status.toLowerCase()))
      ?.status ?? null;
  const effectiveStatus = assignee === CLIENT && waitingStatus ? waitingStatus : status;

  const client = clients.find((c) => c.id === clientId);
  const memberName = (id: string | null) => team.find((m) => m.id === id)?.full_name;

  const blocker = !clientId
    ? "Pick a client."
    : !name.trim()
      ? "Name the task."
      : !workStreamValid
        ? "Pick a work stream."
        : !assignee
          ? "Pick who's doing it."
          : billing === "retainer" && !retainerId
            ? retainers.length
              ? "Pick which retainer."
              : "This client has no live retainer. Bill it ad hoc or internal."
            : null;
  const stepDone = [
    !!clientId,
    !!name.trim(),
    true,
    workStreamValid,
    true,
    !!assignee,
    true,
    true,
    !(billing === "retainer" && !retainerId),
    true,
    blocker == null,
  ];
  const reachable = (i: number) => (i === 0 ? createdBriefId == null : stepDone.slice(0, i).every(Boolean));
  const saving = createTask.isPending || writingBrief;

  const go = (i: number) => {
    if (i >= 0 && i <= REVIEW && reachable(i)) setStep(i);
  };
  const next = () => {
    if (!stepDone[step]) return;
    if (step < REVIEW) setStep(step + 1);
    else void handleCreate();
  };
  const back = () => {
    if (step > 0 && reachable(step - 1)) setStep(step - 1);
  };

  // Every step opens with its first box focused, or the panel itself so number
  // keys and Enter work without a click. "Done" is optional but opens on a
  // text box, where Enter is a newline, so it focuses the panel: Enter skips.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const root = bodyRef.current;
      const first = step === 2 ? null : root?.querySelector<HTMLElement>(
        "textarea, input:not([type=file]):not([type=date]):not([type=checkbox]):not([type=range])",
      );
      (first ?? root)?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [step, open]);

  const handleCreate = async () => {
    if (blocker) return;
    try {
      let briefId = createdBriefId;
      if (!briefId) {
        setWritingBrief(true);
        try {
          const { data, error } = await supabase
            .from("briefs")
            .insert({
              client_id: clientId,
              source: "manual",
              raw_subject: name.trim(),
              raw_body: description.trim() || name.trim(),
              status: "new",
            })
            .select("id")
            .single();
          if (error) throw error;
          briefId = (data as { id: string }).id;
          setCreatedBriefId(briefId);
        } finally {
          setWritingBrief(false);
        }
      }
      // The link lives on the brief: it is what counts this work against the retainer.
      if (retainerId) await supabase.from("briefs").update({ parent_project_id: retainerId }).eq("id", briefId);
      // Same composition as QuickBriefSheet, so the ClickUp task reads the same.
      const extras = [
        success.trim() && `**What success looks like**\n${success.trim()}`,
        outCount && `**Expected output**\n${outCount} ${outUnit}`.trim(),
      ].filter(Boolean) as string[];
      const composed = [description.trim(), ...extras].filter(Boolean).join("\n\n");
      const { clickup_task_url } = await createTask.mutateAsync({
        brief_id: briefId,
        task_name: name.trim(),
        description: composed || undefined,
        assignee_member_id: assignee === CLIENT ? null : assignee,
        sprint_points: Math.max(1, Math.round(effHours * 4)),
        work_stream: workStream,
        due_date: dueDate || null,
        list_id: listId || undefined,
        status: effectiveStatus === STATUS_DEFAULT ? undefined : effectiveStatus,
        briefed_by_member_id: briefedBy,
        billing_type: billing,
        checklist_items: checklist,
        system_id: systemId === NO_WORKFLOW ? null : systemId,
        attachments,
      });
      toast.success("Task created in ClickUp", {
        action: clickup_task_url ? { label: "Open", onClick: () => window.open(clickup_task_url, "_blank") } : undefined,
      });
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || saving) return;
    const target = e.target as HTMLElement;
    if (e.key === "Enter") {
      if (target.id === "sb-add") {
        e.preventDefault();
        if (draftItem.trim()) {
          setExtraItems([...extraItems, draftItem.trim()]);
          setDraftItem("");
        } else next();
        return;
      }
      if (target instanceof HTMLTextAreaElement && !(e.metaKey || e.ctrlKey)) return;
      if (target instanceof HTMLButtonElement) return;
      e.preventDefault();
      next();
      return;
    }
    if (isTyping(target) || e.metaKey || e.ctrlKey || e.altKey) return;
    const n = Number(e.key);
    if (step === 8) {
      const b = BILLING.find((x) => x.key === e.key.toLowerCase());
      if (b) return void setBilling(b.v);
      if (n >= 1 && retainers[n - 1]) {
        setBilling("retainer");
        setRetainer(retainers[n - 1].id);
      }
      return;
    }
    if (!/^[0-9]$/.test(e.key)) return;
    const people = [...team.map((m) => m.id), CLIENT];
    if (step === 5 && n >= 1 && people[n - 1]) {
      const id = people[n - 1];
      if (id === CLIENT && !waitingStatus) return;
      setAssignee(id);
      setStep(6);
    } else if (step === 6 && n >= 1 && HOUR_PRESETS[n - 1]) {
      setHours(HOUR_PRESETS[n - 1]);
      setStep(7);
    } else if (step === 7) {
      setDueDate(n === 0 ? "" : (dueChoices()[n - 1]?.date ?? dueDate));
      if (n === 0 || dueChoices()[n - 1]) setStep(8);
    }
  };

  const fields: { k: string; v: string; state: "set" | "default" | "missing"; step: number }[] = [
    { k: "Client", v: client?.name ?? "", state: client ? "set" : "missing", step: 0 },
    { k: "Task", v: name.trim(), state: name.trim() ? "set" : "missing", step: 1 },
    { k: "Description", v: description.trim() || "Uses the task name", state: description.trim() ? "set" : "default", step: 1 },
    { k: "Files", v: attachments.map((f) => f.name).join(", ") || "None", state: attachments.length ? "set" : "default", step: 1 },
    { k: "Done when", v: success.trim() || "Not said", state: success.trim() ? "set" : "default", step: 2 },
    { k: "Output", v: outCount ? `${outCount} ${outUnit}`.trim() : "Not said", state: outCount ? "set" : "default", step: 2 },
    { k: "Workflow", v: workflow?.name ?? "None", state: workflow ? "set" : "default", step: 3 },
    { k: "Work stream", v: workStream || "Not picked", state: workStreamValid ? "set" : "missing", step: 3 },
    { k: "Checklist", v: checklist.length ? `${checklist.length}: ${checklist.join(" · ")}` : "None", state: checklist.length ? "set" : "default", step: 4 },
    { k: "Assignee", v: assignee === CLIENT ? "With the client" : (memberName(assignee) ?? ""), state: assignee ? "set" : "missing", step: 5 },
    { k: "Briefed by", v: memberName(briefedBy) ?? "Nobody", state: briefedByPick ? "set" : "default", step: 5 },
    { k: "Time", v: `${hoursLabel(effHours)} · ${Math.max(1, Math.round(effHours * 4))} pts`, state: hours != null || workflowPoints != null ? "set" : "default", step: 6 },
    { k: "Due", v: niceDate(dueDate), state: dueDate ? "set" : "default", step: 7 },
    { k: "Billing", v: BILLING.find((b) => b.v === billing)!.label, state: billingPick ? "set" : "default", step: 8 },
    {
      k: "Retainer",
      v: billing !== "retainer" ? "Not needed" : (retainers.find((r) => r.id === retainerId)?.name ?? (retainers.length ? "Which one?" : "None live")),
      state: billing !== "retainer" ? "default" : retainerId ? "set" : "missing",
      step: 8,
    },
    { k: "List", v: selectedList?.name ?? "Server default", state: "default", step: 9 },
    { k: "Status", v: effectiveStatus === STATUS_DEFAULT ? "List default" : effectiveStatus, state: status !== STATUS_DEFAULT ? "set" : "default", step: 9 },
  ];

  const stepBody = (): ReactNode => {
    switch (step) {
      case 0:
        return (
          <ClientListPicker
            id="sb-client"
            clients={clients}
            value={clientId}
            pickOnEnter
            onValueChange={(v) => {
              setClientId(v);
              setBilling(null);
              setRetainer(null);
              setStep(1);
            }}
          />
        );
      case 1:
        return (
          <>
            <Input id="sb-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Shutter sale web banners" className="h-11 text-body-large" aria-label="Task name" />
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional). Left blank, the task carries the task name." aria-label="Description" />
            <FilePicker files={attachments} onChange={setAttachments} />
          </>
        );
      case 2:
        return (
          <>
            <div className="space-y-2">
              <Label htmlFor="sb-success">Done when</Label>
              <Textarea id="sb-success" rows={2} value={success} onChange={(e) => setSuccess(e.target.value)} placeholder="Describe the finished state." />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sb-out">Expected output, in numbers</Label>
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex overflow-hidden rounded-md border border-input">
                  <button type="button" className="w-9 bg-m-surface-container text-title-medium" aria-label="One fewer" onClick={() => setOutCount(Math.max(0, (outCount ?? 0) - 1) || null)}>−</button>
                  <input id="sb-out" inputMode="numeric" className="w-16 bg-transparent text-center tabular-nums outline-none" value={outCount ?? ""} placeholder="0" onChange={(e) => setOutCount(parseInt(e.target.value) || null)} />
                  <button type="button" className="w-9 bg-m-surface-container text-title-medium" aria-label="One more" onClick={() => setOutCount((outCount ?? 0) + 1)}>+</button>
                </div>
                <Chips items={UNITS.map((u) => ({ v: u, label: u }))} value={outUnit} onPick={(v) => setOutUnit(v === outUnit ? "" : v)} />
              </div>
              <p className="text-label-small text-m-on-surface-variant">A count someone can check this against later.</p>
            </div>
          </>
        );
      case 3:
        return (
          <>
            <ClientListPicker
              id="sb-workflow"
              label="Workflow"
              clients={[{ id: NO_WORKFLOW, name: "No workflow" }, ...workflows]}
              value={systemId}
              pickOnEnter
              onValueChange={(v) => {
                setSystemId(v);
                setUnticked([]);
                setHours(null);
                if (workStreamValid) setStep(4);
              }}
            />
            <div className="space-y-2">
              <Label>Work stream</Label>
              <Chips items={workStreamSource.map((d) => ({ v: d.name, label: d.name }))} value={workStream} onPick={setWorkStream} />
              <p className="text-label-small text-m-on-surface-variant">
                {workStreamOptions.length > 0 || listsQuery.isFetching
                  ? "Sets the ClickUp Work Stream field and the invoice trail."
                  : "Couldn't load ClickUp's Work Stream options, so these are Conductor's department names. Check the field in ClickUp after creating."}
              </p>
            </div>
          </>
        );
      case 4:
        return (
          <div className="space-y-2">
            {systemId === NO_WORKFLOW && <p className="text-body-small text-m-on-surface-variant">No workflow, so the list starts empty.</p>}
            {stepsLoading && <p className="text-body-small text-m-on-surface-variant">Loading the workflow's steps…</p>}
            {usableSteps.map((s) => (
              <label key={s.id} className="flex items-start gap-2 text-body-medium">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]"
                  checked={!unticked.includes(s.id)}
                  onChange={(e) => setUnticked(e.target.checked ? unticked.filter((x) => x !== s.id) : [...unticked, s.id])}
                />
                <span className="flex-1">{s.title}</span>
                {s.estimated_hours != null && (
                  <span className="text-label-small text-m-on-surface-variant">{hoursLabel(Number(s.estimated_hours))}</span>
                )}
              </label>
            ))}
            {extraItems.map((item, i) => (
              <label key={`${item}-${i}`} className="flex items-start gap-2 text-body-medium">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]" checked onChange={() => setExtraItems(extraItems.filter((_, n) => n !== i))} />
                <span className="flex-1">{item}</span>
                <span className="text-label-small text-m-on-surface-variant">added</span>
              </label>
            ))}
            <Input id="sb-add" value={draftItem} onChange={(e) => setDraftItem(e.target.value)} placeholder="Add an item and press Enter. Empty Enter moves on." aria-label="Add a checklist item" />
          </div>
        );
      case 5:
        return (
          <>
            <div className="space-y-1">
              {team.map((m, i) => (
                <Row key={m.id} n={i + 1} pressed={assignee === m.id} onClick={() => { setAssignee(m.id); setStep(6); }}>
                  <Avatar name={m.full_name} color={memberColor.get(m.id)} />
                  {m.full_name}
                </Row>
              ))}
              <Row n={team.length + 1} pressed={assignee === CLIENT} disabled={!waitingStatus} onClick={() => { setAssignee(CLIENT); setStep(6); }}>
                With the client
                <span className="ml-auto text-label-small text-m-on-surface-variant">
                  {waitingStatus ? `unassigned, “${waitingStatus}”` : "needs a waiting-on-client status on the list"}
                </span>
              </Row>
            </div>
            <div className="space-y-2">
              <Label>Briefed by</Label>
              <Chips items={team.map((m) => ({ v: m.id, label: m.id === currentUserId ? `${m.full_name} (you)` : m.full_name }))} value={briefedBy ?? ""} onPick={setBriefedBy} />
            </div>
          </>
        );
      case 6:
        return (
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="sb-hours">Time</Label>
              <span className="text-title-medium tabular-nums">
                {hoursLabel(effHours)} <span className="text-body-small text-m-on-surface-variant">{Math.max(1, Math.round(effHours * 4))} pts</span>
              </span>
            </div>
            <input id="sb-hours" type="range" min={0.25} max={16} step={0.25} value={effHours} onChange={(e) => setHours(Number(e.target.value))} className="w-full accent-[hsl(var(--primary))]" />
            <div className="flex justify-between text-label-small text-m-on-surface-variant tabular-nums">
              <span>15m</span><span>4h</span><span>8h</span><span>12h</span><span>16h</span>
            </div>
            {hours == null && workflowPoints != null && (
              <p className="text-label-small text-m-on-surface-variant">From the workflow's ticked steps.</p>
            )}
            <Chips items={HOUR_PRESETS.map((h, i) => ({ v: String(h), label: hoursLabel(h), key: String(i + 1) }))} value={hours != null ? String(hours) : ""} onPick={(v) => setHours(Number(v))} />
          </div>
        );
      case 7:
        return (
          <>
            <div className="space-y-1">
              {dueChoices().map((d, i) => (
                <Row key={d.label} n={i + 1} pressed={dueDate === d.date} onClick={() => { setDueDate(d.date); setStep(8); }}>
                  {d.label}
                  <span className="ml-auto text-label-small text-m-on-surface-variant">{niceDate(d.date)}</span>
                </Row>
              ))}
              <Row n={0} pressed={!dueDate} onClick={() => { setDueDate(""); setStep(8); }}>No due date</Row>
            </div>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Another date" className="max-w-xs" />
          </>
        );
      case 8:
        return (
          <>
            <div className="grid grid-cols-3 overflow-hidden rounded-md border border-input">
              {BILLING.map((b) => (
                <button
                  key={b.v}
                  type="button"
                  aria-pressed={billing === b.v}
                  onClick={() => setBilling(b.v)}
                  className={cn("py-2 text-label-large", billing === b.v ? "bg-primary text-primary-foreground" : "hover:bg-m-surface-container-high")}
                >
                  {b.label} <Kbd>{b.key.toUpperCase()}</Kbd>
                </button>
              ))}
            </div>
            {billing === "retainer" &&
              (retainers.length ? (
                <div className="space-y-1">
                  {retainers.map((r, i) => (
                    <Row key={r.id} n={i + 1} pressed={retainerId === r.id} onClick={() => setRetainer(r.id)}>{r.name}</Row>
                  ))}
                </div>
              ) : (
                <p className="rounded-md bg-m-error-container px-2 py-1.5 text-label-small text-m-on-error-container">
                  This client has no live retainer. Bill it ad hoc, or set the retainer up first. Otherwise this work is delivered against nothing.
                </p>
              ))}
            {billing === "internal" && (
              <p className="text-body-small text-m-on-surface-variant">Our own cost. It stays off this client's invoiced and retainer figures, and shows on the Internal tab instead.</p>
            )}
            {billing === "adhoc" && <p className="text-body-small text-m-on-surface-variant">Invoiced on its own.</p>}
          </>
        );
      case 9:
        return (
          <>
            <div className="space-y-2">
              <Label>List</Label>
              {listsQuery.isFetching ? (
                <p className="text-body-small text-m-on-surface-variant">Loading lists…</p>
              ) : lists.length ? (
                <Chips items={lists.map((l) => ({ v: l.id, label: l.name }))} value={listId} onPick={(v) => { setListId(v); setStatus(STATUS_DEFAULT); }} />
              ) : (
                <p className="text-body-small text-m-on-surface-variant">
                  {listsQuery.error ? `Couldn't load lists (${errorMessage(listsQuery.error)}). ` : ""}The server will pick the client's default list.
                </p>
              )}
            </div>
            {selectedList && (
              <div className="space-y-2">
                <Label>Status</Label>
                <Chips
                  items={[{ v: STATUS_DEFAULT, label: "List default" }, ...selectedList.statuses.map((s) => ({ v: s.status, label: s.status }))]}
                  value={effectiveStatus}
                  onPick={setStatus}
                  disabled={assignee === CLIENT}
                />
                {assignee === CLIENT && waitingStatus && (
                  <p className="text-label-small text-m-on-surface-variant">With the client, so it goes in as “{waitingStatus}”.</p>
                )}
              </div>
            )}
          </>
        );
      default:
        return (
          <div className="overflow-hidden rounded-lg border border-m-outline-variant">
            {fields.map((f) => (
              <button
                key={f.k}
                type="button"
                disabled={f.step === 0 && createdBriefId != null}
                onClick={() => go(f.step)}
                className={cn(
                  "grid w-full grid-cols-[6.5rem_minmax(0,1fr)_auto] items-baseline gap-3 border-b border-m-outline-variant px-3 py-1.5 text-left text-body-small last:border-b-0 hover:bg-m-surface-container",
                  f.state === "missing" && "bg-m-error-container text-m-on-error-container",
                )}
              >
                <span className={cn("font-medium", f.state !== "missing" && "text-m-on-surface-variant")}>{f.k}</span>
                <span className={cn("break-words", f.state === "default" && "text-m-on-surface-variant")}>{f.v}</span>
                <span className="text-label-small">{f.state === "missing" ? "needed" : f.state === "default" ? "default" : "✓"}</span>
              </button>
            ))}
          </div>
        );
    }
  };

  const current = STEPS[step];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-lg"
        onEscapeKeyDown={(e) => {
          // Esc steps back; only on the first question does it close.
          if (step > 0) {
            e.preventDefault();
            back();
          }
        }}
      >
        <SheetHeader>
          <SheetTitle>New brief</SheetTitle>
        </SheetHeader>

        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${STEPS.length}, minmax(0, 1fr))` }}>
          {STEPS.map((s, i) => (
            <button
              key={s.label}
              type="button"
              title={s.label}
              aria-label={s.label}
              disabled={!reachable(i)}
              onClick={() => go(i)}
              className={cn("h-1.5 rounded-full", i === step ? "bg-primary" : i < step ? "bg-m-outline" : "bg-m-outline-variant")}
            />
          ))}
        </div>

        <div ref={bodyRef} tabIndex={-1} onKeyDown={onKeyDown} className="flex flex-1 flex-col gap-4 outline-none">
          <div className="space-y-1">
            <p className="text-label-medium text-m-on-surface-variant">
              {step + 1} of {STEPS.length} · {current.label}
              {"optional" in current && " · optional, Enter skips"}
              {client && step > 0 && ` · ${client.name}`}
            </p>
            <h3 className="text-title-large">{current.q}</h3>
          </div>
          {stepBody()}
          <p className="text-label-small text-m-on-surface-variant">
            <Kbd>Enter</Kbd> next{step > 0 && <>, <Kbd>Esc</Kbd> back</>}
            {[5, 6, 7, 8].includes(step) && ", number keys pick"}
            {step === 8 && ", R A I for billing"}
            {(step === 1 || step === 2) && <>, <Kbd>⌘ Enter</Kbd> from a text box</>}.
          </p>
        </div>

        <div className="flex items-center gap-2 border-t border-m-outline-variant pt-3">
          {step > 0 && (
            <Button variant="outline" size="sm" onClick={back} disabled={saving || !reachable(step - 1)}>
              Back
            </Button>
          )}
          {step < REVIEW && reachable(REVIEW) && (
            <Button variant="ghost" size="sm" onClick={() => setStep(REVIEW)}>
              Review now
            </Button>
          )}
          {step === REVIEW && blocker && <span className="text-label-small text-m-on-surface-variant">{blocker}</span>}
          <Button className="ml-auto" disabled={saving || !stepDone[step]} onClick={next}>
            {step < REVIEW ? "Next" : saving ? "Creating…" : "Create task"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-m-outline px-1 font-mono text-label-small text-m-on-surface-variant">{children}</kbd>;
}

function Avatar({ name, color }: { name: string; color: string | undefined }) {
  return (
    <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: color }}>
      {initials(name)}
    </span>
  );
}

// A numbered answer: the number is the key that picks it.
function Row({ n, pressed, disabled, onClick, children }: { n: number; pressed: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-label-large tracking-normal transition-colors disabled:opacity-50",
        pressed ? "border-primary bg-m-primary-container text-m-on-primary-container" : "border-m-outline-variant hover:bg-m-surface-container-high",
      )}
    >
      <span className="w-3 font-mono text-label-small text-m-on-surface-variant">{n}</span>
      {children}
    </button>
  );
}

function Chips({
  items,
  value,
  onPick,
  disabled,
}: {
  items: { v: string; label: string; key?: string }[];
  value: string;
  onPick: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it) => (
        <button
          key={it.v}
          type="button"
          aria-pressed={value === it.v}
          disabled={disabled}
          onClick={() => onPick(it.v)}
          className={cn(
            "rounded-full border px-3 py-1 text-label-medium transition-colors disabled:opacity-50",
            value === it.v ? "border-primary bg-m-primary-container text-m-on-primary-container" : "border-m-outline-variant bg-m-surface-container-low hover:border-m-outline",
          )}
        >
          {it.label}
          {it.key && <span className="ml-1.5 font-mono text-label-small text-m-on-surface-variant">{it.key}</span>}
        </button>
      ))}
    </div>
  );
}

function FilePicker({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  // <input type="file"> is uncontrolled; bump the key to clear it after a pick.
  const [inputKey, setInputKey] = useState(0);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        key={inputKey}
        type="file"
        multiple
        className="max-w-xs"
        aria-label="Attach files"
        onChange={(e) => {
          onChange([...files, ...Array.from(e.target.files ?? [])]);
          setInputKey((k) => k + 1);
        }}
      />
      {files.map((f, i) => (
        <button key={`${f.name}-${i}`} type="button" onClick={() => onChange(files.filter((_, n) => n !== i))} className="rounded-full border border-m-outline-variant px-2.5 py-0.5 text-label-small" title="Remove">
          {f.name} ×
        </button>
      ))}
    </div>
  );
}
