import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Search, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  useClients,
  useUpdateClient,
  useArchiveClient,
  useClickUpFolders,
  type Client,
} from "@/hooks/useClients";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { DetectedInboxButton } from "@/components/clients/DetectedInboxButton";
import { NewClientDialog, UNLINKED } from "@/components/clients/NewClientDialog";

export function Clients() {
  const { data: clients = [], isLoading } = useClients();
  const { data: settings } = useSettings();
  const { data: folders, isLoading: foldersLoading, error: foldersError } =
    useClickUpFolders();
  const update = useUpdateClient();
  const archive = useArchiveClient();
  const [q, setQ] = useState("");

  const clientsSpaceConfigured = !!settings?.clickup_clients_space_id;
  const folderOptions = [
    { value: UNLINKED, label: "— Unlinked —" },
    ...(folders ?? []).map((f) => ({ value: f.id, label: f.name })),
  ];
  const folderNameById = new Map((folders ?? []).map((f) => [f.id, f.name]));

  const filtered = q
    ? clients.filter((c) =>
        `${c.name} ${c.primary_domain ?? ""}`.toLowerCase().includes(q.toLowerCase()),
      )
    : clients;

  return (
    <div className="w-full p-6">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground">
            The companies you do work for. Each client maps to a ClickUp folder so
            quote acceptance creates tasks in the right place.
          </p>
        </div>
        <NewClientDialog folderOptions={folderOptions} disabled={!clientsSpaceConfigured} />
      </div>

      {!clientsSpaceConfigured && (
        <Card className="mb-4">
          <CardContent className="py-4 text-sm">
            Configure a <strong>Clients space</strong> on the{" "}
            <Link to="/settings" className="underline">
              Settings page
            </Link>{" "}
            before linking clients to ClickUp folders.
          </CardContent>
        </Card>
      )}

      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name or domain..."
              className="pl-9"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>All clients</CardTitle>
          <DetectedInboxButton />
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {q
                ? "No clients match your search."
                : "No clients yet. Clients are created automatically when you log a new brief, or add one above."}
            </p>
          ) : (
            <div className="overflow-x-auto">
            <table className="text-sm table-fixed" style={{ width: "1396px" }}>
              <colgroup>
                <col style={{ width: "240px" }} />
                <col style={{ width: "160px" }} />
                <col style={{ width: "240px" }} />
                <col style={{ width: "260px" }} />
                <col style={{ width: "100px" }} />
                <col style={{ width: "180px" }} />
                <col style={{ width: "160px" }} />
                <col style={{ width: "56px" }} />
              </colgroup>
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Name</th>
                  <th className="py-2 pl-2">Primary domain</th>
                  <th className="py-2 pl-2">ClickUp folder</th>
                  <th className="py-2 pl-2">Wiki path</th>
                  <th className="py-2 pl-2">Margin target</th>
                  <th className="py-2 pl-2">Xero Contact ID</th>
                  <th className="py-2 pl-2">Status</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <ClientRow
                    key={c.id}
                    client={c}
                    update={update}
                    archive={archive}
                    folderOptions={folderOptions}
                    folderNameById={folderNameById}
                    foldersLoading={foldersLoading}
                    foldersError={foldersError}
                    clientsSpaceConfigured={clientsSpaceConfigured}
                  />
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

function ClientRow({
  client: c,
  update,
  archive,
  folderOptions,
  folderNameById,
  foldersLoading,
  foldersError,
  clientsSpaceConfigured,
}: {
  client: Client;
  update: ReturnType<typeof useUpdateClient>;
  archive: ReturnType<typeof useArchiveClient>;
  folderOptions: Array<{ value: string; label: string }>;
  folderNameById: Map<string, string>;
  foldersLoading: boolean;
  foldersError: Error | null;
  clientsSpaceConfigured: boolean;
}) {
  return (
    <tr className="border-b">
      <td className="py-3 pr-2">
        <Input
          defaultValue={c.name}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== c.name) update.mutate({ id: c.id, patch: { name: v } });
          }}
        />
      </td>
      <td className="py-3 pl-2 pr-2">
        <Input
          defaultValue={c.primary_domain ?? ""}
          placeholder="example.co.za"
          onBlur={(e) => {
            const v = e.target.value.trim() || null;
            if (v !== c.primary_domain)
              update.mutate({ id: c.id, patch: { primary_domain: v } });
          }}
        />
      </td>
      <td className="py-3 pl-2 pr-2">
        {foldersError ? (
          <span className="text-xs text-destructive">
            Couldn't load folders — check Settings
          </span>
        ) : foldersLoading ? (
          <span className="text-xs text-muted-foreground">Loading...</span>
        ) : !clientsSpaceConfigured ? (
          <span className="text-xs text-muted-foreground">
            Configure Clients space first
          </span>
        ) : (
          <Combobox
            options={folderOptions}
            value={c.clickup_folder_id ?? UNLINKED}
            onChange={(v) => {
              const next = v === UNLINKED ? null : v;
              if (next !== c.clickup_folder_id)
                update.mutate(
                  { id: c.id, patch: { clickup_folder_id: next } },
                  { onSuccess: () => toast.success("Saved") },
                );
            }}
            placeholder="Pick a folder..."
          />
        )}
      </td>
      <td className="py-3 pl-2 pr-2">
        <Input
          defaultValue={c.wiki_path ?? `wiki/clients/${c.name.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}`}
          placeholder="wiki/clients/..."
          onBlur={(e) => {
            const v = e.target.value.trim() || null;
            if (v !== c.wiki_path)
              update.mutate({ id: c.id, patch: { wiki_path: v } });
          }}
        />
      </td>
      <td className="py-3 pl-2 pr-2">
        <Input
          type="number"
          min="0"
          max="100"
          step="0.5"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          defaultValue={(c as any).margin_target_pct ?? 40}
          onBlur={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              update.mutate({ id: c.id, patch: { margin_target_pct: v as any } });
            }
          }}
        />
      </td>
      <td className="py-3 pl-2 pr-2">
        <Input
          defaultValue={c.xero_contact_id ?? ""}
          placeholder="Xero UUID"
          onBlur={(e) => {
            const v = e.target.value.trim() || null;
            if (v !== c.xero_contact_id)
              update.mutate({ id: c.id, patch: { xero_contact_id: v } });
          }}
        />
      </td>
      <td className="py-3 pl-2 text-xs">
        {c.clickup_folder_id ? (
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
            <span>
              Linked
              {folderNameById.get(c.clickup_folder_id)
                ? ` to ${folderNameById.get(c.clickup_folder_id)}`
                : ""}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">Unlinked</span>
        )}
      </td>
      <td className="py-3 pl-2">
        <div className="flex items-center gap-1">
          <Link
            to={`/clients/${c.id}`}
            title="Sender rules"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-gradient-gold text-white shadow-elev-1 transition hover:brightness-110 hover:shadow-elev-2 active:brightness-95"
          >
            <Shield className="h-4 w-4" />
          </Link>
          <Button
            variant="ghost"
            size="icon"
            title="Archive"
            onClick={() => {
              if (confirm(`Archive "${c.name}"?`)) {
                archive.mutate(c.id, {
                  onSuccess: () => toast.success(`Archived ${c.name}`),
                  onError: (e) => toast.error(e.message),
                });
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </td>
    </tr>
  );
}
