import { useState } from "react";
import { ExternalLink, FileText, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUpdateSystem } from "@/hooks/useSystemDefinitions";
import { errorMessage } from "@/lib/utils";
import { docLinkLabel, normaliseDocLink } from "@/lib/doc-links";

/**
 * The reference documents on a system (system_definitions.doc_links, 0129).
 *
 * Writes immediately rather than staging into SystemDetail's draft — same call
 * as StepLinks makes for procedure/template links: a picker that appears to do
 * nothing until Save is the trap that has already caught people twice. The
 * adjacent textareas stage on blur because they're free text mid-sentence;
 * adding a link is a discrete act with a button, so there's nothing to stage.
 */
export function DocLinksField({
  systemId,
  links,
  noun,
}: {
  systemId: string;
  links: string[];
  /** "process" / "procedure" / "policy" — this page's own word for itself. */
  noun: string;
}) {
  const [draft, setDraft] = useState("");
  const update = useUpdateSystem();

  function write(next: string[]) {
    update.mutate(
      { id: systemId, patch: { doc_links: next } },
      { onError: (e) => toast.error(`Could not save the documents: ${errorMessage(e)}`) },
    );
  }

  function add() {
    const link = normaliseDocLink(draft);
    if (!link) {
      toast.error("That doesn't look like a document link — paste a web address.");
      return;
    }
    if (links.includes(link)) {
      toast.error("That document is already linked.");
      setDraft("");
      return;
    }
    write([...links, link]);
    setDraft("");
  }

  return (
    <div className="space-y-2">
      {links.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {links.map((link) => (
            <li key={link}>
              <span className="inline-flex items-center gap-1 rounded-md bg-m-secondary-container px-2 py-0.5 text-label-small text-m-on-secondary-container">
                <FileText className="h-3 w-3 shrink-0" />
                <a
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                  title={link}
                  className="inline-flex items-center gap-1 hover:underline"
                >
                  {docLinkLabel(link)}
                  <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                </a>
                <button
                  type="button"
                  aria-label={`Remove ${link}`}
                  title="Remove"
                  disabled={update.isPending}
                  onClick={() => write(links.filter((l) => l !== link))}
                  className="opacity-60 hover:opacity-100"
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-1.5">
        <Input
          value={draft}
          aria-label={`Add a document link to this ${noun}`}
          placeholder="Paste a link — a Google Doc, a spec, a brand sheet…"
          onChange={(e) => setDraft(e.target.value)}
          // Enter submits the link rather than the page: this sits inside the
          // detail form, and a stray submit would reload mid-edit.
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            add();
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5"
          disabled={!draft.trim() || update.isPending}
          onClick={add}
        >
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>
    </div>
  );
}

