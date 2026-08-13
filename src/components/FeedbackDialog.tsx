// src/components/FeedbackDialog.tsx
//
// The quick way to say something is broken, reachable from the nav rail on
// every page. Screenshots upload first, then one insert carries their paths —
// see migration 0123.

import { useRef, useState, type ChangeEvent } from "react";
import { useLocation } from "react-router-dom";
import { Bug, ImageIcon, MessageSquarePlus, Plus, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import { errorMessage } from "@/lib/utils";
import {
  ACCEPT_ATTR,
  MAX_FILES,
  uploadScreenshot,
  validateScreenshots,
} from "@/lib/feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Kind = "bug" | "feedback";

const KINDS: { kind: Kind; label: string; icon: typeof Bug }[] = [
  { kind: "bug", label: "Something's broken", icon: Bug },
  { kind: "feedback", label: "Feedback or an idea", icon: MessageSquarePlus },
];

export function FeedbackDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<Kind>("bug");
  const [summary, setSummary] = useState("");
  const [details, setDetails] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  function reset() {
    setKind("bug");
    setSummary("");
    setDetails("");
    setFiles([]);
    setFileError(null);
    setSendError(null);
    setSent(false);
  }

  function close() {
    onOpenChange(false);
    // After the dialog has animated out, so the form doesn't visibly blank.
    setTimeout(reset, 200);
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    // Clear the input so re-picking the same file still fires a change event.
    if (inputRef.current) inputRef.current.value = "";
    if (picked.length === 0) return;
    // Validate the combined list — three files picked one at a time is still
    // three files, and the count limit has to see all of them.
    const next = [...files, ...picked];
    const problem = validateScreenshots(next);
    if (problem) {
      setFileError(problem);
      return;
    }
    setFileError(null);
    setFiles(next);
  }

  async function send() {
    if (!user?.id || !summary.trim() || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const paths: string[] = [];
      for (const f of files) paths.push(await uploadScreenshot(user.id, f));
      const { error } = await supabase.from("feedback_reports").insert({
        kind,
        summary: summary.trim(),
        details: details.trim(),
        page_path: pathname,
        user_agent: navigator.userAgent,
        screenshot_paths: paths,
        created_by_email: user.email ?? null,
      });
      if (error) throw error;
      setSent(true);
    } catch (e) {
      // Deliberately keeps what was typed: making someone retype a bug report
      // because the network blipped is how you stop getting reports.
      setSendError(errorMessage(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {sent ? "Thanks — that's logged" : kind === "bug" ? "Report a bug" : "Share feedback"}
          </DialogTitle>
        </DialogHeader>

        {sent ? (
          <p className="text-body-medium text-m-on-surface-variant">
            It's in the queue for triage. You'll see it resolved or hear why it wasn't.
          </p>
        ) : (
          <div className="space-y-4">
            <fieldset className="flex gap-2">
              {KINDS.map((k) => (
                <Button
                  key={k.kind}
                  type="button"
                  size="sm"
                  variant={kind === k.kind ? "secondary" : "outline"}
                  aria-pressed={kind === k.kind}
                  onClick={() => setKind(k.kind)}
                >
                  <k.icon className="h-4 w-4" />
                  {k.label}
                </Button>
              ))}
            </fieldset>

            <div className="space-y-1.5">
              <Label htmlFor="fb-summary">Summary</Label>
              <Input
                id="fb-summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="One line — what is this about?"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fb-details">What happened?</Label>
              <Textarea
                id="fb-details"
                rows={4}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="What you did, what you expected, what you got instead."
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label>Screenshots</Label>
                <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
                  <Plus className="h-4 w-4" />
                  Add
                </Button>
              </div>
              <input
                ref={inputRef}
                type="file"
                hidden
                multiple
                accept={ACCEPT_ATTR}
                onChange={onPick}
              />
              {files.map((f, i) => (
                <div
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-2 rounded-md border border-m-outline-variant bg-m-surface-container px-2.5 py-1"
                >
                  <ImageIcon className="h-4 w-4 shrink-0 text-m-on-surface-variant" />
                  <span className="min-w-0 flex-1 truncate text-body-small">{f.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    // Dropping a file is how you recover from "too many"/"too
                    // big", so the error must not outlive the file that caused it.
                    onClick={() => {
                      setFiles((prev) => prev.filter((_, j) => j !== i));
                      setFileError(null);
                    }}
                    className="text-m-on-surface-variant hover:text-m-on-surface"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <p className="text-label-small text-m-on-surface-variant">
                PNG, JPG or WebP. Up to {MAX_FILES} files, 5 MB each. We attach the page you're on
                ({pathname}) and your browser details.
              </p>
              {fileError && <p className="text-label-small text-destructive">{fileError}</p>}
            </div>

            {sendError && <p className="text-label-small text-destructive">Couldn't send: {sendError}</p>}
          </div>
        )}

        <DialogFooter>
          {sent ? (
            <Button onClick={close}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button onClick={send} disabled={!summary.trim() || sending}>
                {sending ? "Sending…" : "Send"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
