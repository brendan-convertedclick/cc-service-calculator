// /services/xero — pair each Xero product with the service it is invoiced as.
//
// Deliberately a mapping screen rather than an import. Xero sells 72 things;
// Conductor tracks 185. Copying one list into the other would have created ~50
// duplicates of services that already exist under a different spelling, and
// left nobody able to say which of the two to quote from.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatZar } from "@/lib/utils";
import { useXeroItems } from "@/hooks/useXeroItems";

type Filter = "all" | "unmapped" | "mapped";

export function XeroMapping() {
  const { data: items = [], isLoading } = useXeroItems();
  const [filter, setFilter] = useState<Filter>("unmapped");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    return items.filter((i) => {
      if (filter === "unmapped" && i.services.length > 0) return false;
      if (filter === "mapped" && i.services.length === 0) return false;
      if (q && !`${i.code} ${i.name}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [items, filter, q]);

  const mappedCount = items.filter((i) => i.services.length > 0).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-headline-medium">Xero products</h1>
        <p className="mt-1 text-body-small text-m-on-surface-variant">
          Xero is the source of truth for what we quote and invoice. Every product
          here is an invoice line. Several services can bill as the same line —
          set that from the Services page; this shows what each line covers, and
          which lines nothing delivers yet.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["unmapped", "mapped", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full border px-3 py-1 text-label-medium transition-colors",
              filter === f
                ? "border-m-primary bg-m-primary text-m-on-primary"
                : "border-m-outline-variant bg-m-surface text-m-on-surface-variant hover:bg-m-surface-container-high",
            )}
          >
            {f === "unmapped" ? `Not yet paired · ${items.length - mappedCount}` : f === "mapped" ? `Paired · ${mappedCount}` : `All · ${items.length}`}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search…"
          aria-label="Search Xero products"
          className="ml-auto h-8 w-56 rounded-md border border-m-outline bg-m-surface px-2 text-body-small"
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-title-medium">
            {rows.length} product{rows.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {isLoading ? (
            <p className="px-5 py-4 text-body-small text-m-on-surface-variant">Loading…</p>
          ) : (
            <table className="w-full min-w-[760px] text-xs">
              <thead>
                <tr className="text-left uppercase text-muted-foreground">
                  <th className="w-20 border-b px-3 py-2.5">Code</th>
                  <th className="min-w-[240px] border-b px-3 py-2.5">Invoice line (Xero)</th>
                  <th className="w-24 border-b px-3 py-2.5 text-right">Price</th>
                  <th className="w-[280px] border-b px-3 py-2.5">Delivered by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.code} className="group">
                    <td className="border-b px-3 py-2 font-mono text-muted-foreground">{i.code}</td>
                    <td className="border-b px-3 py-2">
                      {i.name}
                      {i.status !== "Active" && (
                        <Badge variant="outline" className="ml-2 text-[10px]">{i.status}</Badge>
                      )}
                    </td>
                    <td className="border-b px-3 py-2 text-right font-mono tabular-nums">
                      {i.priceCents ? formatZar(i.priceCents) : "—"}
                    </td>
                    <td className="border-b px-3 py-2">
                      {i.services.length === 0 ? (
                        <span className="text-m-on-surface-variant">— nothing yet</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {i.services.map((sv) => (
                            <Link
                              key={sv.id}
                              to={`/services/${sv.id}`}
                              className="rounded-md bg-m-surface-container-high px-1.5 py-0.5 hover:underline"
                            >
                              {sv.name}
                            </Link>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <p className="text-label-small text-m-on-surface-variant">
        The name on the left is what the client sees on their invoice. Services are
        only how we track delivering it — renaming one never changes an invoice.
        Set the link on the{" "}
        <Link to="/services" className="underline">Services page</Link>.
      </p>
    </div>
  );
}

export default XeroMapping;
