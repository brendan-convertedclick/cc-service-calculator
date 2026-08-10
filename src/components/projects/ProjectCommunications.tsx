import { useEffect, useMemo, useState } from "react";
import { Layers, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageItem } from "@/components/MessageItem";
import { BriefThreadView } from "@/components/BriefThreadView";
import { useProjectBriefs, type Brief } from "@/hooks/useProjectBriefs";
import { useMultiBriefMessages } from "@/hooks/useMultiBriefMessages";
import { cn, toggleInSet } from "@/lib/utils";

interface Props {
  projectId: string;
}

function truncate(s: string | null, n: number): string {
  if (!s) return "(no subject)";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-ZA");
}

export function ProjectCommunications({ projectId }: Props) {
  const { data: briefs = [], isLoading } = useProjectBriefs(projectId);
  const [mergeMode, setMergeMode] = useState(false);
  const [activeTab, setActiveTab] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Default merge selection: all briefs
  useEffect(() => {
    if (mergeMode && selected.size === 0 && briefs.length > 0) {
      setSelected(new Set(briefs.map((b) => b.id)));
    }
  }, [mergeMode, briefs, selected.size]);

  // Default active tab: first brief
  useEffect(() => {
    if (!mergeMode && !activeTab && briefs.length > 0) {
      setActiveTab(briefs[0].id);
    }
  }, [mergeMode, activeTab, briefs]);

  if (isLoading) {
    return <div className="p-6 text-body-medium text-m-on-surface-variant">Loading threads…</div>;
  }

  if (briefs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-12 text-center">
        <MessageSquare className="h-8 w-8 text-m-on-surface-variant" />
        <h3 className="text-title-small">No threads linked yet</h3>
        <p className="max-w-sm text-body-small text-m-on-surface-variant">
          Open an email thread from the Inbox and link it to this project to start building a
          communication history.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="text-body-small text-m-on-surface-variant">
          {briefs.length} thread{briefs.length === 1 ? "" : "s"} linked to this project
        </div>
        <Button
          variant={mergeMode ? "default" : "outline"}
          size="sm"
          onClick={() => setMergeMode((v) => !v)}
        >
          <Layers className="h-4 w-4" />
          {mergeMode ? "Exit merge view" : "Merge view"}
        </Button>
      </div>

      {mergeMode ? (
        <MergedView
          briefs={briefs}
          selected={selected}
          onToggle={(id) => setSelected((prev) => toggleInSet(prev, id))}
        />
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col gap-3">
          <TabsList className="h-auto flex-wrap justify-start gap-1 bg-m-surface-container p-1">
            {briefs.map((b) => (
              <TabsTrigger
                key={b.id}
                value={b.id}
                className="flex flex-col items-start gap-0.5 px-3 py-1.5 text-left data-[state=active]:bg-background"
              >
                <span className="text-label-small font-medium">{truncate(b.raw_subject, 32)}</span>
                <span className="text-[10px] text-m-on-surface-variant">
                  {b.message_count} msg · {formatDate(b.last_message_at)}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          {briefs.map((b) => (
            <TabsContent
              key={b.id}
              value={b.id}
              className="m-0 rounded-xl border border-m-outline-variant bg-m-surface"
            >
              <div className="h-[600px]">
                <BriefThreadView brief={b} />
              </div>
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}

function MergedView({
  briefs,
  selected,
  onToggle,
}: {
  briefs: Brief[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const ids = useMemo(() => Array.from(selected), [selected]);
  const { data: messages = [], isLoading } = useMultiBriefMessages(ids);

  const briefById = useMemo(() => {
    const m = new Map<string, Brief>();
    for (const b of briefs) m.set(b.id, b);
    return m;
  }, [briefs]);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-[260px_1fr]">
      <div className="space-y-1 rounded-xl border border-m-outline-variant bg-m-surface p-2">
        <div className="px-2 py-1 text-label-small text-m-on-surface-variant">
          Threads in merged view
        </div>
        {briefs.map((b) => {
          const on = selected.has(b.id);
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onToggle(b.id)}
              className={cn(
                "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                on
                  ? "bg-m-primary-container text-m-on-primary-container"
                  : "hover:bg-m-surface-container",
              )}
            >
              <input
                type="checkbox"
                checked={on}
                readOnly
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
              />
              <span className="flex-1">
                <span className="block text-label-small font-medium">
                  {truncate(b.raw_subject, 28)}
                </span>
                <span className="block text-[10px] opacity-70">
                  {b.message_count} msg · {formatDate(b.last_message_at)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-m-outline-variant bg-m-surface">
        <div className="border-b border-m-outline-variant px-4 py-2 text-label-small text-m-on-surface-variant">
          Merged timeline · {messages.length} messages across {selected.size} thread
          {selected.size === 1 ? "" : "s"}
        </div>
        <div className="h-[600px] overflow-y-auto p-4 space-y-3">
          {isLoading && (
            <div className="text-body-medium text-m-on-surface-variant">Loading…</div>
          )}
          {!isLoading && messages.length === 0 && (
            <div className="text-body-small text-m-on-surface-variant">
              {selected.size === 0
                ? "Select threads on the left to view their combined timeline."
                : "No messages in the selected threads."}
            </div>
          )}
          {messages.map((m) => {
            const b = briefById.get(m.brief_id);
            return (
              <div key={m.id} className="space-y-1">
                {b && (
                  <div className="text-[10px] uppercase tracking-wide text-m-on-surface-variant">
                    {truncate(b.raw_subject, 60)}
                  </div>
                )}
                <MessageItem message={m} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
