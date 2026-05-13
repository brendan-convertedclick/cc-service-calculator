import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Check, X } from "lucide-react";
import {
  useSenderRules,
  usePendingSenders,
  useUpsertSenderRule,
  useDeleteSenderRule,
  useResolvePendingSender,
  type SenderRule,
} from "@/hooks/useSenderRules";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
    <div className="space-y-4">
      {primaryDomain && (
        <p className="text-xs text-muted-foreground">
          All senders at <code>@{primaryDomain}</code> are accepted by default.
          Add allow rules to restrict, or block rules to exclude specific
          addresses. Blocklist beats allowlist.
        </p>
      )}

      <RuleList
        title="Allowed"
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
        emptyHint="No block rules yet."
        rules={blocked}
        onDelete={(r) => del.mutate({ id: r.id, client_id: clientId })}
        draft={draftBlock}
        setDraft={setDraftBlock}
        onAdd={() => add(draftBlock, "block")}
        placeholder="someone@example.co.za"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pending approval</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <RetroCleanupDialog
        clientId={clientId}
        pattern={retroPattern ?? ""}
        open={!!retroPattern}
        onClose={() => setRetroPattern(null)}
      />
    </div>
  );
}

function RuleList({
  title,
  emptyHint,
  rules,
  onDelete,
  draft,
  setDraft,
  onAdd,
  placeholder,
}: {
  title: string;
  emptyHint: string;
  rules: SenderRule[];
  onDelete: (r: SenderRule) => void;
  draft: string;
  setDraft: (v: string) => void;
  onAdd: () => void;
  placeholder: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
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
      </CardContent>
    </Card>
  );
}
