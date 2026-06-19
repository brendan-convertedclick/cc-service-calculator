import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ServicePicker } from "@/components/ServicePicker";
import { useClients } from "@/hooks/useClients";
import { useClientLists } from "@/hooks/useClientLists";
import { useServices } from "@/hooks/useServices";
import { useTeam } from "@/hooks/useTeam";
import { useCreateRetainer } from "@/hooks/useCreateRetainer";
import type { CreateRetainerInput } from "@/hooks/useCreateRetainer";
import { useSettings } from "@/hooks/useSettings";
import { useClientAcceptedQuotes } from "@/hooks/useQuotes";
import { useParseRetainerInvoice } from "@/hooks/useParseRetainerInvoice";
import { formatZar } from "@/lib/utils";

const STEPS = [
  { key: "terms", label: "Terms" },
  { key: "services", label: "Recurring services" },
  { key: "review", label: "Review" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

const CADENCES = ["daily", "weekly", "biweekly", "monthly", "custom"] as const;
type Cadence = (typeof CADENCES)[number];

type ServiceRow = {
  rowId: string;
  service_id: string;
  cadence: Cadence;
  occurrences_per_month: number;
  points_per_occurrence: number;
  default_assignees: string[];
  is_live_eligible: boolean;
};

let rowSeq = 0;
const nextRowId = () => `row-${rowSeq++}`;

const today = () => new Date().toISOString().slice(0, 10);

function rowIsValid(r: ServiceRow): boolean {
  return (
    !!r.service_id &&
    r.occurrences_per_month > 0 &&
    r.points_per_occurrence > 0 &&
    r.default_assignees.length >= 1
  );
}

function Stepper({ current }: { current: StepKey }) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);
  return (
    <ol className="flex items-center gap-2 text-label-small">
      {STEPS.map((step, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <li key={step.key} className="flex items-center gap-2">
            <span
              className={
                "flex h-6 w-6 items-center justify-center rounded-full border " +
                (done
                  ? "border-m-primary bg-m-primary text-m-on-primary"
                  : active
                  ? "border-m-primary text-m-primary"
                  : "border-m-outline-variant text-m-on-surface-variant")
              }
            >
              {done ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span
              className={
                active
                  ? "text-m-on-surface"
                  : done
                  ? "text-m-on-surface-variant"
                  : "text-m-on-surface-variant/70"
              }
            >
              {step.label}
            </span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-8 bg-m-outline-variant" />}
          </li>
        );
      })}
    </ol>
  );
}

