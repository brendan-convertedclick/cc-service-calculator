// src/components/clients/ContactsPanel.tsx
//
// Who we talk to at this client.
//
// This is the prerequisite for everything on the sign-off page that names a
// person: a personal link signs as a contact, a question emails one, a message
// emails one, and an approval is attributable because of one. Without a row
// here a client can only get a shared link that nobody can be held to — which
// was every client but three until this panel existed.
//
// Explicit Save per row, never save-on-blur: these names go in front of a
// client and onto an approval record.

import { useState } from "react";
import { toast } from "sonner";
import { Check, Pencil, Plus, Star, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  useAddContact,
  useClientContacts,
  useDeleteContact,
  useSetPrimaryContact,
  useUpdateContact,
  type ClientContact,
} from "@/hooks/useContacts";
import { errorMessage } from "@/lib/utils";

function ContactRow({
  contact,
  clientId,
  onDeleted,
}: {
  contact: ClientContact;
  clientId: string;
  onDeleted: () => void;
}) {
  const update = useUpdateContact(clientId);
  const setPrimary = useSetPrimaryContact(clientId);
  const remove = useDeleteContact(clientId);
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(contact.full_name ?? "");
  const [role, setRole] = useState(contact.role ?? "");
  const [confirming, setConfirming] = useState(false);

  async function save() {
    try {
      await update.mutateAsync({ id: contact.id, fullName, role });
      setEditing(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-m-outline-variant py-2 last:border-b-0">
        <Input
          className="w-48"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          aria-label="Full name"
        />
        <Input
          className="w-40"
          value={role}
          placeholder="Role (optional)"
          onChange={(e) => setRole(e.target.value)}
          aria-label="Role"
        />
        <span className="text-body-small text-m-on-surface-variant">{contact.email}</span>
        <div className="ml-auto flex gap-1">
          <Button size="sm" onClick={() => void save()} disabled={update.isPending}>
            <Check className="mr-1.5 h-3.5 w-3.5" /> Save
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-m-outline-variant py-2 last:border-b-0">
      <span className="text-body-medium text-m-on-surface">{contact.full_name ?? "(no name)"}</span>
      {contact.role ? (
        <span className="text-body-small text-m-on-surface-variant">{contact.role}</span>
      ) : null}
      <span className="text-body-small text-m-on-surface-variant">{contact.email}</span>
      {contact.is_primary ? <Badge variant="muted">Primary</Badge> : null}

      <div className="ml-auto flex items-center gap-1">
        {!contact.is_primary && (
          <Button
            size="sm"
            variant="ghost"
            title="Make primary — they are ticked by default when we email"
            onClick={() => setPrimary.mutate(contact.id)}
            disabled={setPrimary.isPending}
          >
            <Star className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        {confirming ? (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={remove.isPending}
              onClick={async () => {
                try {
                  await remove.mutateAsync(contact.id);
                  onDeleted();
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}
            >
              Remove and revoke
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function ContactsPanel({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const { data: contacts = [], isLoading } = useClientContacts(clientId);
  const add = useAddContact(clientId);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");

  async function submit() {
    try {
      await add.mutateAsync({ fullName, email, role });
      setFullName("");
      setEmail("");
      setRole("");
      toast.success("Contact added. They can now have their own sign-off link.");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contacts</CardTitle>
        <CardDescription>
          The people at {clientName} we deal with. Everything on the sign-off page that names
          somebody depends on this: a personal link signs as one of them, questions and
          messages go to them by name, and an approval is only attributable because we know
          who they are. With nobody here, {clientName} can only get a shared link.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-body-small text-m-on-surface-variant">Loading…</p>
        ) : contacts.length === 0 ? (
          <p className="text-body-small text-m-on-surface-variant">
            No contacts yet. Add the person who actually signs things off.
          </p>
        ) : (
          <div>
            {contacts.map((c) => (
              <ContactRow key={c.id} contact={c} clientId={clientId} onDeleted={() => {}} />
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2 border-t border-m-outline-variant pt-4">
          <div>
            <label
              htmlFor="contact-name"
              className="mb-1.5 block text-label-medium text-m-on-surface-variant"
            >
              Name
            </label>
            <Input
              id="contact-name"
              className="w-48"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Asavela Ludidi"
            />
          </div>
          <div>
            <label
              htmlFor="contact-email"
              className="mb-1.5 block text-label-medium text-m-on-surface-variant"
            >
              Email
            </label>
            <Input
              id="contact-email"
              type="email"
              className="w-56"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="asavela@example.co.za"
            />
          </div>
          <div>
            <label
              htmlFor="contact-role"
              className="mb-1.5 block text-label-medium text-m-on-surface-variant"
            >
              Role (optional)
            </label>
            <Input
              id="contact-role"
              className="w-40"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Marketing Manager"
            />
          </div>
          <Button onClick={() => void submit()} disabled={add.isPending || !fullName.trim() || !email.trim()}>
            <Plus className="mr-1.5 h-4 w-4" />
            {add.isPending ? "Adding…" : "Add contact"}
          </Button>
        </div>
        <p className="text-label-small text-m-on-surface-variant">
          The address cannot be edited later — it is what a personal link is tied to. Wrong
          address: remove and add again. Removing someone also kills any live link that signs
          as them, which is the point when they leave.
        </p>
      </CardContent>
    </Card>
  );
}
