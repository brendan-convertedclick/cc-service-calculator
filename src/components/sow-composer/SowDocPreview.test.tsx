import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { resolveSowDocument } from "@/lib/sow-doc";
import { REGISTRY, SINGLE_SERVICE_TABLE } from "@/test/fixtures/sow";
import { SowDocPreview } from "./SowDocPreview";

describe("SowDocPreview", () => {
  it("renders the billable subtotal and grand total incl VAT from the resolver", () => {
    const r = resolveSowDocument({
      body: SINGLE_SERVICE_TABLE.doc.body,
      registry: REGISTRY,
      clientOverrides: { "client.name": "Client A Pty" },
    });

    render(
      <SowDocPreview
        sections={r.doc.sections}
        bag={r.bag}
        billableTotalCents={r.billableTotalCents}
      />,
    );

    // data-cents carries the exact integer so assertions are locale-proof.
    expect(screen.getByTestId("sow-total")).toHaveAttribute("data-cents", "230000");
    expect(screen.getByTestId("section-subtotal-svc-1")).toHaveAttribute("data-cents", "200000");
    // the prose merge-field chip shows the per-client override value
    expect(screen.getByTestId("chip-client.name")).toHaveTextContent("Client A Pty");
  });
});