export function NewRetainerWizard() {
  const navigate = useNavigate();
  const { data: clients = [] } = useClients();
  const { data: team = [] } = useTeam();
  const { data: services = [] } = useServices();
  const { data: settings } = useSettings();
  const createRetainer = useCreateRetainer();
  const parseInvoice = useParseRetainerInvoice();

  const [step, setStep] = useState<StepKey>("terms");

  // Step 1 — Terms
  const [clientId, setClientId] = useState<string>("");
  const [clickupListId, setClickupListId] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [nameTouched, setNameTouched] = useState(false);
  const [recurrenceStart, setRecurrenceStart] = useState<string>(today());
  const [hoursTarget, setHoursTarget] = useState<string>("");
  const [hoursTouched, setHoursTouched] = useState(false);
  const [monthlyFee, setMonthlyFee] = useState<string>("");
  const [importQuoteId, setImportQuoteId] = useState<string>("");

  // Step 2 — Recurring services
  const [rows, setRows] = useState<ServiceRow[]>([]);

  const { data: clientLists = [], isLoading: listsLoading } = useClientLists(clientId || null);
  const { data: clientQuotes = [] } = useClientAcceptedQuotes(clientId || null);

  // Default the ClickUp list to "Delivery" (where client delivery work lives)
  // once the client's lists load, unless one is already chosen. Client change
  // resets clickupListId to "", so this re-applies per client.
  useEffect(() => {
    if (clickupListId || clientLists.length === 0) return;
    const delivery = clientLists.find(
      (l) => (l.custom_label ?? l.clickup_list_name)?.toLowerCase() === "delivery",
    );
    if (delivery) setClickupListId(delivery.clickup_list_id);
  }, [clientLists, clickupListId]);

  const clientName = clients.find((c) => c.id === clientId)?.name ?? "";
  const defaultName = clientName ? `${clientName} retainer` : "";
  const effectiveName = nameTouched ? name : defaultName;

  // Auto-derive the monthly hours target from the fee at the blended hourly
  // rate (Settings → blended_hourly_rate_zar, e.g. R1 150/h). The user can
  // override by typing in the hours field, which sticks until they clear it.
  const blendedRate = settings?.blended_hourly_rate_zar ?? 0;
  const feeNum = Number(monthlyFee) || 0;
  const autoHours = blendedRate > 0 && feeNum > 0 ? feeNum / blendedRate : 0;
  const effectiveHours = hoursTouched
    ? hoursTarget
    : autoHours
    ? autoHours.toFixed(2)
    : "";

  const pickedServiceIds = useMemo(
    () => new Set(rows.map((r) => r.service_id)),
    [rows],
  );

  const totalPointsPerMonth = useMemo(
    () =>
      rows.reduce(
        (sum, r) => sum + r.occurrences_per_month * r.points_per_occurrence,
        0,
      ),
    [rows],
  );

  const hasNoLists = !!clientId && !listsLoading && clientLists.length === 0;
  const step1Valid = !!clientId && !!clickupListId && effectiveName.trim().length > 0;
  const step2Valid = rows.length > 0 && rows.every(rowIsValid);

  function addServiceRow(serviceId: string) {
    setRows((prev) => [
      ...prev,
      {
        rowId: nextRowId(),
        service_id: serviceId,
        cadence: "monthly",
        occurrences_per_month: 1,
        points_per_occurrence: 1,
        default_assignees: [],
        is_live_eligible: false,
      },
    ]);
  }

  function patchRow(rowId: string, patch: Partial<ServiceRow>) {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));
  }

  function removeRow(rowId: string) {
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  }

  function toggleAssignee(rowId: string, memberId: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r;
        const has = r.default_assignees.includes(memberId);
        return {
          ...r,
          default_assignees: has
            ? r.default_assignees.filter((id) => id !== memberId)
            : [...r.default_assignees, memberId],
        };
      }),
    );
  }

  function importFromQuote(quoteId: string) {
    const q = clientQuotes.find((x) => x.id === quoteId);
    if (!q) return;
    // Only import lines whose service still exists in the catalogue — a deleted
    // service would fail the create-retainer FK insert.
    const validLines = q.lines.filter((l) => services.some((s) => s.id === l.service_id));
    const skipped = q.lines.length - validLines.length;

    setMonthlyFee((q.total_cents / 100).toString());
    setHoursTouched(false); // let hours re-derive from the imported fee
    setRows(
      validLines.map((l) => ({
        rowId: nextRowId(),
        service_id: l.service_id,
        cadence: "monthly" as Cadence,
        occurrences_per_month: Math.max(1, Math.round(l.qty)),
        points_per_occurrence: 1,
        default_assignees: [],
        is_live_eligible: false,
      })),
    );

    if (validLines.length === 0) {
      toast.warning("That quote has no importable services (none still in the catalogue).");
      return;
    }
    toast.success(
      `Imported ${validLines.length} service${validLines.length === 1 ? "" : "s"} from quote` +
        (skipped > 0 ? ` · ${skipped} skipped (no longer in catalogue)` : ""),
    );
  }

  async function handleInvoiceFile(file: File) {
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(file);
      });
      const lines = await parseInvoice.mutateAsync(dataUrl);
      // Keep only lines Claude matched to a service that still exists.
      const matched = lines.filter(
        (l) => l.suggested_service_id && services.some((s) => s.id === l.suggested_service_id),
      );
      const unmatched = lines.filter((l) => !matched.includes(l));
      const totalCents = lines.reduce((sum, l) => sum + (l.amount_cents || 0), 0);

      setMonthlyFee(totalCents > 0 ? (totalCents / 100).toString() : "");
      setHoursTouched(false);
      setRows(
        matched.map((l) => ({
          rowId: nextRowId(),
          service_id: l.suggested_service_id!,
          cadence: "monthly" as Cadence,
          occurrences_per_month: Math.max(1, Math.round(l.qty)),
          points_per_occurrence: 1,
          default_assignees: [],
          is_live_eligible: false,
        })),
      );

      if (matched.length === 0) {
        toast.warning(
          "Couldn't match any invoice lines to a service" +
            (unmatched.length ? `: ${unmatched.map((u) => u.description).join(", ")}` : "."),
        );
        return;
      }
      toast.success(
        `Imported ${matched.length} line${matched.length === 1 ? "" : "s"} from invoice` +
          (unmatched.length
            ? ` · ${unmatched.length} not matched (add manually): ${unmatched.map((u) => u.description).join(", ")}`
            : ""),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to read invoice");
    }
  }

  function handleCreate() {
    if (!step1Valid || !step2Valid) return;

    const body: CreateRetainerInput = {
      client_id: clientId,
      clickup_list_id: clickupListId,
      name: effectiveName.trim(),
      retainer_hours_target: Number(effectiveHours) || 0,
      retainer_monthly_fee_cents: Math.round((Number(monthlyFee) || 0) * 100),
      recurrence_start: recurrenceStart,
      services: rows.map((r) => ({
        service_id: r.service_id,
        cadence: r.cadence,
        occurrences_per_month: r.occurrences_per_month,
        points_per_occurrence: r.points_per_occurrence,
        default_assignees: r.default_assignees,
        is_live_eligible: r.is_live_eligible,
      })),
    };

    createRetainer.mutate(body, {
      onSuccess: (result) => {
        toast.success("Retainer created");
        if (result.provision_warning) {
          toast.warning(
            "Created, but first-period provisioning needs a retry: " + result.provision_warning,
          );
        }
        navigate(`/projects/${result.project_id}`);
      },
      onError: (err) => {
        toast.error(err instanceof Error ? err.message : "Failed to create retainer");
      },
    });
  }

  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? "(unknown service)";
  const memberName = (id: string) => team.find((m) => m.id === id)?.full_name ?? id;

  return (
    <div className="container mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New retainer</h1>
          <p className="text-sm text-muted-foreground">
            Set the monthly terms and recurring services. The current period provisions to ClickUp
            on save.
          </p>
        </div>
        <Stepper current={step} />
      </div>

      {step === "terms" && (
        <div className="space-y-5 rounded-md border border-m-outline-variant bg-m-surface p-5">
          <div className="space-y-1.5">
            <Label className="text-label-small text-m-on-surface-variant">Client</Label>
            <select
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                setClickupListId("");
                // Clear everything tied to the previous client so imported /
                // prefilled values never silently carry over to another client.
                setImportQuoteId("");
                setRows([]);
                setMonthlyFee("");
                setHoursTarget("");
                setHoursTouched(false);
              }}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Select a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {clientQuotes.length > 0 && (
            <div className="space-y-2 rounded-md border border-m-outline-variant bg-m-surface-container-low p-3">
              <Label className="text-label-small text-m-on-surface-variant">
                Start from an accepted quote (optional)
              </Label>
              <div className="flex items-center gap-2">
                <select
                  value={importQuoteId}
                  onChange={(e) => setImportQuoteId(e.target.value)}
                  className="h-9 flex-1 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="">Select a quote…</option>
                  {clientQuotes.map((q) => (
                    <option key={q.id} value={q.id}>
                      v{q.version} · {formatZar(q.total_cents)} · {q.lines.length} service
                      {q.lines.length === 1 ? "" : "s"}
                      {q.accepted_at ? ` · ${q.accepted_at.slice(0, 10)}` : ""}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!importQuoteId}
                  onClick={() => importFromQuote(importQuoteId)}
                >
                  Import
                </Button>
              </div>
              <p className="text-label-small text-m-on-surface-variant">
                Prefills the monthly fee and a recurring service per quote line. You set cadence,
                occurrences and assignees.
              </p>
            </div>
          )}

          <div className="space-y-2 rounded-md border border-m-outline-variant bg-m-surface-container-low p-3">
            <Label className="text-label-small text-m-on-surface-variant">
              Import from invoice (PDF)
            </Label>
            <input
              type="file"
              accept="application/pdf"
              disabled={parseInvoice.isPending}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleInvoiceFile(f);
                e.target.value = "";
              }}
              className="block w-full text-sm text-m-on-surface file:mr-3 file:rounded-md file:border-0 file:bg-m-primary file:px-3 file:py-1.5 file:text-label-small file:text-m-on-primary disabled:opacity-50"
            />
            <p className="text-label-small text-m-on-surface-variant">
              {parseInvoice.isPending
                ? "Reading invoice with AI…"
                : "Upload the client's monthly retainer invoice — each line becomes an editable row (cost → hours auto). Adjust before saving."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-label-small text-m-on-surface-variant">ClickUp list</Label>
            <select
              value={clickupListId}
              onChange={(e) => setClickupListId(e.target.value)}
              disabled={!clientId || hasNoLists}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-50"
            >
              <option value="">{clientId ? "Select a list…" : "Pick a client first"}</option>
              {clientLists.map((l) => (
                <option key={l.id} value={l.clickup_list_id}>
                  {l.custom_label ?? l.clickup_list_name}
                </option>
              ))}
            </select>
            {hasNoLists && (
              <p className="text-label-small text-m-error">
                This client has no ClickUp lists yet — sync structure first in{" "}
                <Link to={`/clients/${clientId}`} className="underline">
                  the client's settings
                </Link>
                .
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-label-small text-m-on-surface-variant">Retainer name</Label>
            <Input
              value={effectiveName}
              onChange={(e) => {
                setNameTouched(true);
                setName(e.target.value);
              }}
              placeholder="Acme retainer"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-label-small text-m-on-surface-variant">Start date</Label>
              <Input
                type="date"
                value={recurrenceStart}
                onChange={(e) => setRecurrenceStart(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-label-small text-m-on-surface-variant">
                Monthly hours target
              </Label>
              <Input
                type="number"
                min="0"
                step="0.5"
                value={effectiveHours}
                onChange={(e) => {
                  const v = e.target.value;
                  // Clearing the field reverts to the auto-derived value.
                  setHoursTouched(v.trim() !== "");
                  setHoursTarget(v);
                }}
                placeholder="0"
              />
              {!hoursTouched && autoHours > 0 && (
                <p className="text-label-small text-m-on-surface-variant">
                  Auto · fee ÷ {formatZar(Math.round(blendedRate * 100))}/h — edit to override
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-label-small text-m-on-surface-variant">
                Monthly fee (ZAR)
              </Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={monthlyFee}
                onChange={(e) => setMonthlyFee(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button onClick={() => setStep("services")} disabled={!step1Valid}>
              Next
            </Button>
          </div>
        </div>
      )}

      {step === "services" && (
        <div className="space-y-4">
          <div className="rounded-md border border-m-outline-variant bg-m-surface p-4">
            <ServicePicker
              excludeIds={pickedServiceIds}
              onPick={addServiceRow}
              placeholder="Search services to add a recurring row…"
            />
          </div>

          {rows.length === 0 ? (
            <div className="rounded-md border border-dashed border-m-outline-variant p-8 text-center text-sm text-muted-foreground">
              Add at least one recurring service to continue.
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((r) => {
                const valid = rowIsValid(r);
                return (
                  <div
                    key={r.rowId}
                    className="space-y-3 rounded-md border border-m-outline-variant bg-m-surface p-4"
                  >
                    <div className="flex items-start justify-between">
                      <div className="text-title-small">{serviceName(r.service_id)}</div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeRow(r.rowId)}
                        aria-label="Remove service"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-4 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-label-small text-m-on-surface-variant">Cadence</Label>
                        <select
                          value={r.cadence}
                          onChange={(e) =>
                            patchRow(r.rowId, { cadence: e.target.value as Cadence })
                          }
                          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                        >
                          {CADENCES.map((c) => (
                            <option key={c} value={c}>
                              {c.charAt(0).toUpperCase() + c.slice(1)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-label-small text-m-on-surface-variant">
                          Occurrences / month
                        </Label>
                        <Input
                          type="number"
                          min="1"
                          value={r.occurrences_per_month}
                          onChange={(e) =>
                            patchRow(r.rowId, {
                              occurrences_per_month: Number(e.target.value),
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-label-small text-m-on-surface-variant">
                          Points / occurrence
                        </Label>
                        <Input
                          type="number"
                          min="1"
                          value={r.points_per_occurrence}
                          onChange={(e) =>
                            patchRow(r.rowId, {
                              points_per_occurrence: Number(e.target.value),
                            })
                          }
                        />
                      </div>
                      <div className="flex items-end pb-1">
                        <label className="flex items-center gap-2 text-body-small text-m-on-surface">
                          <input
                            type="checkbox"
                            checked={r.is_live_eligible}
                            onChange={(e) =>
                              patchRow(r.rowId, { is_live_eligible: e.target.checked })
                            }
                          />
                          Live-eligible
                        </label>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-label-small text-m-on-surface-variant">
                        Default assignees (at least one)
                      </Label>
                      <div className="flex flex-wrap gap-2">
                        {team.map((m) => {
                          const selected = r.default_assignees.includes(m.id);
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => toggleAssignee(r.rowId, m.id)}
                              className={
                                "flex items-center gap-1 rounded-full border px-3 py-1 text-label-small transition-colors " +
                                (selected
                                  ? "border-m-primary bg-m-primary text-m-on-primary"
                                  : "border-m-outline-variant text-m-on-surface-variant hover:text-m-on-surface")
                              }
                            >
                              {selected && <Check className="h-3 w-3" />}
                              {m.full_name}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {!valid && (
                      <p className="text-label-small text-m-error">
                        Needs positive occurrences and points, and at least one assignee.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between rounded-md border border-m-outline-variant bg-m-surface-container-low px-4 py-3">
            <span className="text-body-small text-m-on-surface-variant">Total points / month</span>
            <span className="text-title-small tabular-nums">
              {totalPointsPerMonth}
              <span className="ml-2 text-label-small text-m-on-surface-variant">
                ≈ {(totalPointsPerMonth * 0.25).toFixed(2)} h
              </span>
            </span>
          </div>

          <div className="flex justify-between pt-1">
            <Button variant="secondary" onClick={() => setStep("terms")}>
              Back
            </Button>
            <Button onClick={() => setStep("review")} disabled={!step2Valid}>
              Review
            </Button>
          </div>
        </div>
      )}

      {step === "review" && (
        <div className="space-y-4">
          <div className="space-y-3 rounded-md border border-m-outline-variant bg-m-surface p-5">
            <div className="text-title-small">Terms</div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-body-small">
              <dt className="text-m-on-surface-variant">Client</dt>
              <dd>{clientName}</dd>
              <dt className="text-m-on-surface-variant">ClickUp list</dt>
              <dd>
                {clientLists.find((l) => l.clickup_list_id === clickupListId)?.custom_label ??
                  clientLists.find((l) => l.clickup_list_id === clickupListId)?.clickup_list_name ??
                  clickupListId}
              </dd>
              <dt className="text-m-on-surface-variant">Name</dt>
              <dd>{effectiveName}</dd>
              <dt className="text-m-on-surface-variant">Start date</dt>
              <dd>{recurrenceStart}</dd>
              <dt className="text-m-on-surface-variant">Monthly hours target</dt>
              <dd>{Number(effectiveHours) || 0}</dd>
              <dt className="text-m-on-surface-variant">Monthly fee</dt>
              <dd>{formatZar(Math.round((Number(monthlyFee) || 0) * 100))}</dd>
            </dl>
          </div>

          <div className="space-y-3 rounded-md border border-m-outline-variant bg-m-surface p-5">
            <div className="flex items-center justify-between">
              <div className="text-title-small">Recurring services</div>
              <span className="text-label-small text-m-on-surface-variant">
                {totalPointsPerMonth} pts / month
              </span>
            </div>
            <ul className="divide-y divide-m-outline-variant">
              {rows.map((r) => (
                <li key={r.rowId} className="py-2 text-body-small">
                  <div className="flex items-center justify-between">
                    <span className="text-m-on-surface">{serviceName(r.service_id)}</span>
                    <span className="text-m-on-surface-variant">
                      {r.cadence} · {r.occurrences_per_month}×/mo · {r.points_per_occurrence} pts
                      {r.is_live_eligible ? " · live" : ""}
                    </span>
                  </div>
                  <div className="mt-1 text-label-small text-m-on-surface-variant">
                    {r.default_assignees.map(memberName).join(", ")}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex justify-between pt-1">
            <Button variant="secondary" onClick={() => setStep("services")}>
              Back
            </Button>
            <Button onClick={handleCreate} disabled={createRetainer.isPending}>
              {createRetainer.isPending ? "Creating…" : "Create retainer"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
