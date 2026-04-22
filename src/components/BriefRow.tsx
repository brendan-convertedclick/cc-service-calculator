import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { useUpdateBrief } from "@/hooks/useBriefs";
import { useClients, useCreateClient } from "@/hooks/useClients";
import { useCurrentUserName } from "@/hooks/useCurrentUserName";
import { needsInfoReply } from "@/content/email-templates";
import { mailto } from "@/lib/mailto";
import type { Database } from "@/types/db";

type Brief = Database["public"]["Tables"]["briefs"]["Row"];

export function BriefRow({ brief }: { brief: Brief }) {
  const navigate = useNavigate();
  const user = useCurrentUserName();
  const [expanded, setExpanded] = useState(false);
  const [clientId, setClientId] = useState<string | undefined>(brief.client_id ?? undefined);
  const [newClientName, setNewClientName] = useState("");
  const { data: clients = [] } = useClients();
  const createClient = useCreateClient();
  const update = useUpdateBrief();

  const clientName = clients.find((c) => c.id === brief.client_id)?.name;

  const accept = async () => {
    let cid = clientId;
    if (!cid && newClientName) {
      const c = await createClient.mutateAsync({ name: newClientName });
      cid = c.id;
    }
    if (!cid) {
      toast.error("Assign a client before accepting");
      return;
    }
    await update.mutateAsync({
      id: brief.id,
      patch: {
        client_id: cid,
        status: "triaged",
        triaged_by: user,
        triaged_at: new Date().toISOString(),
      },
    });
    navigate(`/briefs/${brief.id}/scope`);
  };

  const spam = async () => {
    const reason = window.prompt("Reason (optional):") ?? "";
    await update.mutateAsync({
      id: brief.id,
      patch: {
        status: "spam",
        rejection_reason: reason || null,
        triaged_by: user,
        triaged_at: new Date().toISOString(),
      },
    });
    toast.success("Moved to spam");
  };

  const needsInfo = async () => {
    if (!brief.sender_email) {
      toast.error("No sender email — edit brief first");
      return;
    }
    const { subject, body } = needsInfoReply(brief.raw_subject ?? "your request");
    window.location.href = mailto({ to: brief.sender_email, subject, body });
    await update.mutateAsync({
      id: brief.id,
      patch: {
        status: "needs_info",
        triaged_by: user,
        triaged_at: new Date().toISOString(),
      },
    });
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <button onClick={() => setExpanded(!expanded)} className="flex-1 text-left">
            <div className="text-title-small">{brief.raw_subject ?? "(no subject)"}</div>
            <div className="text-label-small text-m-on-surface-variant">
              {brief.sender_email ?? "manual"} · {new Date(brief.received_at).toLocaleString("en-ZA")}
            </div>
          </button>
          {brief.client_id ? (
            <Badge>Known: {clientName}</Badge>
          ) : (
            <Badge variant="secondary">Unknown sender</Badge>
          )}
        </div>

        {expanded && (
          <div className="mt-4 space-y-4">
            <pre className="whitespace-pre-wrap rounded-md bg-m-surface-container p-3 text-body-small">
              {brief.raw_body}
            </pre>

            {!brief.client_id && (
              <div className="space-y-2">
                <div className="text-label-large">Assign client</div>
                <Combobox
                  options={clients.map((c) => ({ value: c.id, label: c.name }))}
                  value={clientId ?? ""}
                  onChange={setClientId}
                  placeholder="Search existing clients…"
                />
                <Input
                  placeholder="Or create new client (name)"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                />
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={accept}>Accept</Button>
              <Button variant="secondary" onClick={needsInfo}>Needs info</Button>
              <Button variant="ghost" onClick={spam}>Spam</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
