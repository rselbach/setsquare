import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { useState } from "react";

import { KEYS, THEME } from "@setsquare/common";

import { defaultLang, setLanguage, useI18n } from "../i18n";

import ConfirmDialog from "./ConfirmDialog";
import { Dialog } from "./Dialog";
import { StandaloneUIProvider } from "./StandaloneUIProvider";
import DropdownMenu from "./dropdownMenu/DropdownMenu";

const { innerWidth, innerHeight } = window;

const resizeWindow = (width: number, height: number) =>
  act(() => {
    Object.assign(window, { innerWidth: width, innerHeight: height });
    window.dispatchEvent(new Event("resize"));
  });

const Label = () => {
  const { t } = useI18n();
  return <p data-testid="label">{t("buttons.close")}</p>;
};

const Menu = ({ onSelect }: { onSelect: () => void }) => {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open}>
      <DropdownMenu.Trigger onToggle={() => setOpen(!open)}>
        Study group
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        onClickOutside={() => setOpen(false)}
        onSelect={() => setOpen(false)}
      >
        <DropdownMenu.Item onSelect={onSelect}>Paintball</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
};

afterEach(async () => {
  await resizeWindow(innerWidth, innerHeight);
  await act(() => setLanguage(defaultLang));
  vi.restoreAllMocks();
});

describe("<StandaloneUIProvider/>", () => {
  it("renders a Dialog in a portal of its own, in the theme", async () => {
    const warn = vi.spyOn(console, "warn");
    const onCloseRequest = vi.fn();
    const { container } = render(
      <StandaloneUIProvider theme={THEME.DARK} langCode="en">
        <Dialog title="Greendale" onCloseRequest={onCloseRequest}>
          Troy and Abed in the morning
        </Dialog>
      </StandaloneUIProvider>,
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Troy and Abed in the morning");
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.closest(".setsquare-modal-container")).toHaveClass(
      "setsquare",
      "theme--dark",
    );
    expect(container.firstElementChild).toHaveClass("setsquare", "theme--dark");

    fireEvent.keyDown(dialog, { key: KEYS.ESCAPE });

    expect(onCloseRequest).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("renders a ConfirmDialog that confirms and cancels", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <StandaloneUIProvider theme={THEME.LIGHT} langCode="en">
        <ConfirmDialog
          title="Delete the study room?"
          onConfirm={onConfirm}
          onCancel={onCancel}
        >
          Pierce will notice.
        </ConfirmDialog>
      </StandaloneUIProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders a DropdownMenu that opens and selects", async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <StandaloneUIProvider theme={THEME.LIGHT} langCode="en">
        <Menu onSelect={onSelect} />
      </StandaloneUIProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Study group" }));
    const menu = await screen.findByTestId("dropdown-menu");
    expect(container.contains(menu)).toBe(true);
    expect(menu).not.toHaveClass("dropdown-menu--mobile");

    fireEvent.click(screen.getByRole("menuitem", { name: "Paintball" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("dropdown-menu")).toBe(null);
  });

  it("follows the window to a phone's form factor", async () => {
    const { container } = render(
      <StandaloneUIProvider theme={THEME.LIGHT} langCode="en">
        <Dialog title="Greendale" onCloseRequest={() => {}}>
          Señor Chang
        </Dialog>
      </StandaloneUIProvider>,
    );
    expect(await screen.findByRole("dialog")).not.toHaveClass(
      "Dialog--fullscreen",
    );

    await resizeWindow(390, 844);

    expect(container.firstElementChild).toHaveClass("setsquare--mobile");
    expect(screen.getByRole("dialog")).toHaveClass("Dialog--fullscreen");
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("loads the language and follows its changes and direction", async () => {
    const ui = (langCode: string) => (
      <StandaloneUIProvider theme={THEME.LIGHT} langCode={langCode}>
        <Label />
      </StandaloneUIProvider>
    );
    const { container, rerender } = render(ui("he-IL"));

    // shown once the language has loaded
    const label = await screen.findByTestId("label");
    expect(label).not.toHaveTextContent("Close");
    expect(container.firstElementChild).toHaveAttribute("dir", "rtl");
    expect(document.documentElement.lang).toBe("he-IL");

    rerender(ui("en"));

    await waitFor(() => expect(label).toHaveTextContent("Close"));
    expect(container.firstElementChild).toHaveAttribute("dir", "ltr");
  });
});
