import { Badge } from "@/components/ui/badge";
import { heldLine } from "@/lib/client-review";
import type { ReviewItem } from "@/types/client-review";

/**
 * Where the time on an item actually went: "With you 25d · with us 4d".
 *
 * One component, both render sites, for the same reason DueBadge is one —
 * two copies drift, and this is a number a client may quote back to us.
 * Renders nothing when neither side has held it for a day.
 */
export function HeldBadge({ item }: { item: ReviewItem }) {
  const line = heldLine(item);
  if (!line) return null;
  return <Badge variant="muted">{line}</Badge>;
}
