// /settings/email-templates — the standard client emails.
//
// A template is written once and reused: the compose page loads one to start a
// reply from, and a procedure step can point at the one it sends, so whoever
// runs that step isn't rewriting the same message from memory.
//
// Variables are {placeholders} in the subject or body. They are derived from
// the text rather than typed separately — a list you maintain by hand goes
// stale the first time someone edits a body.
import { useState } from "react";
import { toast } from "sonner";
import { Mail, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { errorMessage } from "@/lib/utils";
import {
  useDeleteEmailTemplate,
  useEmailTemplates,
  useSaveEmailTemplate,
  variablesIn,
  type EmailTemplate,
} from "@/hooks/useEmailTemplates";

type Draft = {
  name: string;
  slug: string;
  subject: string;
  body_text: string;
};

const EMPTY: Draft = { name: "", slug: "", subject: "", body_text: "" };

/** Slug is the stable handle a step and the compose page refer to, so it is
 *  derived once from the name and then left alone — renaming a template must
 *  not silently unlink every step pointing at it. */
function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function SettingsEmailTemplates() {
  const { data: templates = [], isLoading } = useEmailTemplates();
  const save = useSaveEmailTemplate();
  const remove = useDeleteEmailTemplate();

  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [open, setOpen] = useState(false);

  function startNew() {
    setEditing(null);
    setDraft(EMPTY);
    setOpen(true);
  }

  function startEdit(t: EmailTemplate) {
    setEditing(t);
    setDraft({
      name: t.name,
      slug: t.slug,
      subject: t.subject,
      body_text: t.body_text ?? "",
    });
    setOpen(true);
  }

  function commit() {
    const name = draft.name.trim();
    const subject = draft.subject.trim();
    const body = draft.body_text.trim();
    // Subject is optional on purpose: a template written to answer a client
    // reply has no business setting one, because the thread already has a
    // subject and replacing it breaks the conversation in their inbox.
    // Stored as "" rather than null — the column is NOT NULL from 0056.
    if (!name || !body) {
      toast.error("A template needs a name and a body");
      return;
    }
    const slug = draft.slug || slugify(name);
    save.mutate(
      {
        id: editing?.id,
        patch: {
          name,
          slug,
          subject,
          body_text: body,
          // The HTML body is what actually sends; plain text is what people
          // write. Newlines become paragraphs so a template written here is
          // readable in an inbox without anyone touching markup.
          body_html: body
            .split(/\n{2,}/)
            .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
            .join("\n"),
          variables: variablesIn(subject, body),
        },
      },
      {
        onSuccess: () => {
          toast.success(editing ? "Template saved" : "Template created");
          setOpen(false);
          setEditing(null);
          setDraft(EMPTY);
        },
        onError: (e) => toast.error(`Could not save: ${errorMessage(e)}`),
      }
    );
  }

  const previewVars = variablesIn(draft.subject, draft.body_text);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-headline-small font-semibold text-m-on-surface">Email templates</h1>
          <p className="mt-1 text-body-small text-m-on-surface-variant">
            The standard client emails. Start a reply from one on the compose page, or point a
            procedure step at the one it sends.
          </p>
        </div>
        <Button onClick={startNew} className="flex-none gap-1.5">
          <Plus className="h-4 w-4" /> New template
        </Button>
      </div>

      {open && (
        <Card className="border-m-primary/40">
          <CardHeader>
            <CardTitle className="text-title-medium">
              {editing ? `Edit — ${editing.name}` : "New template"}
            </CardTitle>
            <CardDescription>
              Write {"{placeholders}"} where the detail changes — {"{client_first_name}"},{" "}
              {"{project_name}"}, {"{drive_link}"}. They are filled in when the email is drafted.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">Name</Label>
              <Input
                id="tpl-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Clarifying questions"
              />
              {!editing && draft.name.trim() !== "" && (
                <p className="text-label-small text-m-on-surface-variant">
                  Handle: <span className="font-mono">{slugify(draft.name)}</span>
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-subject">Subject (optional)</Label>
              <Input
                id="tpl-subject"
                value={draft.subject}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                placeholder="A few questions on {project_name}"
              />
              <p className="text-label-small text-m-on-surface-variant">
                Leave blank for a template you reply with — the thread already has a
                subject, and setting one here would replace it.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-body">Body</Label>
              <Textarea
                id="tpl-body"
                value={draft.body_text}
                onChange={(e) => setDraft({ ...draft, body_text: e.target.value })}
                rows={10}
                placeholder={"Hi {client_first_name},\n\nBefore we start on {project_name}, a few things I need from you:\n\n1.\n2.\n\nThanks"}
              />
            </div>

            {previewVars.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-label-small text-m-on-surface-variant">Variables:</span>
                {previewVars.map((v) => (
                  <Badge key={v} variant="outline" className="font-mono text-label-small">
                    {v}
                  </Badge>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setOpen(false); setEditing(null); }}>
                Cancel
              </Button>
              <Button onClick={commit} disabled={save.isPending}>
                {save.isPending ? "Saving…" : editing ? "Save changes" : "Create template"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-title-medium">
            Templates{" "}
            <span className="text-label-medium font-normal text-m-on-surface-variant">
              · {templates.length}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && (
            <p className="px-5 py-4 text-body-small text-m-on-surface-variant">Loading…</p>
          )}
          {!isLoading && templates.length === 0 && (
            <p className="px-5 py-6 text-body-small text-m-on-surface-variant">
              No templates yet. The first one is usually the reply you send most often.
            </p>
          )}
          <ul className="divide-y divide-m-outline-variant">
            {templates.map((t) => (
              <li key={t.id} className="flex items-start gap-3 px-5 py-3">
                <Mail className="mt-0.5 h-4 w-4 flex-none text-m-on-surface-variant" />
                <button
                  type="button"
                  onClick={() => startEdit(t)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="text-body-large font-medium text-m-on-surface hover:underline">
                    {t.name}
                  </p>
                  <p className="text-label-medium text-m-on-surface-variant">{t.subject}</p>
                  {(t.variables ?? []).length > 0 && (
                    <p className="mt-0.5 font-mono text-label-small text-m-on-surface-variant/80">
                      {(t.variables ?? []).map((v) => `{${v}}`).join(" ")}
                    </p>
                  )}
                </button>
                <button
                  type="button"
                  aria-label={`Delete template "${t.name}"`}
                  title="Delete — steps pointing at it keep working, they just lose the shortcut"
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate(t.id, {
                      onSuccess: () => toast.success("Template deleted"),
                      onError: (e) => toast.error(`Could not delete: ${errorMessage(e)}`),
                    })
                  }
                  className="flex-none rounded-md p-1.5 text-m-on-surface-variant hover:bg-m-error-container hover:text-m-on-error-container"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
