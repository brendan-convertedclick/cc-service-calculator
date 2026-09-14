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
import { Checkbox } from "@/components/ui/checkbox";

// Who this client is. Everything that points at another system lives with
// that system further down the page: the domain with the sender rules, the
// folder and chat channel with ClickUp, the contact id and margin with Xero.
export function ClientDetailsPanel({ client }: { client: Client }) {
  const { save, isPending } = useSaveClient();
  const [name, setName] = useState(client.name);
  const [wikiPath, setWikiPath] = useState(client.wiki_path ?? "");
  const [isInternal, setIsInternal] = useState(client.is_internal ?? false);

  // Placeholder, never a value: showing the derivation as text would make an
  // untouched field read as dirty and write a path nobody chose.
  const wikiPlaceholder = `wiki/clients/${client.name
    .replace(/[^A-Za-z0-9]+/g, "-")
    .toLowerCase()}`;

  const patch = {
    name: name.trim(),
    wiki_path: wikiPath.trim() || null,
    is_internal: isInternal,
  };
  const dirty =
    patch.name !== client.name ||
    patch.wiki_path !== (client.wiki_path ?? null) ||
    patch.is_internal !== (client.is_internal ?? false);
  const nameEmpty = patch.name === "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
        <CardDescription>
          The name is what every brief, quote and sign-off email calls this
          client.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="client-name">Name</Label>
            <Input
              id="client-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="client-wiki">Wiki path</Label>
            <Input
              id="client-wiki"
              value={wikiPath}
              onChange={(e) => setWikiPath(e.target.value)}
              placeholder={wikiPlaceholder}
            />
          </div>
        </div>

        {/* Our own brands. Reporting keeps their fee but totals them apart
            from the client book, see the Retainers page. */}
        <label className="flex items-center gap-2 text-body-medium">
          <Checkbox
            checked={isInternal}
            onCheckedChange={(v) => setIsInternal(v === true)}
          />
          Internal work, not a paying client
        </label>

        <div className="flex items-center gap-3">
          <Button
            size="sm"
            disabled={!dirty || nameEmpty || isPending}
            onClick={() => save(client.id, patch)}
          >
            {isPending ? "Saving…" : "Save"}
          </Button>
          {nameEmpty && (
            <span className="text-body-small text-destructive">
              A client needs a name.
            </span>
          )}
          {dirty && !nameEmpty && (
            <span className="text-body-small text-m-on-surface-variant">
              Unsaved changes.
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
