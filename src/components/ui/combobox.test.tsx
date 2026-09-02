import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Combobox } from "./combobox";

/** Every caller passes an id as `value` and a human name as `label`. cmdk
 *  filters on `value`, so searching by name only works because the Combobox
 *  feeds the label through `keywords`. These pin that: without it, typing a
 *  name scores 0 against a UUID and the picker falls through to its empty
 *  state — which is how "I can't find Kings College" happened. */
const OPTIONS = [
  { value: "8fa21f43-591f-494e-9c19-971c6bbdc141", label: "Kings College" },
  { value: "049f0c57-5d6c-424b-90a9-ad83a5cd6436", label: "A Love Supreme" },
  { value: "56664650-d0a8-4847-80b6-914ef8bdf1ab", label: "Dovetail RSA" },
];

async function openPicker() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox"));
  return user;
}

describe("Combobox", () => {
  it("finds an option by typing its label, even though value is an id", async () => {
    render(<Combobox options={OPTIONS} value="" onChange={vi.fn()} />);
    const user = await openPicker();

    await user.type(screen.getByPlaceholderText("Select…"), "kings");

    expect(screen.getByText("Kings College")).toBeInTheDocument();
    expect(screen.queryByText("A Love Supreme")).not.toBeInTheDocument();
  });

  it("selects by id, not by the text that was searched", async () => {
    const onChange = vi.fn();
    render(<Combobox options={OPTIONS} value="" onChange={onChange} />);
    const user = await openPicker();

    await user.type(screen.getByPlaceholderText("Select…"), "dovetail");
    await user.click(screen.getByText("Dovetail RSA"));

    expect(onChange).toHaveBeenCalledWith("56664650-d0a8-4847-80b6-914ef8bdf1ab");
  });

  it("shows the empty label only when nothing genuinely matches", async () => {
    render(
      <Combobox options={OPTIONS} value="" onChange={vi.fn()} emptyLabel="No clients available" />,
    );
    const user = await openPicker();

    await user.type(screen.getByPlaceholderText("Select…"), "zzzz");
    expect(screen.getByText("No clients available")).toBeInTheDocument();
  });

  it("displays the label of the current value, not the id", () => {
    render(<Combobox options={OPTIONS} value={OPTIONS[0].value} onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Kings College");
  });
});
