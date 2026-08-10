import DOMPurify from "dompurify";
import type { BriefMessage } from "@/hooks/useBriefMessages";

const ALLOWED_TAGS = [
  "a","p","br","strong","em","u","ul","ol","li","blockquote","pre","code",
  "img","table","thead","tbody","tr","td","th",
];

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, FORCE_BODY: true });
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString("en-ZA");
}

export function MessageItem({ message }: { message: BriefMessage }) {
  const { direction, from_email, from_name, body_html, body_text, sent_at, relayed_by, attachments } = message;

  const senderLabel = from_name ?? from_email ?? "Unknown";
  const time = relativeTime(sent_at);

  const files = Array.isArray(attachments)
    ? (attachments as unknown[]).filter(
        (f): f is { name: string; storage_path: string; mime: string; size: number } =>
          typeof f === "object" && f !== null && "name" in f && "size" in f,
      )
    : [];

  if (direction === "note") {
    return (
      <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3" data-variant="note">
        <div className="mb-1 text-label-small text-yellow-800">
          {relayed_by ?? "team"} · {time}
        </div>
        <div className="text-body-medium text-yellow-900 whitespace-pre-wrap">{body_text}</div>
      </div>
    );
  }

  const isOutbound = direction === "outbound";

  return (
    <div className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[80%] rounded-lg p-3 ${isOutbound ? "bg-m-primary-container" : "bg-m-surface-container"}`}>
        <div className={`mb-1 text-label-small text-m-on-surface-variant flex gap-2 ${isOutbound ? "justify-end" : "justify-start"}`}>
          <span>{isOutbound ? (relayed_by ?? "You") : senderLabel}</span>
          <span>·</span>
          <span>{time}</span>
        </div>

        {body_html ? (
          <div
            className="email-body text-body-medium"
            dangerouslySetInnerHTML={{ __html: sanitize(body_html) }}
          />
        ) : (
          <div className="text-body-medium whitespace-pre-wrap">{body_text}</div>
        )}

        {files.length > 0 && (
          <div className="mt-2 space-y-1">
            {files.map((f) => (
              <div key={f.storage_path} className="text-label-small text-m-on-surface-variant">
                📎 {f.name} ({Math.round(f.size / 1024)}KB)
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
