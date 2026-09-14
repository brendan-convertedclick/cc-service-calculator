import { useState } from "react";
import { useSaveClient, type Client } from "@/hooks/useClients";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

// Everything about billing this client: the two Xero identifiers and the
// margin the work is priced to hit.
export function XeroContactPanel({ client }: { client: Client }) {
  const { save, isPending } = useSaveClient();
  const [name, setName] = useState(client.xero_contact_name ?? "");
  const [contactId, setContactId] = useState(client.xero_contact_id ?? "");
  const [margin, setMargin] = useState(String(client.margin_target_pct ?? 40));

  const marginNum = parseFloat(margin);
  const patch = {
    xero_contact_name: name.trim() || null,
    xero_contact_id: contactId.trim() || null,
    margin_target_pct: isNaN(marginNum) ? null : marginNum,
  };
  const dirty =
    patch.xero_contact_name !== (client.xero_contact_name ?? null) ||
    patch.xero_contact_id !== (client.xero_contact_id ?? null) ||
    patch.margin_target_pct !== (client.margin_target_pct ?? null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Xero and margin</CardTitle>
        <CardDescription>
          The contact name is the exact one Xero uses on this client's invoices,
          often the full legal entity such as "Trellicor (PTY) LTD". It is what
          links a synced Xero invoice back to this client, so check Xero's
          Contacts list if you are unsure.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="xero-name">Contact name</Label>
            <Input
              id="xero-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Trellicor (PTY) LTD"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="xero-id">Contact ID</Label>
            <Input
              id="xero-id"
              className="font-mono text-xs"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              placeholder="Xero UUID"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="client-margin">Margin target %</Label>
            <Input
              id="client-margin"
              type="number"
              min="0"
              max="100"
              step="0.5"
              className="max-w-[10rem]"
              value={margin}
              onChange={(e) => setMargin(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            disabled={!dirty || isPending}
            onClick={() => save(client.id, patch)}
          >
            {isPending ? "Saving…" : "Save"}
          </Button>
          {dirty && (
            <span className="text-body-small text-m-on-surface-variant">
              Unsaved changes.
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
