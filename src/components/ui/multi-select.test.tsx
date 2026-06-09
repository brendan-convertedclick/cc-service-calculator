import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { MultiSelect } from "./multi-select";

const options = [
  { value: "a", label: "Creative Production", count: 18 },
  { value: "b", label: "SEO", count: 13 },
  { value: "__none__", label: "Uncategorized", count: 34 },
];

describe("MultiSelect", () => {
  it("shows the placeholder when nothing is selected", () => {
    render(<MultiSelect options={options} values={[]} onChange={() => {}} placeholder="All groups" />);
    expect(screen.getByRole("combobox")).toHaveTextContent("All groups");
  });

  it("shows the single selected label", () => {
    render(<MultiSelect options={options} values={["b"]} onChange={() => {}} placeholder="All groups" />);
    expect(screen.getByRole("combobox")).toHaveTextContent("SEO");
  });

  it("shows a count when multiple are selected", () => {
    render(<MultiSelect options={options} values={["a", "b"]} onChange={() => {}} placeholder="All groups" />);
    expect(screen.getByRole("combobox")).toHaveTextContent("2 selected");
  });

  it("toggles a value on without closing and keeps existing selection", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MultiSelect options={options} values={["a"]} onChange={onChange} placeholder="All groups" />);
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText("SEO"));
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining(["a", "b"]));
    expect(screen.getByText("Uncategorized")).toBeInTheDocument(); // list still open
  });

  it("toggles a selected value off", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MultiSelect options={options} values={["a", "b"]} onChange={onChange} placeholder="All groups" />);
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText("Creative Production"));
    expect(onChange).toHaveBeenCalledWith(["b"]);
  });

  it("clears the selection via the clear item", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MultiSelect options={options} values={["a", "b"]} onChange={onChange} placeholder="All groups" />);
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText("Clear selection"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("renders option counts", async () => {
    const user = userEvent.setup();
    render(<MultiSelect options={options} values={[]} onChange={() => {}} placeholder="All groups" />);
    await user.click(screen.getByRole("combobox"));
    expect(await screen.findByText("34")).toBeInTheDocument();
  });
});
