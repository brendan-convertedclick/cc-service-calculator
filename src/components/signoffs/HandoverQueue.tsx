// The hand-overs waiting for a Send (0204). Sits at the top of /client-signoffs
// and renders nothing when there are none, so the page reads as before.
//
// One card per hand-over: what the doer wrote (the client reads exactly this),
// the proof they attached, who handed it over and when. Send releases it to
// the client's page and emails the picked contacts; the title is editable
// because it was drafted from a ClickUp task name.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ExternalLink, Loader2, PackageCheck, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useClientContacts } from "@/hooks/useContacts";
import {
  type Handover,
  useHandoverProofUrls,
  useHandovers,
  useSendHandover,
} from "@/hooks/useHandovers";
import { docLinkLabel } from "@/lib/doc-links";
import { errorMessage, toggleInSet } from "@/lib/utils";

export function HandoverQueue({ clientId }: { clientId?: string | null }) {
  const { data = [] } = useHandovers();
  const rows = clientId ? data.filter((h) => h.client_id === clientId) : data;
  if (!rows.length) return null;
  return (
    <section aria-labelledby="handover-heading" className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <PackageCheck className="h-4 w-4 self-center text-m-primary" />
        <h2 id="handover-heading" className="text-title-medium text-m-on-surface">
          Ready to send · {rows.length}
        </h2>
        <p className="text-body-small text-m-on-surface-variant">
          Finished work the team handed over with proof. Nothing has gone to the client yet.
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((h) => (
          <HandoverCard key={h.id} handover={h} />
        ))}
      </div>
    </section>
  );
}

function HandoverCard({ handover: h }: { handover: Handover }) {
  const { data: contacts = [], isPending: contactsPending } = useClientContacts(h.client_id);
  const { data: urls } = useHandoverProofUrls(h.proof);
  const send = useSendHandover();
  const [title, setTitle] = useState(h.client_title);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // The primary contact by default: one named person, not the whole company.
  useEffect(() => {
    const primary = contacts.find((c) => c.is_primary) ?? contacts[0];
    setPicked(primary ? new Set([primary.id]) : new Set());
  }, [contacts]);

  const recipients = contacts
    .filter((c) => picked.has(c.id))
    .map((c) => ({ id: c.id, email: c.email, name: c.full_name }));

  async function onSend() {
    try {
      const { failures } = await send.mutateAsync({ handover: h, title, recipients });
      if (failures.length) toast.warning(`Released, but did not reach: ${failures.join("; ")}`);
      else toast.success(`Sent to ${recipients.map((r) => r.name ?? r.email).join(", ")}.`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  const handedOver = new Date(h.handed_over_at).toLocaleString("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-m-outline-variant bg-m-surface p-4 shadow-elev-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-label-large text-m-on-surface">{h.client_name}</span>
        <span className="text-label-small text-m-on-surface-variant">
          {h.handed_over_by ?? "Someone"} · {handedOver}
          {h.clickup_task_id ? (
            <>
              {" · "}
              <a
                href={`https://app.clickup.com/t/${h.clickup_task_id}`}
                target="_blank"
                rel="noreferrer"
                className="text-m-primary hover:underline"
              >
                task
              </a>
            </>
          ) : null}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`ho-title-${h.id}`}>Title the client reads</Label>
        <Input id={`ho-title-${h.id}`} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-label-medium text-m-on-surface-variant">What we did (their words, as the client sees them)</span>
        <p className="whitespace-pre-wrap rounded-md bg-m-surface-container px-3 py-2 text-body-medium text-m-on-surface">
          {h.detail}
        </p>
      </div>

      {h.proof.length || h.links.length ? (
        <ul className="flex flex-wrap gap-2">
          {h.proof.map((p) => {
            const url = urls?.get(p.path);
            return (
              <li key={p.path}>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  title={p.name}
                  className="block w-28 overflow-hidden rounded-md border border-m-outline-variant"
                >
                  {url && p.mime.startsWith("image/") ? (
                    <img src={url} alt={p.name} className="aspect-video w-full object-cover" />
                  ) : null}
                  <span className="block truncate px-1.5 py-1 text-label-small text-m-on-surface-variant">{p.name}</span>
                </a>
              </li>
            );
          })}
          {h.links.map((l) => (
            <li key={l}>
              <a
                href={l}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md bg-m-secondary-container px-2 py-1 text-label-small text-m-on-secondary-container hover:underline"
              >
                {docLinkLabel(l)}
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label>Send to</Label>
        {contactsPending ? (
          <p className="text-body-small text-m-on-surface-variant">Loading contacts…</p>
        ) : contacts.length === 0 ? (
          <p className="text-body-small text-m-on-surface-variant">
            {h.client_name} has no contacts yet.{" "}
            <Link to={`/clients/${h.client_id}`} className="text-m-primary underline">
              Add the person who signs off
            </Link>
            , then send.
          </p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {contacts.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-body-medium">
                <Checkbox
                  checked={picked.has(c.id)}
                  onCheckedChange={() => setPicked((prev) => toggleInSet(prev, c.id))}
                />
                <span className="text-m-on-surface">{c.full_name ?? c.email}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <Button
        className="self-end"
        onClick={() => void onSend()}
        disabled={!title.trim() || !recipients.length || send.isPending}
      >
        {send.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
        Send to client
      </Button>
    </article>
  );
}
