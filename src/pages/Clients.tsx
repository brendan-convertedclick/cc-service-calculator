import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  useClients,
  useArchiveClient,
  useClickUpFolders,
  type Client,
} from "@/hooks/useClients";
import { useSettings } from "@/hooks/useSettings";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DetectedInboxButton } from "@/components/clients/DetectedInboxButton";
import { NewClientDialog, UNLINKED } from "@/components/clients/NewClientDialog";

export function Clients() {
  const { data: clients = [], isLoading } = useClients();
  const { data: settings } = useSettings();
  const { data: folders } = useClickUpFolders();
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
            {" · "}Each maps to a ClickUp folder, so accepting a quote creates tasks in the right place. Open a client to edit it.
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
                    archive={archive}
                    folderNameById={folderNameById}
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

// Read-only. Every field here is edited on the client's own page, which is
// where the ClickUp folder carries the warning about re-routing future work.
// The row used to be a line of inputs saving on blur, so tabbing across it
// committed whatever you had half-typed.
function ClientRow({
  client: c,
  archive,
  folderNameById,
}: {
  client: Client;
  archive: ReturnType<typeof useArchiveClient>;
  folderNameById: Map<string, string>;
}) {
  const navigate = useNavigate();
  const folderName = c.clickup_folder_id
    ? folderNameById.get(c.clickup_folder_id)
    : null;
  const muted = "text-muted-foreground";
  return (
    <tr
      onClick={() => navigate(`/clients/${c.id}`)}
      className="cursor-pointer border-b transition-colors hover:bg-m-surface-container-low"
    >
      <td className="truncate px-4 py-2.5">
        {/* The row navigates, but the name stays a real link so the page is
            reachable by keyboard and openable in a new tab. */}
        <Link
          to={`/clients/${c.id}`}
          onClick={(e) => e.stopPropagation()}
          className="font-medium hover:underline"
        >
          {c.name}
        </Link>
      </td>
      <td className={cn("truncate px-3 py-2.5", !c.primary_domain && muted)}>
        {c.primary_domain ?? "Not set"}
      </td>
      <td className={cn("truncate px-3 py-2.5", !c.clickup_folder_id && muted)}>
        {folderName ?? (c.clickup_folder_id ? c.clickup_folder_id : "Unlinked")}
      </td>
      <td className={cn("truncate px-3 py-2.5", !c.wiki_path && muted)}>
        {c.wiki_path ?? "Not set"}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {c.margin_target_pct ?? 40}
      </td>
      <td className="px-3 py-2.5 text-center">
        {c.is_internal ? (
          <Check className="mx-auto h-4 w-4" strokeWidth={3} />
        ) : (
          <span className="sr-only">No</span>
        )}
      </td>
      <td
        className={cn(
          "truncate px-3 py-2.5 font-mono text-xs",
          !c.xero_contact_id && muted,
        )}
      >
        {c.xero_contact_id ?? "Not set"}
      </td>
      <td className="px-3 py-2.5 text-xs">
        {c.clickup_folder_id ? (
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
            <span>Linked{folderName ? ` to ${folderName}` : ""}</span>
          </span>
        ) : (
          <span className={muted}>Unlinked</span>
        )}
      </td>
      <td className="px-3 py-1.5">
        <Button
          variant="ghost"
          size="icon"
          title="Archive"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Archive "${c.name}"?`)) {
              archive.mutate(c.id, {
                onSuccess: () => toast.success(`Archived ${c.name}`),
                onError: (err) => toast.error(err.message),
              });
            }
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </td>
    </tr>
  );
}
