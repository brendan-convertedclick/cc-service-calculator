import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Search, Shield, Trash2, X } from "lucide-react";
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
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { cn, cellField } from "@/lib/utils";
import { DetectedInboxButton } from "@/components/clients/DetectedInboxButton";
import { Checkbox } from "@/components/ui/checkbox";
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
    <div className="container mx-auto max-w-[1400px] p-6">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-headline-medium">Clients</h1>
          <p className="text-body-small text-m-on-surface-variant">
            {q && filtered.length !== clients.length ? (
              <>
                <span className="font-medium text-m-on-surface">{filtered.length}</span> of {clients.length} clients
              </>
            ) : (
              <>{clients.length} clients</>
            )}
            {" · "}Each maps to a ClickUp folder, so accepting a quote creates tasks in the right place.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DetectedInboxButton />
          <NewClientDialog folderOptions={folderOptions} disabled={!clientsSpaceConfigured} />
        </div>
      </div>

      {!clientsSpaceConfigured && (
        <div className="mb-4 rounded-xl border border-m-outline-variant bg-m-surface-container px-4 py-3 text-body-small text-m-on-surface">
          Configure a <strong className="font-medium">Clients space</strong> on the{" "}
          <Link to="/settings" className="font-medium text-primary hover:underline">
            Settings page
          </Link>{" "}
          before linking clients to ClickUp folders.
        </div>
      )}

      <div className="mb-4 relative min-w-[280px] max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-m-on-surface-variant" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or domain…"
          className="h-10 pl-9 pr-9"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {q
                ? "No clients match your search."
                : "No clients yet. Clients are created automatically when you log a new brief, or add one above."}
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="table-fixed text-sm" style={{ width: "1476px" }}>
              <colgroup>
                <col style={{ width: "240px" }} />
                <col style={{ width: "160px" }} />
                <col style={{ width: "240px" }} />
                <col style={{ width: "260px" }} />
                <col style={{ width: "100px" }} />
                <col style={{ width: "80px" }} />
                <col style={{ width: "180px" }} />
                <col style={{ width: "160px" }} />
                <col style={{ width: "56px" }} />
              </colgroup>
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="border-b px-4 py-2.5">Name</th>
                  <th className="border-b px-3 py-2.5">Primary domain</th>
                  <th className="border-b px-3 py-2.5">ClickUp folder</th>
                  <th className="border-b px-3 py-2.5">Wiki path</th>
                  <th className="border-b px-3 py-2.5 text-right">Margin target</th>
                  {/* Our own brands. Reporting keeps their fee but totals them
                      apart from the client book — see the Retainers page. */}
                  <th className="border-b px-3 py-2.5 text-center" title="Our own work, not a paying client">Internal</th>
                  <th className="border-b px-3 py-2.5">Xero Contact ID</th>
                  <th className="border-b px-3 py-2.5">Status</th>
                  <th className="border-b px-3 py-2.5"></th>
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
    <tr className="border-b transition-colors hover:bg-m-surface-container-low">
      <td className="px-2 py-1.5">
        <Input
          className={cellField}
          defaultValue={c.name}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== c.name) update.mutate({ id: c.id, patch: { name: v } });
          }}
        />
      </td>
      <td className="px-1 py-1.5">
        <Input
          className={cellField}
          defaultValue={c.primary_domain ?? ""}
          placeholder="example.co.za"
          onBlur={(e) => {
            const v = e.target.value.trim() || null;
            if (v !== c.primary_domain)
              update.mutate({ id: c.id, patch: { primary_domain: v } });
          }}
        />
      </td>
      <td className="px-1 py-1.5">
        {foldersError ? (
          <span className="px-2 text-xs text-destructive">
            Couldn't load folders — check Settings
          </span>
        ) : foldersLoading ? (
          <span className="px-2 text-xs text-muted-foreground">Loading…</span>
        ) : !clientsSpaceConfigured ? (
          <span className="px-2 text-xs text-muted-foreground">
            Configure Clients space first
          </span>
        ) : (
          <Combobox
            className={cellField}
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
            placeholder="Pick a folder…"
          />
        )}
      </td>
      <td className="px-1 py-1.5">
        <Input
          className={cellField}
          defaultValue={c.wiki_path ?? `wiki/clients/${c.name.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}`}
          placeholder="wiki/clients/…"
          onBlur={(e) => {
            const v = e.target.value.trim() || null;
            if (v !== c.wiki_path)
              update.mutate({ id: c.id, patch: { wiki_path: v } });
          }}
        />
      </td>
      <td className="px-1 py-1.5">
        <Input
          type="number"
          min="0"
          max="100"
          step="0.5"
          className={cn(cellField, "text-right")}
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
      <td className="px-1 py-1.5 text-center">
        <Checkbox
          aria-label={`${c.name} is internal work`}
          checked={c.is_internal ?? false}
          onCheckedChange={(v) =>
            update.mutate(
              { id: c.id, patch: { is_internal: v === true } },
              { onSuccess: () => toast.success("Saved") },
            )
          }
        />
      </td>
      <td className="px-1 py-1.5">
        <Input
          className={cn(cellField, "font-mono text-xs")}
          defaultValue={c.xero_contact_id ?? ""}
          placeholder="Xero UUID"
          onBlur={(e) => {
            const v = e.target.value.trim() || null;
            if (v !== c.xero_contact_id)
              update.mutate({ id: c.id, patch: { xero_contact_id: v } });
          }}
        />
      </td>
      <td className="px-3 py-1.5 text-xs">
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
      <td className="px-3 py-1.5">
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
