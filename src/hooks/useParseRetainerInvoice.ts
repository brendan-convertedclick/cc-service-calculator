import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// One billable line extracted from an uploaded retainer invoice PDF by the
// parse-retainer-invoice edge function (Claude), with a suggested catalogue
// service match. The New Retainer wizard turns each into an editable row.
export type ParsedInvoiceLine = {
  description: string;
  full_description: string;
  qty: number;
  unit_price_cents: number;
  amount_cents: number;
  suggested_service_id: string | null;
  suggested_service_name: string | null;
  match_confidence: "high" | "medium" | "low" | "none";
};

export function useParseRetainerInvoice() {
  return useMutation({
    // Accepts a base64 data URL (or bare base64) of the invoice PDF.
    mutationFn: async (pdfBase64: string): Promise<ParsedInvoiceLine[]> => {
      const { data, error } = await supabase.functions.invoke("parse-retainer-invoice", {
        body: { pdf_base64: pdfBase64 },
      });
      if (error) throw error;
      const body = data as { error?: string; line_items?: ParsedInvoiceLine[] };
      if (body.error) throw new Error(body.error);
      return body.line_items ?? [];
    },
  });
}
