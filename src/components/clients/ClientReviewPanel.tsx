import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Link2 } from "lucide-react";
import {
  useClientReviewLinks,
  useMintClientReviewLink,
  useRevokeClientReviewLink,
} from "@/hooks/useClientReviewLinks";
import { errorMessage } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-ZA");
}

export function ClientReviewPanel({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const { data: links = [], isLoading } = useClientReviewLinks(clientId);
  const mint = useMintClientReviewLink(clientId);
  const revoke = useRevokeClientReviewLink(clientId);
  const [label, setLabel] = useState("");
  // The plaintext URL, held only until the page is left. It is not recoverable.
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleMint() {
    mint.mutate(
      { label },
      {
        onSuccess: ({ url }) => {
          setFresh(url);
          setLabel("");
          toast.success("Link created — copy it now");
        },
        onError: (e) => toast.error(`Could not create link: ${errorMessage(e)}`),
      },
    );
  }

  async function handleCopy() {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      toast.error(`Could not copy: ${errorMessage(e)}`);
    }
  }

  const live = links.filter((l) => !l.revoked_at);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Client sign-off link</CardTitle>
        <CardDescription>
          The no-login page where {clientName} sees everything waiting on them and
          approves it. Anyone holding the link can decide on this client's behalf,
          so send it to named people and revoke it when someone leaves. The link is
          shown once — we store only a hash of it and cannot show it again.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {fresh && (
          <div className="rounded-lg border border-m-outline-variant bg-m-surface-container p-3">
            <p className="mb-2 text-label-large text-m-on-surface">
              Copy this now — it will not be shown again
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-m-surface px-2 py-1.5 text-body-small">
                {fresh}
              </code>
              <Button size="sm" variant="outline" onClick={handleCopy}>
                {copied ? (
                  <>
                    <Check className="mr-1.5 h-4 w-4" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-1.5 h-4 w-4" /> Copy
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label
              htmlFor="review-link-label"
              className="mb-1.5 block text-label-medium text-m-on-surface-variant"
            >
              Who is this for? (optional)
            </label>
            <Input
              id="review-link-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. W. Waller — Aug 2026"
            />
          </div>
          <Button onClick={handleMint} disabled={mint.isPending}>
            <Link2 className="mr-1.5 h-4 w-4" />
            {mint.isPending ? "Creating…" : "Create link"}
          </Button>
        </div>

        {isLoading ? (
          <p className="text-body-small text-m-on-surface-variant">Loading…</p>
        ) : links.length === 0 ? (
          <p className="text-body-small text-m-on-surface-variant">
            No link yet. {clientName} cannot reach their sign-off page until you
            create one.
          </p>
        ) : (
          <ul className="divide-y divide-m-outline-variant rounded-lg border border-m-outline-variant">
            {links.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-medium text-m-on-surface">
                    {l.label ?? "Untitled link"}
                  </p>
                  <p className="text-body-small text-m-on-surface-variant">
                    Created {fmt(l.created_at)} · Last opened {fmt(l.last_used_at)}
                  </p>
                </div>
                {l.revoked_at ? (
                  <Badge variant="outline">Revoked</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={revoke.isPending}
                    onClick={() =>
                      revoke.mutate(l.id, {
                        onSuccess: () => toast.success("Link revoked"),
                        onError: (e) =>
                          toast.error(`Could not revoke: ${errorMessage(e)}`),
                      })
                    }
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {live.length > 1 && (
          <p className="text-body-small text-m-on-surface-variant">
            {live.length} links are live for this client. Revoke the ones you no
            longer recognise.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
