import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClientSelectField } from "./ClientSelectField";

describe("ClientSelectField", () => {
  it("shows the Client label and placeholder, keyed to the given id", () => {
    render(
      <ClientSelectField
        id="brief-client"
        clients={[{ id: "c1", name: "Acme" }]}
        value=""
        onValueChange={vi.fn()}
      />,
    );
    const label = screen.getByText("Client");
    expect(label).toBeInTheDocument();
    expect(label).toHaveAttribute("for", "brief-client");
    expect(screen.getByText("Pick a client")).toBeInTheDocument();
  });
});
