import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Send, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  interpolate,
  type EmailTemplateRow,
} from "@/types/outbound-emails";

const FUNCTIONS_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

/**
 * Phase 6 — Compose email page. Supports template-assisted and free-form
 * composition. Send routes through send-outbound-email which uses the
 * accountmanager@ Send-as alias.
 */
export function ComposeEmail() {
  const { currentUserId } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const projectId = params.get("project_id") ?? null;
  const clientIdParam = params.get("client_id") ?? null;
  const briefId = params.get("brief_id") ?? null;

  const [templates, setTemplates] = useState<EmailTemplateRow[]>([]);
  const [templateSlug, setTemplateSlug] = useState<string>("");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [driveLink, setDriveLink] = useState("");
  const [approvalLink, setApprovalLink] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [contextClient, setContextClient] = useState<{
    id: string;
    name: string;
    primary_domain: string | null;
  } | null>(null);

  // Load templates + optional client context.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        // @ts-expect-error email_templates added by migration 0056
        .from("email_templates")
        .select("*")
        .order("name");
      if (!cancelled) setTemplates((data ?? []) as unknown as EmailTemplateRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const clientId = clientIdParam;
    if (!clientId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, name, primary_domain")
        .eq("id", clientId)
        .single();
      if (!cancelled && data) setContextClient(data as typeof contextClient);
    })();
    return () => {
      cancelled = true;
    };
  }, [clientIdParam]);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.slug === templateSlug) ?? null,
    [templates, templateSlug],
  );

  const onPickTemplate = (slug: string) => {
    setTemplateSlug(slug);
    const t = templates.find((x) => x.slug === slug);
    if (!t) return;
    const vars: Record<string, string> = {
      client_first_name: contextClient?.name?.split(" ")[0] ?? "{client_first_name}",
      project_name: projectId ? "{project_name}" : "{project_name}",
      drive_link: driveLink || "{drive_link}",
      approval_link: approvalLink || "{approval_link}",
    };
    setSubject(interpolate(t.subject, vars));
    setBody(interpolate(t.body_text, vars));
  };

  const canSubmit = !!currentUserId && to.trim().length > 0 && subject.trim().length > 0 && body.trim().length > 0;

  const saveDraft = async (): Promise<string | null> => {
    if (!currentUserId) return null;
    const payload = {
      project_id: projectId,
      brief_id: briefId,
      client_id: contextClient?.id ?? clientIdParam ?? null,
      composed_by: currentUserId,
      template: templateSlug || null,
      to_addresses: splitAddresses(to),
      cc_addresses: splitAddresses(cc),
      bcc_addresses: [],
      subject,
      body_html: bodyToHtml(body),
      body_text: body,
      drive_link: driveLink || null,
      approval_link: approvalLink || null,
      status: "draft",
    };
    const { data, error } = await supabase
      // @ts-expect-error outbound_emails added by migration 0056
      .from("outbound_emails")
      .insert(payload)
      .select("id")
      .single();
    if (error) {
      toast.error(error.message);
      return null;
    }
    return (data as { id: string }).id;
  };

  const onSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const id = await saveDraft();
      if (!id) return;
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(`${FUNCTIONS_BASE}/send-outbound-email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ outbound_email_id: id }),
      });
      const result = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(result.error ?? "Send failed");
        return;
      }
      toast.success("Email sent.");
      navigate(projectId ? `/projects/${projectId}` : "/");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <Card className="shadow-elev-1">
        <CardHeader>
          <CardTitle className="text-headline-small">Compose email</CardTitle>
          <p className="text-body-small text-m-on-surface-variant">
            Sent from <strong>accountmanager@convertedclick.co.za</strong>
            {contextClient && (
              <>
                {" · "}context: <strong>{contextClient.name}</strong>
              </>
            )}
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSend} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[200px,1fr]">
              <div className="space-y-2">
                <Label htmlFor="ce-template">Template</Label>
                <Select value={templateSlug} onValueChange={onPickTemplate}>
                  <SelectTrigger id="ce-template">
                    <SelectValue placeholder="Blank" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.slug} value={t.slug}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ce-to">To</Label>
                <Input
                  id="ce-to"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="recipient@example.com, other@example.com"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ce-cc">Cc (optional)</Label>
              <Input
                id="ce-cc"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder="cc@example.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ce-subject">Subject</Label>
              <Input id="ce-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ce-drive">Drive folder link</Label>
                <Input
                  id="ce-drive"
                  value={driveLink}
                  onChange={(e) => setDriveLink(e.target.value)}
                  placeholder="https://drive.google.com/…"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ce-approval">Approval link</Label>
                <Input
                  id="ce-approval"
                  value={approvalLink}
                  onChange={(e) => setApprovalLink(e.target.value)}
                  placeholder="https://approve.convertedclick.co.za/…"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ce-body">Body</Label>
              <Textarea
                id="ce-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={12}
                className="font-mono"
              />
              <p className="text-label-small text-m-on-surface-variant">
                Plain text. Placeholders like {`{drive_link}`} are interpolated when the
                template is picked. Edit freely after.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={submitting || !canSubmit}
                onClick={async () => {
                  await saveDraft();
                  toast.success("Draft saved.");
                }}
                className="gap-2"
              >
                <Save className="h-4 w-4" />
                Save draft
              </Button>
              <Button type="submit" disabled={!canSubmit || submitting} className="gap-2">
                <Send className="h-4 w-4" />
                {submitting ? "Sending…" : "Send"}
              </Button>
            </div>

            {selectedTemplate && (
              <p className="text-label-small text-m-on-surface-variant">
                Using template <strong>{selectedTemplate.name}</strong> · variables:{" "}
                {selectedTemplate.variables.join(", ")}
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function splitAddresses(s: string): string[] {
  return s
    .split(/[,\n;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Tiny text-to-HTML conversion: paragraphs from blank lines, line breaks
 * from single newlines, URLs left as bare text (Gmail auto-links).
 */
function bodyToHtml(text: string): string {
  const paragraphs = text.split(/\n\n+/);
  return paragraphs
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default ComposeEmail;
