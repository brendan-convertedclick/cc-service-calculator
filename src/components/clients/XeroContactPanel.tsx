import { useState } from "react";
import { toast } from "sonner";
import { useUpdateClient } from "@/hooks/useClients";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function XeroContactPanel({
  clientId,
  xeroContactName,
}: {
  clientId: string;
  xeroContactName: string | null;
}) {
  const update = useUpdateClient();
  const [value, setValue] = useState(xeroContactName ?? "");

  const dirty = value.trim() !== (xeroContactName ?? "");

  function handleSave() {
    update.mutate(
      { id: clientId, patch: { xero_contact_name: value.trim() || null } },
      {
        onSuccess: () => toast.success("Saved"),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Xero contact name</CardTitle>
        <CardDescription>
          The exact Contact Name Xero uses for this client's invoices (often the
          full legal entity name, e.g. "Trellicor (PTY) LTD") — used to link
          synced Xero invoices back to this client. Check Xero's Contacts list
          if unsure.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. Trellicor (PTY) LTD"
          className="max-w-md"
        />
        <Button size="sm" disabled={!dirty || update.isPending} onClick={handleSave}>
          {update.isPending ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
