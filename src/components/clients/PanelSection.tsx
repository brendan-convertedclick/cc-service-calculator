import type { ReactNode } from "react";

// One setting inside a section card. The client page used to give each of
// these its own Card, which stacked three or four bordered boxes under a
// heading that was itself outside all of them, so the heading read as
// unrelated to the boxes below it. Now the heading owns the card and these
// are the rules inside it.
export function PanelSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 border-t border-m-outline-variant pt-5 first:border-t-0 first:pt-0">
      <div className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-title-small text-m-on-surface">{title}</h3>
          {description && (
            <p className="text-body-small text-m-on-surface-variant">
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
