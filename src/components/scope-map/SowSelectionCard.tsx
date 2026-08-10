import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { toggleInSet } from "@/lib/utils";
import type { SowOption } from "@/hooks/useScopeMap";

export interface SowSelectionCardProps {
  /** All master SOWs (slug + title). */
  available: SowOption[];
  /** AI-suggested slugs — pre-checked with a "Suggested" badge. */
  suggestedSlugs: string[];
  /** Triggers analyze with persist_client_sows: true. */
  onConfirm: (slugs: string[]) => void;
  confirming?: boolean;
}

/**
 * First-run question for a client with no SOW link yet: which master SOW
 * engagements does this client have? The confirmed selection is saved to
 * client_sows, so the question is asked exactly once per client.
 */
export function SowSelectionCard({
  available,
  suggestedSlugs,
  onConfirm,
  confirming = false,
}: SowSelectionCardProps) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(suggestedSlugs));
  const suggested = new Set(suggestedSlugs);

  const toggle = (slug: string) => {
    setChecked((prev) => toggleInSet(prev, slug));
  };

  return (
    <Card className="mx-auto max-w-xl rounded-xl border-m-outline-variant shadow-elev-1">
      <CardHeader>
        <CardTitle className="text-title-medium">
          Which SOW engagements does this client have?
        </CardTitle>
        <p className="text-body-small text-m-on-surface-variant">
          We don't have a SOW on record for this client yet. Pick the ones that
          apply — the selection is remembered on the client, so you'll only be
          asked once.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-1">
          {available.map((sow) => (
            <li key={sow.slug}>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-m-surface-container">
                <Checkbox
                  checked={checked.has(sow.slug)}
                  onCheckedChange={() => toggle(sow.slug)}
                  aria-label={sow.title}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-medium text-m-on-surface">
                    {sow.title}
                  </span>
                  <span className="block truncate text-label-small text-m-on-surface-variant">
                    {sow.slug}
                  </span>
                </span>
                {suggested.has(sow.slug) && (
                  <Badge variant="muted" className="shrink-0 gap-1">
                    <Sparkles className="h-3 w-3" />
                    Suggested
                  </Badge>
                )}
              </label>
            </li>
          ))}
        </ul>
        {available.length === 0 && (
          <p className="rounded-lg border border-dashed border-m-outline-variant px-3 py-6 text-center text-body-small text-m-on-surface-variant">
            No master SOWs exist yet. Author one first, then re-run the analysis.
          </p>
        )}
        <div className="flex justify-end">
          <Button
            disabled={checked.size === 0 || confirming}
            onClick={() => onConfirm(Array.from(checked))}
            className="gap-2"
          >
            <Sparkles className={`h-4 w-4 ${confirming ? "animate-pulse" : ""}`} />
            {confirming ? "Analysing…" : "Save & analyse"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default SowSelectionCard;
