import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
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

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function handleSelectClient(clientId: string) {
    setExpandedIds(new Set([clientId]));
    onSelectClient(clientId);
  }

  const noneActive = activeClientId === undefined && activeContactEmail === undefined;
  const unassignedActive = activeClientId === null;

  return (
    <div className="flex w-48 flex-shrink-0 flex-col border-r border-m-outline-variant bg-[#f7f7fb]">
      <div className="px-3 pb-2 pt-3.5 text-[10px] font-bold uppercase tracking-[0.6px] text-m-on-surface-variant">
        Filter by client
      </div>

      {/* All clients */}
      <button
        onClick={onSelectAll}
        className={`px-3 py-1.5 text-left text-xs transition-colors hover:bg-m-surface-container-high ${
          noneActive ? "font-semibold text-m-primary" : "text-m-on-surface-variant"
        }`}
      >
        All clients
      </button>

      {/* Client rows */}
      <div className="flex-1 overflow-y-auto">
        {tree.clients.map((client) => {
          const isClientActive = activeClientId === client.id;
          const isExpanded = expandedIds.has(client.id);

          return (
            <div key={client.id} className="mt-0.5">
              {/* Client header row */}
              <div
                className={`flex items-center gap-1.5 border-l-2 transition-colors ${
                  isClientActive
                    ? "border-m-primary bg-m-primary-container/30"
                    : "border-transparent"
                }`}
              >
                {/* Chevron — toggles expand only */}
                <button
                  onClick={() => toggleExpand(client.id)}
                  className="flex-shrink-0 pl-2 pr-0.5 py-1.5 text-m-on-surface-variant hover:text-m-on-surface"
                  aria-label={isExpanded ? "Collapse" : "Expand"}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </button>

                {/* Client name — filters */}
                <button
                  onClick={() => handleSelectClient(client.id)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 py-1.5 pr-3 text-left"
                >
                  <span
                    className={`truncate text-xs ${
                      isClientActive ? "font-semibold text-m-on-surface" : "text-m-on-surface-variant"
                    }`}
                  >
                    {client.name}
                  </span>
                  <span
                    className={`flex-shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold ${
                      isClientActive
                        ? "bg-gradient-brand text-white"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {client.count}
                  </span>
                </button>
              </div>

              {/* Contact rows */}
              {isExpanded && client.contacts.length > 0 && (
                <div className="pb-1">
                  {client.contacts.map((contact) => {
                    const isContactActive =
                      isClientActive && activeContactEmail === contact.email;
                    return (
                      <button
                        key={contact.email}
                        onClick={() => onSelectContact(client.id, contact.email)}
                        className={`flex w-full items-center justify-between gap-2 py-1 pl-8 pr-3 text-left transition-colors ${
                          isContactActive
                            ? "bg-m-primary-container/50"
                            : "hover:bg-m-surface-container-high"
                        }`}
                      >
                        <span
                          className={`min-w-0 truncate text-[10px] ${
                            isContactActive
                              ? "font-medium text-m-on-surface"
                              : "text-m-on-surface-variant"
                          }`}
                        >
                          {contact.email}
                        </span>
                        <span
                          className={`flex-shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold ${
                            isContactActive
                              ? "bg-m-primary text-white"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
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
          className={`flex items-center gap-2 border-t px-3 py-2 text-left transition-colors ${
            unassignedActive
              ? "border-red-200 bg-red-100"
              : "border-red-100 bg-red-50 hover:bg-red-100"
          }`}
        >
          <ChevronRight className="h-3 w-3 flex-shrink-0 text-destructive" />
          <span className="flex-1 text-xs font-semibold text-destructive">Unassigned</span>
          <span className="rounded-full bg-destructive px-1.5 py-px text-[9px] font-semibold text-white">
            {tree.unassigned.count}
          </span>
        </button>
      )}
    </div>
  );
}
