import { ChevronDown } from "lucide-react";

export function ScopeSidebar({
  prose,
  inMd,
  outMd,
  qMd,
}: {
  prose: string | null;
  inMd: string | null;
  outMd: string | null;
  qMd: string | null;
}) {
  const sections = [
    { title: "In scope", body: inMd },
    { title: "Out of scope", body: outMd },
    { title: "Open questions", body: qMd },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-label-small uppercase tracking-wider text-m-on-surface-variant">
          Locked scope
        </div>
      </div>
      {prose && (
        <p className="text-body-medium leading-relaxed text-m-on-surface">{prose}</p>
      )}
      <div className="space-y-1">
        {sections.map((s) =>
          s.body?.trim() ? (
            <details
              key={s.title}
              open
              className="group rounded-xl border border-m-outline-variant bg-m-surface"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2">
                <span className="text-title-small">{s.title}</span>
                <ChevronDown className="h-4 w-4 shrink-0 text-m-on-surface-variant transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t border-m-outline-variant px-3 py-2">
                <pre className="whitespace-pre-wrap font-sans text-body-small leading-relaxed text-m-on-surface">
                  {s.body}
                </pre>
              </div>
            </details>
          ) : null,
        )}
      </div>
    </div>
  );
}
