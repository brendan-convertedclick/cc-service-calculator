import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Check, X } from "lucide-react";
import { useSaveClient } from "@/hooks/useClients";
import {
  useSenderRules,
  usePendingSenders,
  useUpsertSenderRule,
  useDeleteSenderRule,
  useResolvePendingSender,
  type SenderRule,
} from "@/hooks/useSenderRules";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PanelSection } from "@/components/clients/PanelSection";
import { RetroCleanupDialog } from "./RetroCleanupDialog";

export function SenderRulesPanel({
  clientId,
  primaryDomain,
}: {
  clientId: string;
  primaryDomain: string | null;
}) {
  const { data: rules = [] } = useSenderRules(clientId);
  const { data: pending = [] } = usePendingSenders(clientId);
  const upsert = useUpsertSenderRule();
  const del = useDeleteSenderRule();
  const resolve = useResolvePendingSender();

  const [draftAllow, setDraftAllow] = useState("");
  const [draftBlock, setDraftBlock] = useState("");
  const [retroPattern, setRetroPattern] = useState<string | null>(null);

  const allow = rules.filter((r) => r.mode === "allow");
  const blocked = rules.filter((r) => r.mode === "block");

  const add = (pattern: string, mode: "allow" | "block") => {
    const v = pattern.trim().toLowerCase();
    if (!v) return;
    if (!v.includes("@")) {
      toast.error("Pattern must be an email or *@domain");
      return;
    }
    upsert.mutate(
      { client_id: clientId, pattern: v, mode },
      {
        onSuccess: () => {
          toast.success(`${mode === "allow" ? "Allowed" : "Blocked"} ${v}`);
          if (mode === "allow") {
            setDraftAllow("");
          } else {
            setDraftBlock("");
            setRetroPattern(v);
          }
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  return (
    <>
      {/* The domain lives here rather than in a details card because it is the
          first sender rule: everything at it counts as business until a rule
          below says otherwise. */}
      <PrimaryDomainSection clientId={clientId} primaryDomain={primaryDomain} />

      <RuleList
        title="Allowed"
        description={
          primaryDomain ? (
            <>
              Every sender at <code>@{primaryDomain}</code> counts as business
              already. Add an allow rule only to narrow that to named people.
            </>
          ) : undefined
        }
        emptyHint="No allow rules — all senders on this domain count as business."
        rules={allow}
        onDelete={(r) => del.mutate({ id: r.id, client_id: clientId })}
        draft={draftAllow}
        setDraft={setDraftAllow}
        onAdd={() => add(draftAllow, "allow")}
        placeholder="*@example.co.za or someone@…"
      />

      <RuleList
        title="Blocked"
        description="Blocklist beats allowlist, so an address here is ignored however else it matches."
        emptyHint="No block rules yet."
        rules={blocked}
        onDelete={(r) => del.mutate({ id: r.id, client_id: clientId })}
        draft={draftBlock}
        setDraft={setDraftBlock}
        onAdd={() => add(draftBlock, "block")}
        placeholder="someone@example.co.za"
      />

      <PanelSection title="Pending approval">
        <div>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No senders waiting for review.
            </p>
          ) : (
            <ul className="divide-y">
              {pending.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <div>
                    <div className="font-medium">{p.email}</div>
                    {p.sample_subject && (
                      <div className="text-xs text-muted-foreground">
                        {p.sample_subject}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        resolve.mutate({ pending: p, action: "allow" })
                      }
                    >
                      <Check className="h-3 w-3" /> Allow
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        resolve.mutate(
                          { pending: p, action: "block" },
                          {
                            onSuccess: () => setRetroPattern(p.email),
                          },
                        );
                      }}
                    >
                      <X className="h-3 w-3" /> Block
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PanelSection>

      <RetroCleanupDialog
        clientId={clientId}
        pattern={retroPattern ?? ""}
        open={!!retroPattern}
        onClose={() => setRetroPattern(null)}
      />
    </>
  );
}

function RuleList({
  title,
  description,
  emptyHint,
  rules,
  onDelete,
  draft,
  setDraft,
  onAdd,
  placeholder,
}: {
  title: string;
  description?: ReactNode;
  emptyHint: string;
  rules: SenderRule[];
  onDelete: (r: SenderRule) => void;
  draft: string;
  setDraft: (v: string) => void;
  onAdd: () => void;
  placeholder: string;
}) {
  return (
    <PanelSection title={title} description={description}>
      <div className="space-y-3">
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyHint}</p>
        ) : (
          <ul className="divide-y">
            {rules.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between py-2 text-sm"
              >
                <code>{r.pattern}</code>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => onDelete(r)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (e.key === "Enter") onAdd();
            }}
          />
          <Button onClick={onAdd}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </div>
    </PanelSection>
  );
}

function PrimaryDomainSection({
  clientId,
  primaryDomain,
}: {
  clientId: string;
  primaryDomain: string | null;
}) {
  const { save, isPending } = useSaveClient();
  const [value, setValue] = useState(primaryDomain ?? "");
  const next = value.trim().toLowerCase() || null;
  const dirty = next !== primaryDomain;

  return (
    <PanelSection
      title="Primary domain"
      description="Inbound mail from this domain is attributed to this client. Leave it unset and nothing from them reaches the inbox."
    >
      <div className="flex items-center gap-3">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="example.co.za"
          className="max-w-md"
        />
        <Button
          size="sm"
          disabled={!dirty || isPending}
          onClick={() => save(clientId, { primary_domain: next })}
        >
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </PanelSection>
  );
}
