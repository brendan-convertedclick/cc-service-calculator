import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { cn, toggleInSet } from "@/lib/utils";
import type { FilterTree } from "@/hooks/useInboxFilterTree";

interface InboxFilterPanelProps {
  tree: FilterTree;
  activeClientId?: string | null;
  activeContactEmail?: string;
  onSelectAll: () => void;
  onSelectClient: (clientId: string) => void;
  onSelectContact: (clientId: string, email: string) => void;
  onSelectUnassigned: () => void;
}

export function InboxFilterPanel({
  tree,
  activeClientId,
  activeContactEmail,
  onSelectAll,
  onSelectClient,
  onSelectContact,
  onSelectUnassigned,
}: InboxFilterPanelProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();

  function toggleExpand(id: string) {
    setExpandedIds((prev) => toggleInSet(prev, id));
  }

  function handleSelectClient(clientId: string) {
    setExpandedIds(new Set([clientId]));
    onSelectClient(clientId);
  }

  const noneActive = activeClientId === undefined && activeContactEmail === undefined;
  const unassignedActive = activeClientId === null;

  const filteredClients = tree.clients.filter((client) => {
    if (!q) return true;
    if (client.name.toLowerCase().includes(q)) return true;
    return client.contacts.some((ct) => ct.email.toLowerCase().includes(q));
  });

  return (
    <div className="flex w-56 flex-shrink-0 flex-col border-r border-m-outline-variant">
      {/* Search on top */}
      <div className="p-4 pb-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-m-on-surface-variant" />
          <Input
            aria-label="Search clients"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8"
          />
        </div>
      </div>

      {/* Filter groups below the divider */}
      <div className="flex-1 space-y-0.5 overflow-y-auto px-4 pb-4">
        <p className="mb-1.5 text-label-medium font-medium text-m-on-surface-variant">Client</p>

        {/* All clients */}
        <button
          onClick={onSelectAll}
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-label-medium tracking-normal transition-colors",
            noneActive
              ? "bg-m-secondary-container text-m-on-secondary-container"
              : "text-m-on-surface hover:bg-m-surface-container",
          )}
        >
          <span className="truncate">All clients</span>
        </button>

        {/* Client rows */}
        {filteredClients.map((client) => {
          const isClientActive = activeClientId === client.id;
          const isExpanded = expandedIds.has(client.id) || q.length > 0;
          const clientMatches = client.name.toLowerCase().includes(q);
          const visibleContacts =
            q && !clientMatches
              ? client.contacts.filter((ct) => ct.email.toLowerCase().includes(q))
              : client.contacts;

          return (
            <div key={client.id}>
              {/* Client header row */}
              <div
                className={cn(
                  "flex items-center rounded-md transition-colors",
                  isClientActive
                    ? "bg-m-secondary-container text-m-on-secondary-container"
                    : "text-m-on-surface hover:bg-m-surface-container",
                )}
              >
                {/* Chevron — toggles expand only */}
                <button
                  onClick={() => toggleExpand(client.id)}
                  className="flex-shrink-0 py-1.5 pl-2 pr-0.5 text-m-on-surface-variant hover:text-m-on-surface"
                  aria-label={isExpanded ? "Collapse" : "Expand"}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>

                {/* Client name — filters */}
                <button
                  onClick={() => handleSelectClient(client.id)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 py-1.5 pr-2 text-left text-label-medium tracking-normal"
                >
                  <span className="truncate">{client.name}</span>
                  <span className="flex-shrink-0 tabular-nums text-label-small text-m-on-surface-variant">
                    {client.count}
                  </span>
                </button>
              </div>

              {/* Contact rows */}
              {isExpanded && visibleContacts.length > 0 && (
                <div className="space-y-0.5 py-0.5">
                  {visibleContacts.map((contact) => {
                    const isContactActive =
                      isClientActive && activeContactEmail === contact.email;
                    return (
                      <button
                        key={contact.email}
                        onClick={() => onSelectContact(client.id, contact.email)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-md py-1 pl-8 pr-2 text-left text-label-medium tracking-normal transition-colors",
                          isContactActive
                            ? "bg-m-secondary-container text-m-on-secondary-container"
                            : "text-m-on-surface-variant hover:bg-m-surface-container",
                        )}
                      >
                        <span className="min-w-0 truncate">{contact.email}</span>
                        <span className="flex-shrink-0 tabular-nums text-label-small text-m-on-surface-variant">
                          {contact.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Unassigned — pinned at bottom */}
      {tree.unassigned.count > 0 && (
        <button
          onClick={onSelectUnassigned}
          className={cn(
            "flex items-center gap-2 border-t border-m-outline-variant px-4 py-2.5 text-left text-label-medium tracking-normal transition-colors",
            unassignedActive ? "bg-destructive/15" : "hover:bg-destructive/10",
          )}
        >
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-destructive" />
          <span className="flex-1 font-medium text-destructive">Unassigned</span>
          <span className="tabular-nums text-label-small font-semibold text-destructive">
            {tree.unassigned.count}
          </span>
        </button>
      )}
    </div>
  );
}
