// src/components/moments/MomentFormDialog.tsx
//
// Adding a date has to be quick or nobody does it after a phone call. The
// dialog opens short — school, person, type, name, Enter — with the date
// already set from the square that was clicked. "More options" grows the SAME
// form in place (date, every year, what to ask, notes) rather than swapping
// to a second screen that forgets what was typed. Editing opens it grown.
//
// People are `contacts` rows, so a new person needs an email: the address is
// half of the contacts unique key and what their sign-off link hangs off
// (useContacts.ts). It costs one field and makes them usable everywhere else
// in Conductor, not just here.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext";
import { useClients } from "@/hooks/useClients";
import { useAddContact, useClientContacts } from "@/hooks/useContacts";
import { useSaveMoment } from "@/hooks/useContactMoments";
import { KIND_META, MOMENT_KINDS, type Moment, type MomentKind } from "@/lib/contact-moments";
import { cn, errorMessage } from "@/lib/utils";

const NEW_PERSON = "__new";
const LAST_SCHOOL = "moments.lastClientId";

function readLastSchool(): string {
  try {
    return localStorage.getItem(LAST_SCHOOL) ?? "";
  } catch {
    return "";
  }
}

function longDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function MomentFormDialog({
  open,
  onOpenChange,
  date,
  moment,
  presetClientId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The square that was clicked. Ignored when editing. */
  date: string;
  /** Present when editing. */
  moment?: Moment | null;
  /** The school the page is filtered to, if any. */
  presetClientId?: string;
}) {
  const { currentUserId } = useAuth();
  const { data: clients = [] } = useClients();
  const editing = !!moment;

  const [expanded, setExpanded] = useState(false);
  const [clientId, setClientId] = useState("");
  const [contactId, setContactId] = useState("");
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [kind, setKind] = useState<MomentKind>("event");
  const [title, setTitle] = useState("");
  const [onDate, setOnDate] = useState(date);
  const [repeats, setRepeats] = useState(false);
  const [askAbout, setAskAbout] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reset every time it opens, from the moment being edited or the clicked day.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setNewName("");
    setNewEmail("");
    if (moment) {
      setExpanded(true);
      setClientId(moment.client_id);
      setContactId(moment.contact_id);
      setKind(moment.kind);
      setTitle(moment.title ?? "");
      setOnDate(moment.on_date);
      setRepeats(moment.repeats_yearly);
      setAskAbout(moment.ask_about ?? "");
      setNotes(moment.notes ?? "");
    } else {
      setExpanded(false);
      setClientId(presetClientId || readLastSchool());
      setContactId("");
      setKind("event");
      setTitle("");
      setOnDate(date);
      setRepeats(KIND_META.event.repeats);
      setAskAbout("");
      setNotes("");
    }
  }, [open, moment, date, presetClientId]);

  const { data: contacts = [] } = useClientContacts(clientId || undefined);
  const addContact = useAddContact(clientId || undefined);
  const save = useSaveMoment();

  const clientOptions = useMemo(
    () =>
      clients
        .filter((c) => !c.is_internal)
        .map((c) => ({ value: c.id, label: c.name })),
    [clients],
  );
  const personOptions = useMemo(
    () => [
      ...contacts.map((c) => ({ value: c.id, label: c.full_name ? `${c.full_name}${c.role ? ` · ${c.role}` : ""}` : c.email })),
      { value: NEW_PERSON, label: "+ New person…" },
    ],
    [contacts],
  );

  // A school that no longer holds the picked person drops the pick.
  useEffect(() => {
    if (contactId && contactId !== NEW_PERSON && contacts.length && !contacts.some((c) => c.id === contactId)) {
      setContactId("");
    }
  }, [contacts, contactId]);

  function pickKind(k: MomentKind) {
    setKind(k);
    if (!editing) setRepeats(KIND_META[k].repeats);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!clientId) return setError("Pick the school.");
    if (!contactId) return setError("Pick the person, or add them.");
    try {
      let personId = contactId;
      if (contactId === NEW_PERSON) {
        personId = await addContact.mutateAsync({ fullName: newName, email: newEmail, role: "" });
      }
      await save.mutateAsync({
        input: {
          id: moment?.id,
          clientId,
          contactId: personId,
          kind,
          title,
          onDate,
          repeatsYearly: repeats,
          askAbout,
          notes,
        },
        createdBy: currentUserId,
      });
      try {
        localStorage.setItem(LAST_SCHOOL, clientId);
      } catch {
        /* a remembered school is a convenience */
      }
      toast.success(editing ? "Saved" : kind === "birthday" ? "Birthday added" : `Added: ${title.trim()}`);
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const busy = save.isPending || addContact.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit date" : "Add a date"}</DialogTitle>
          <DialogDescription>{longDate(onDate || date)}</DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void submit(e)} className="grid gap-4">
          <div className="grid gap-1.5">
            <span className="text-label-medium text-m-on-surface-variant">School / client</span>
            <Combobox
              options={clientOptions}
              value={clientId}
              onChange={(v) => {
                setClientId(v);
                setContactId("");
              }}
              placeholder="Pick a school…"
              emptyLabel="No school by that name."
            />
          </div>

          <div className="grid gap-1.5">
            <span className="text-label-medium text-m-on-surface-variant">Person</span>
            <Combobox
              options={clientId ? personOptions : []}
              value={contactId}
              onChange={setContactId}
              placeholder={clientId ? "Pick a person…" : "Pick the school first"}
              emptyLabel="Nobody by that name. Choose “New person”."
            />
            {contactId === NEW_PERSON ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  aria-label="New person's name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Their name"
                  autoFocus
                />
                <Input
                  aria-label="New person's email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="Their email"
                />
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Type">
            {MOMENT_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => pickKind(k)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-label-large transition-colors",
                  kind === k
                    ? "border-m-primary bg-m-primary-container text-m-on-primary-container"
                    : "border-m-outline-variant text-m-on-surface-variant hover:bg-m-surface-container",
                )}
              >
                {KIND_META[k].label}
              </button>
            ))}
          </div>

          {kind !== "birthday" ? (
            <div className="grid gap-1.5">
              <label htmlFor="moment-title" className="text-label-medium text-m-on-surface-variant">
                {kind === "event" ? "Event name" : "What it marks"}
              </label>
              <Input
                id="moment-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={kind === "event" ? "e.g. Daughter's matric dance" : "e.g. 10 years at the school"}
                autoFocus={!!clientId && !!contactId && contactId !== NEW_PERSON}
              />
            </div>
          ) : null}

          {expanded ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <label htmlFor="moment-date" className="text-label-medium text-m-on-surface-variant">
                    Date
                  </label>
                  <Input id="moment-date" type="date" value={onDate} onChange={(e) => setOnDate(e.target.value)} required />
                </div>
                <label className="flex items-center gap-2 self-end pb-2 text-body-medium">
                  <input
                    type="checkbox"
                    checked={repeats}
                    onChange={(e) => setRepeats(e.target.checked)}
                    className="h-4 w-4 accent-[hsl(var(--mcolor-primary))]"
                  />
                  Every year
                </label>
              </div>
              {kind === "birthday" ? (
                <p className="-mt-2 text-body-small text-m-on-surface-variant">
                  Don't know the year? Any year works. Only the day is shown.
                </p>
              ) : null}
              <div className="grid gap-1.5">
                <label htmlFor="moment-ask" className="text-label-medium text-m-on-surface-variant">
                  What to ask or say
                </label>
                <Input
                  id="moment-ask"
                  value={askAbout}
                  onChange={(e) => setAskAbout(e.target.value)}
                  placeholder={KIND_META[kind].ask}
                />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="moment-notes" className="text-label-medium text-m-on-surface-variant">
                  Notes
                </label>
                <Textarea
                  id="moment-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything that helps the conversation"
                  rows={3}
                />
              </div>
            </>
          ) : null}

          {error ? <p className="text-body-small text-m-error">{error}</p> : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {!expanded ? (
              <Button type="button" variant="ghost" className="mr-auto" onClick={() => setExpanded(true)}>
                More options
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : editing ? "Save" : "Add"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
