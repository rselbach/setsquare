import { fireEvent, render, screen } from "@testing-library/react";

import { TextField } from "./TextField";

it("names each field through its visible label", () => {
  render(
    <>
      <TextField label="Troy Barnes" value="Troy" />
      <TextField label="Abed Nadir" value="Abed" />
    </>,
  );
  expect(screen.getByRole("textbox", { name: "Troy Barnes" })).toHaveValue(
    "Troy",
  );
  expect(screen.getByRole("textbox", { name: "Abed Nadir" })).toHaveValue(
    "Abed",
  );
});

it("names the visibility toggle and exposes its state", () => {
  render(<TextField label="Greendale" value="secret" isRedacted />);
  const toggle = screen.getByRole("button", { name: "Show value" });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(toggle);
  expect(screen.getByRole("button", { name: "Hide value" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
