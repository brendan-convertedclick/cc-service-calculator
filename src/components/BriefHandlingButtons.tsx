import { Button } from "@/components/ui/button";

export type BriefRowBrief = { id: string; intent_type: string | null };

export function pickPrimary(
  intent: string | null,
): "brief_as_is" | "scope_it" | "draft_reply" {
  if (intent === "quick_task") return "brief_as_is";
  if (intent === "quick_response" || intent === "general_query") return "draft_reply";
  return "scope_it";
}

/**
 * Bucket-aware handling row. `pickPrimary` chooses which action the AI thinks is
 * right (rendered as the filled primary button), but all actions stay clickable
 * so the operator can always override the suggestion.
 */
export function BriefHandlingButtons({
  brief,
  onScopeIt,
  onBriefAsIs,
  onDraftReply,
}: {
  brief: BriefRowBrief;
  onScopeIt: () => void;
  onBriefAsIs: () => void;
  onDraftReply?: () => void;
}) {
  const primary = pickPrimary(brief.intent_type);
  const btn = (
    key: "brief_as_is" | "scope_it" | "draft_reply",
    label: string,
    onClick: () => void,
  ) => (
    <Button
      variant={primary === key ? "default" : "outline"}
      size="sm"
      onClick={onClick}
    >
      {label}
    </Button>
  );
  return (
    <div className="flex gap-2">
      {btn("brief_as_is", "Brief as-is", onBriefAsIs)}
      {btn("scope_it", "Scope it", onScopeIt)}
      {onDraftReply && btn("draft_reply", "Draft reply", onDraftReply)}
    </div>
  );
}
