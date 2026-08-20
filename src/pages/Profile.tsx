import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarDays, LogOut } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { useCurrentRole } from "@/hooks/useCurrentRole";
import { useDepartments } from "@/hooks/useDepartments";
import { memberColors, useTeam, useUpdateTeamMember } from "@/hooks/useTeam";
import { ClickUpConnectCard } from "@/components/ClickUpConnectCard";
import { SkillsEditor } from "@/components/SkillsEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/utils";

const ROLE_LABEL: Record<string, string> = {
  staff: "Staff",
  admin: "Admin",
  owner: "Owner",
};

/**
 * Everyone's own account page: the fields that are genuinely theirs (name,
 * department, skills), their connected accounts, and sign-out.
 *
 * What is *not* editable here — role, cost rate, email, archived state — is
 * held immutable for non-admins by the team_members BEFORE UPDATE trigger
 * (migration 0115), so this page showing them read-only is the UI agreeing
 * with the database rather than the only thing enforcing it.
 */
export function Profile() {
  const { user, currentUserId, signOut } = useAuth();
  const { role } = useCurrentRole();
  const { data: team = [], isLoading } = useTeam();
  const { data: depts = [] } = useDepartments();
  const update = useUpdateTeamMember();
  const navigate = useNavigate();

  const me = team.find((m) => m.id === currentUserId) ?? null;
  const myColor = useMemo(
    () => (me ? memberColors(team).get(me.id) : undefined),
    [team, me],
  );

  const displayName = me?.full_name ?? user?.email ?? "Signed in";
  const initials = (
    me?.full_name
      ? me.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("")
      : (user?.email?.[0] ?? "?")
  ).toUpperCase();

  const save = (patch: Parameters<typeof update.mutate>[0]["patch"]) => {
    if (!me) return;
    update.mutate(
      { id: me.id, patch },
      {
        onSuccess: () => toast.success("Profile updated"),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  const signOutAndLeave = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="container mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-4">
        <div
          className="grid h-14 w-14 shrink-0 place-items-center rounded-full text-title-medium font-medium"
          style={
            myColor
              ? { background: myColor, color: "white" }
              : { background: "hsl(var(--mcolor-primary-container))", color: "hsl(var(--mcolor-on-primary-container))" }
          }
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-headline-medium">{displayName}</h1>
          <p className="truncate text-body-small text-m-on-surface-variant">{user?.email}</p>
        </div>
        {role && <Badge variant="secondary">{ROLE_LABEL[role] ?? role}</Badge>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your details</CardTitle>
          <CardDescription>
            Saved as you leave each field. Email and access level are managed by
            an admin on the Team page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading ? (
            <p className="text-body-small text-m-on-surface-variant">Loading…</p>
          ) : !me ? (
            // The shared team@ login has no roster row by design (see CLAUDE.md),
            // so there is nothing to edit — say so instead of rendering inputs
            // whose saves would silently go nowhere.
            <p className="text-body-small text-m-on-surface-variant">
              You're signed in as <span className="font-medium">{user?.email}</span>, a shared
              account with no team member record — so there's no personal profile to edit.
              Sign in with your own @convertedclick.co.za account to manage your details.
            </p>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="profile-name">Full name</Label>
                <Input
                  id="profile-name"
                  defaultValue={me.full_name}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== me.full_name) save({ full_name: v });
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="profile-email">Email</Label>
                <Input id="profile-email" value={me.email ?? ""} readOnly disabled />
              </div>

              <div className="space-y-2">
                <Label htmlFor="profile-dept">Primary department</Label>
                <select
                  id="profile-dept"
                  defaultValue={me.primary_department_id ?? ""}
                  onChange={(e) => save({ primary_department_id: e.target.value || null })}
                  className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm text-m-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">—</option>
                  {depts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <p className="text-label-small text-m-on-surface-variant">
                  Drives which work gets assigned to you by default.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Skills</Label>
                <SkillsEditor skills={me.skills} onChange={(skills) => save({ skills })} />
              </div>

              {/* Gmail's own signature is added by its web and phone clients,
                  never by the API — so mail sent from Conductor arrives bare
                  unless we append this ourselves.

                  Two fields, not one, because outbound mail is
                  multipart/alternative: the HTML part carries the designed
                  signature, the plain-text part still needs something readable
                  for anyone whose client shows text. */}
              <SignatureEditor
                text={me.email_signature ?? ""}
                html={me.email_signature_html ?? ""}
                onSave={save}
              />
            </>
          )}
        </CardContent>
      </Card>

      <ClickUpConnectCard />

      <Card>
        <CardHeader>
          <CardTitle>Google Calendar</CardTitle>
          <CardDescription>
            Needed for internal meetings to land on your calendar with a Meet link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link to="/settings/google">
              <CalendarDays className="h-4 w-4" /> Manage Google connection
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={signOutAndLeave}>
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}


/** Email signature: one of two kinds, never both.
 *
 *  HTML mode renders the signature in an iframe you can type straight into.
 *  The sandbox is deliberate and precise: allow-same-origin (so this page can
 *  reach into the document, make it editable and read the edits back out) but
 *  NOT allow-scripts — so script inside an uploaded signature can never run.
 *  Rendering the same HTML into this page's own DOM to get contentEditable
 *  would hand a signature file the run of Conductor.
 */
function SignatureEditor({
  text,
  html,
  onSave,
}: {
  text: string;
  html: string;
  onSave: (patch: { email_signature?: string | null; email_signature_html?: string | null }) => void;
}) {
  const [mode, setMode] = useState<"text" | "html">(html ? "html" : "text");
  const [draftHtml, setDraftHtml] = useState(html);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const MAX_BYTES = 100_000;

  async function onFile(file: File) {
    setUploadError(null);
    if (file.size > MAX_BYTES) {
      setUploadError("That file is over 100KB. Host images at a URL rather than embedding them.");
      return;
    }
    const content = await file.text();
    setDraftHtml(content);
    onSave({ email_signature_html: content });
    toast.success("Signature uploaded");
  }

  /** Make the rendered signature typeable, once the iframe has its content. */
  function onFrameLoad() {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    doc.body.contentEditable = "true";
    doc.body.style.margin = "8px";
    doc.body.style.outline = "none";
    doc.body.addEventListener("blur", () => {
      const edited = doc.body.innerHTML;
      setDraftHtml(edited);
      if (edited !== html) onSave({ email_signature_html: edited });
    }, true);
  }

  function chooseMode(next: "text" | "html") {
    if (next === mode) return;
    setMode(next);
    // One or the other, as asked — the unused one is cleared rather than left
    // behind to be silently appended by some future change.
    if (next === "text") {
      setDraftHtml("");
      onSave({ email_signature_html: null });
    } else {
      onSave({ email_signature: null });
    }
  }

  return (
    <div className="space-y-3">
      <Label>Email signature</Label>

      <div className="flex flex-wrap gap-2">
        {(["text", "html"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => chooseMode(m)}
            className={cn(
              "rounded-full border px-3 py-1 text-label-medium transition-colors",
              mode === m
                ? "border-m-primary bg-m-primary text-m-on-primary"
                : "border-m-outline-variant bg-m-surface text-m-on-surface-variant hover:bg-m-surface-container-high"
            )}
          >
            {m === "text" ? "Plain text" : "HTML"}
          </button>
        ))}
      </div>
      <p className="text-label-small text-m-on-surface-variant">
        One or the other. Switching clears the one you are not using.
      </p>

      {mode === "text" ? (
        <div className="space-y-2">
          <Textarea
            id="profile-signature"
            defaultValue={text}
            rows={4}
            placeholder={"Lisa Zietsman\nConverted Click\n082 000 0000"}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== text) onSave({ email_signature: v || null });
            }}
          />
          <p className="text-label-small text-m-on-surface-variant">
            Added to the bottom of every email you send. Keep it short — name,
            company, number.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="profile-signature-html"
              type="file"
              accept=".html,.htm,text/html"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = "";
              }}
              className="text-label-small file:mr-3 file:rounded-md file:border-0 file:bg-m-secondary-container file:px-3 file:py-1.5 file:text-label-medium file:text-m-on-secondary-container"
            />
            {draftHtml && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraftHtml("");
                  onSave({ email_signature_html: null });
                }}
              >
                Remove
              </Button>
            )}
          </div>
          {uploadError && <p className="text-label-small text-m-error">{uploadError}</p>}

          {draftHtml ? (
            <div className="space-y-2">
              <Label>Edit — click into it and type</Label>
              <iframe
                ref={frameRef}
                title="Email signature"
                sandbox="allow-same-origin"
                srcDoc={draftHtml}
                onLoad={onFrameLoad}
                className="h-56 w-full rounded-md border border-m-outline-variant bg-white"
              />
              <p className="text-label-small text-m-on-surface-variant">
                Type directly on the signature — replace the name, title and numbers.
                It saves when you click away. Images must be absolute https links.
              </p>
              <details>
                <summary className="cursor-pointer text-label-small text-m-on-surface-variant">
                  Edit the HTML source instead
                </summary>
                <Textarea
                  value={draftHtml}
                  onChange={(e) => setDraftHtml(e.target.value)}
                  onBlur={() => {
                    if (draftHtml !== html) onSave({ email_signature_html: draftHtml.trim() || null });
                  }}
                  rows={8}
                  className="mt-2 font-mono text-label-small"
                />
              </details>
            </div>
          ) : (
            <p className="text-label-small text-m-on-surface-variant">
              Upload a .html file, or paste your signature's HTML into the source box
              after uploading. In Gmail you can copy your signature and paste it here.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
