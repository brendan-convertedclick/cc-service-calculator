// The Xero price list, and which Conductor service each product is invoiced as.
//
// Two lists that describe the same business at different grains: 72 sellable
// products against 185 services. Most of the difference is delivery detail
// that never appears on an invoice, which is why this maps rather than copies —
// importing Xero's names as services would have produced ~50 duplicates of
// services that already exist under a different spelling.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface XeroItem {
  code: string;
  name: string;
  priceCents: number;
  status: string;
  /** The Conductor services invoiced as this product. Many to one on purpose:
   *  eight plugin-update services bill as one maintenance line. Xero is the
   *  source of truth for what is quoted and invoiced; services are only how
   *  delivery is tracked against it. */
  services: { id: string; name: string }[];
}

export const XERO_ITEMS_KEY = ["xero_items"] as const;

export function useXeroItems() {
  return useQuery({
    queryKey: XERO_ITEMS_KEY,
    queryFn: async (): Promise<XeroItem[]> => {
      const [items, mapped] = await Promise.all([
        supabase.from("xero_items").select("code, name, sales_unit_price_cents, status").order("name"),
        supabase.from("services").select("id, name, xero_item_code").not("xero_item_code", "is", null),
      ]);
      if (items.error) throw items.error;
      if (mapped.error) throw mapped.error;

      const byCode = new Map<string, { id: string; name: string }[]>();
      for (const s of (mapped.data ?? []) as Array<{ id: string; name: string; xero_item_code: string }>) {
        const list = byCode.get(s.xero_item_code) ?? [];
        list.push({ id: s.id, name: s.name });
        byCode.set(s.xero_item_code, list);
      }
      return (items.data ?? []).map((x) => ({
        code: x.code,
        name: x.name,
        priceCents: x.sales_unit_price_cents ?? 0,
        status: x.status,
        services: (byCode.get(x.code) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
      }));
    },
  });
}

/** The same link made from the service's side: which Xero line this service is
 *  invoiced as. Kept separate from useMapXeroItem so each screen reads in the
 *  direction the person is working. */
export function useSetServiceXeroItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ serviceId, code }: { serviceId: string; code: string | null }) => {
      const { error } = await supabase
        .from("services")
        .update({ xero_item_code: code })
        .eq("id", serviceId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: XERO_ITEMS_KEY });
      qc.invalidateQueries({ queryKey: ["services"] });
    },
  });
}
