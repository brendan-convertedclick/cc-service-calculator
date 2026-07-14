import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  useCreateService,
  useDeleteService,
  useService,
  useUpdateService,
} from "@/hooks/useServices";
import { useRules } from "@/hooks/useRules";
import { useTeam } from "@/hooks/useTeam";
import { ProcessFlow } from "@/components/ProcessFlow";
import { IncludedServices } from "@/components/IncludedServices";
import { ClaudePromptPanel } from "@/components/ClaudePromptPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatZar } from "@/lib/utils";
import type { ClaudePrompt } from "@/types/claude";

interface Props {
  mode: "new" | "edit";
}

export function ServiceDetail({ mode }: Props) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: rules = [] } = useRules();
  const { data: team = [] } = useTeam();
  const { data: detail } = useService(mode === "edit" ? id : undefined);
  const create = useCreateService();
  const update = useUpdateService();
  const remove = useDeleteService();

  const [form, setForm] = useState({
    code: "",
    name: "",
    sell_price_cents: 0,
    pricing_model: "fixed",
    unit_of_sale: "",
    percentage_value: null as number | null,
    rule_id: null as string | null,
    clickup_work_stream: null as string | null,
    primary_team_member_id: null as string | null,
    scope_definition: "",
    included_revisions: "",
    trigger_to_start: "",
    completion_definition: "",
    status: "active",
    notes: "",
    default_due_days: null as number | null,
  });

  useEffect(() => {
    if (detail?.service) {
      const s = detail.service;
      setForm({
        code: s.code ?? "",
        name: s.name,
        sell_price_cents: s.sell_price_cents,
        pricing_model: s.pricing_model,
        unit_of_sale: s.unit_of_sale ?? "",
        percentage_value: s.percentage_value,
        rule_id: s.rule_id,
        clickup_work_stream: s.clickup_work_stream,
        primary_team_member_id: s.primary_team_member_id,
        scope_definition: s.scope_definition ?? "",
        included_revisions: s.included_revisions ?? "",
        trigger_to_start: s.trigger_to_start ?? "",
        completion_definition: s.completion_definition ?? "",
        status: s.status,
        notes: s.notes ?? "",
        default_due_days: s.default_due_days,
      });
    }
    // Only re-seed the form when the underlying service identity changes.
    // Depending on `detail` itself would reset the form on every background
    // refetch (new object identity), clobbering in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.service?.id]);

  function onSave() {
    const payload = {
      code: form.code.trim() || null,
      name: form.name.trim(),
      sell_price_cents: form.sell_price_cents,
      pricing_model: form.pricing_model,
      unit_of_sale: form.unit_of_sale || null,
      percentage_value:
        form.pricing_model === "percentage" ? form.percentage_value : null,
      rule_id: form.rule_id,
      clickup_work_stream: form.clickup_work_stream || null,
      primary_team_member_id: form.primary_team_member_id,
      scope_definition: form.scope_definition || null,
      included_revisions: form.included_revisions || null,
      trigger_to_start: form.trigger_to_start || null,
      completion_definition: form.completion_definition || null,
      status: form.status,
      notes: form.notes || null,
      default_due_days: form.default_due_days,
    };

    if (mode === "new") {
      create.mutate(payload, {
        onSuccess: (s) => {
          toast.success("Service created");
          navigate(`/services/${s.id}`, { replace: true });
        },
        onError: (e: Error) => toast.error(e.message),
      });
    } else if (id) {
      update.mutate(
        { id, patch: payload },
        {
          onSuccess: () => toast.success("Service saved"),
          onError: (e: Error) => toast.error(e.message),
        },
      );
    }
  }

  const ROLE = `You are the Converted Click operations assistant working in Claude Code.`;
  const MCP_NOTE = `You have access to the conductor MCP tools: find-client, get-active-projects, get-active-retainer, list-briefs, get-brief, create-brief.`;

  const servicePrompts: ClaudePrompt[] =
    mode === "edit" && form.name
      ? [
          {
            id: "process-steps",
            label: "Process steps",
            build: () => `${ROLE}

Context:
Service name: ${form.name}
Pricing model: ${form.pricing_model}
Unit of sale: ${form.unit_of_sale || "(not set)"}
Scope definition: ${form.scope_definition || "(not set)"}
Trigger to start: ${form.trigger_to_start || "(not set)"}
Completion definition: ${form.completion_definition || "(not set)"}
Default due days: ${form.default_due_days ?? "(not set)"}

${MCP_NOTE}

Action: Generate a numbered process step list (5–10 steps) for delivering this service. Each step should include: step number, action title, responsible role, estimated time, and done-when criteria. Steps should flow from client briefing through to delivery sign-off.

Output: A numbered markdown list of process steps, suitable for pasting into the service record's process_steps field.`,
          },
        ]
      : [];

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-auto">
        <div className="container mx-auto max-w-5xl p-6">
          <Button variant="ghost" size="sm" asChild className="mb-4">
            <Link to="/services">
              <ArrowLeft className="h-4 w-4" /> Services
            </Link>
          </Button>

          <div className="mb-6 flex items-end justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {mode === "new" ? "New service" : form.name}
              </h1>
              {mode === "edit" && form.code && (
                <p className="text-sm text-muted-foreground font-mono">
                  Code {form.code}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {mode === "edit" && id && (
                <Button
                  variant="outline"
                  onClick={() => {
                    if (
                      confirm(`Delete ${form.name}? This cannot be undone.`)
                    ) {
                      remove.mutate(id, {
                        onSuccess: () => {
                          toast.success("Deleted");
                          navigate("/services", { replace: true });
                        },
                        onError: (e: Error) => toast.error(e.message),
                      });
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </Button>
              )}
              <Button onClick={onSave} disabled={!form.name.trim()}>
                <Save className="h-4 w-4" /> Save
              </Button>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-[2fr_3fr]">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Basics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input
                      value={form.name}
                      onChange={(e) =>
                        setForm({ ...form, name: e.target.value })
                      }
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Code</Label>
                      <Input
                        value={form.code}
                        onChange={(e) =>
                          setForm({ ...form, code: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Status</Label>
                      <select
                        value={form.status}
                        onChange={(e) =>
                          setForm({ ...form, status: e.target.value })
                        }
                        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                      >
                        <option value="active">Active</option>
                        <option value="draft">Draft</option>
                        <option value="archived">Archived</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Pricing model</Label>
                      <select
                        value={form.pricing_model}
                        onChange={(e) =>
                          setForm({ ...form, pricing_model: e.target.value })
                        }
                        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                      >
                        <option value="fixed">Fixed</option>
                        <option value="hourly">Hourly</option>
                        <option value="percentage">Percentage</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Unit of sale</Label>
                      <Input
                        value={form.unit_of_sale}
                        onChange={(e) =>
                          setForm({ ...form, unit_of_sale: e.target.value })
                        }
                        placeholder="Per page, Per hour…"
                      />
                    </div>
                  </div>
                  {form.pricing_model === "percentage" ? (
                    <div className="space-y-2">
                      <Label>Percentage</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={form.percentage_value ?? ""}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            percentage_value:
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          })
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Fee over spend. Hour allocation doesn't apply.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label>Sell price (ZAR)</Label>
                      <Input
                        type="number"
                        value={(form.sell_price_cents / 100).toString()}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            sell_price_cents: Math.round(
                              Number(e.target.value) * 100,
                            ),
                          })
                        }
                      />
                      <p className="text-xs text-muted-foreground font-mono tabular-nums">
                        {formatZar(form.sell_price_cents)}
                      </p>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Rule</Label>
                    <select
                      value={form.rule_id ?? ""}
                      onChange={(e) =>
                        setForm({ ...form, rule_id: e.target.value || null })
                      }
                      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="">— custom allocation only</option>
                      {rules.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>ClickUp Work Stream</Label>
                    <select
                      value={form.clickup_work_stream ?? ""}
                      onChange={(e) =>
                        setForm({ ...form, clickup_work_stream: e.target.value || null })
                      }
                      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="">— derive from department —</option>
                      {[
                        "New Business", "Creative", "3D", "Development", "Social Media",
                        "Content", "SEO", "Paid Media", "Admin", "Strategy",
                        "Internal Meeting", "Project Meeting", "Client Meeting", "Technical",
                        "Project Management", "Software", "Client Sign Off", "AI",
                      ].map((w) => (
                        <option key={w} value={w}>{w}</option>
                      ))}
                    </select>
                    <p className="text-label-small text-m-on-surface-variant">
                      Overrides the department-derived Work Stream on ClickUp tasks (for meeting / admin / sign-off services).
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Primary team member</Label>
                    <select
                      value={form.primary_team_member_id ?? ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          primary_team_member_id: e.target.value || null,
                        })
                      }
                      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="">—</option>
                      {team.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.full_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>Default due days</Label>
                    <Input
                      type="number"
                      value={form.default_due_days ?? ""}
                      placeholder="—"
                      onChange={(e) =>
                        setForm({
                          ...form,
                          default_due_days:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Days from push date to ClickUp task due date
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Scope of work</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(
                    [
                      "scope_definition",
                      "included_revisions",
                      "trigger_to_start",
                      "completion_definition",
                      "notes",
                    ] as const
                  ).map((field) => (
                    <div key={field} className="space-y-2">
                      <Label className="capitalize">
                        {field.replaceAll("_", " ")}
                      </Label>
                      <Textarea
                        value={form[field]}
                        onChange={(e) =>
                          setForm({ ...form, [field]: e.target.value })
                        }
                        rows={2}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              {mode === "edit" && id ? (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle>Includes these services</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <IncludedServices serviceId={id} />
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle>Process flow</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ProcessFlow
                        serviceId={id}
                        priceCents={form.sell_price_cents}
                        pricingModel={form.pricing_model}
                        ruleId={form.rule_id}
                      />
                    </CardContent>
                  </Card>
                </>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>Process flow</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Save the service first, then add process steps here.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>
      <aside className="w-[200px] shrink-0 border-l border-m-outline-variant bg-m-surface">
        <ClaudePromptPanel prompts={servicePrompts} />
      </aside>
    </div>
  );
}
