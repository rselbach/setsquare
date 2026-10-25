import { useState } from "react";

import { THEME } from "@setsquare/common";
import { Setsquare } from "@setsquare/setsquare";
import * as filesystemModule from "@setsquare/setsquare/data/filesystem";
import { API } from "@setsquare/setsquare/tests/helpers/api";
import { act, render, waitFor } from "@setsquare/setsquare/tests/test-utils";

import type { Theme } from "@setsquare/element/types";

import { DesktopMenu } from "../desktop/DesktopMenu";

// stands in for the native menu bar, keeping each item by its ID
const { items, menuBuilt } = vi.hoisted(() => ({
  items: new Map<
    string,
    {
      text: string;
      enabled: boolean;
      checked: boolean;
      checkable?: boolean;
      action?: (id: string) => void;
    }
  >(),
  // lets a test change editor state while the bar is being built
  menuBuilt: { current: Promise.resolve() },
}));

vi.mock("@tauri-apps/api/menu", () => {
  class Item {
    id: string;
    text: string;
    enabled: boolean;
    checked: boolean;
    action?: (id: string) => void;

    constructor(options: {
      id: string;
      text: string;
      enabled?: boolean;
      checked?: boolean;
      action?: (id: string) => void;
    }) {
      this.id = options.id;
      this.text = options.text;
      this.enabled = options.enabled ?? true;
      this.checked = options.checked ?? false;
      this.action = options.action;
      items.set(this.id, this);
    }

    static async new(options: any) {
      return new this(options);
    }

    async setText(text: string) {
      this.text = text;
    }

    async setEnabled(enabled: boolean) {
      this.enabled = enabled;
    }

    async setChecked(checked: boolean) {
      this.checked = checked;
    }
  }

  class Submenu extends Item {
    async setAsWindowsMenuForNSApp() {}
    async setAsHelpMenuForNSApp() {}
  }

  return {
    MenuItem: class extends Item {},
    CheckMenuItem: class extends Item {
      checkable = true;
    },
    Submenu,
    PredefinedMenuItem: { new: async () => ({}) },
    Menu: {
      new: async () => {
        await menuBuilt.current;
        return { setAsAppMenu: async () => {} };
      },
    },
  };
});

const { h } = window;

const item = (id: string) => {
  const found = items.get(id);
  if (!found) {
    throw new Error(`no menu item "${id}"`);
  }
  return found;
};

// what macOS does when a menu item is clicked: a check item flips its own
// mark before the app hears of the click
const click = (id: string) => {
  const clicked = item(id);
  if (clicked.checkable) {
    clicked.checked = !clicked.checked;
  }
  act(() => clicked.action!(id));
};

const App = () => {
  const [theme, setTheme] = useState<Theme | "system">(THEME.LIGHT);
  return (
    <Setsquare theme={theme === "system" ? undefined : theme}>
      <DesktopMenu theme={theme} setTheme={setTheme} />
    </Setsquare>
  );
};

const renderMenu = async () => {
  await render(<App />);
  await waitFor(() => expect(items.has("save")).toBe(true));
};

describe("DesktopMenu", () => {
  beforeEach(() => {
    items.clear();
    menuBuilt.current = Promise.resolve();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("File > Save", () => {
    it("saves an untitled drawing as a new file", async () => {
      await renderMenu();
      const fileSave = vi
        .spyOn(filesystemModule, "fileSave")
        .mockResolvedValue(null);

      expect(item("save").enabled).toBe(true);
      click("save");

      await waitFor(() => expect(fileSave).toHaveBeenCalled());
      expect(fileSave.mock.calls[0][1].fileHandle).toBe(null);
    });

    it("saves a drawing back to its file", async () => {
      await renderMenu();
      const fileHandle = {
        kind: "file",
        name: "greendale.setsquare",
      } as FileSystemFileHandle;
      act(() => API.setAppState({ fileHandle }));
      const fileSave = vi
        .spyOn(filesystemModule, "fileSave")
        .mockResolvedValue(fileHandle);

      click("save");

      await waitFor(() => expect(fileSave).toHaveBeenCalled());
      expect(fileSave.mock.calls[0][1].fileHandle).toBe(fileHandle);
      expect(h.state.fileHandle).toBe(fileHandle);
    });
  });

  describe("check marks", () => {
    it("stay on the selected theme when it is clicked again", async () => {
      await renderMenu();
      expect(item("theme-light").checked).toBe(true);

      click("theme-light");

      await waitFor(() => expect(item("theme-light").checked).toBe(true));
    });

    it("follow the theme picked", async () => {
      await renderMenu();

      click("theme-dark");

      await waitFor(() => {
        expect(item("theme-dark").checked).toBe(true);
        expect(item("theme-light").checked).toBe(false);
      });
    });

    it("don't flip for a toggle that view mode blocks", async () => {
      await renderMenu();
      act(() => API.setAppState({ viewModeEnabled: true }));
      const showHints = h.state.showHints;
      await waitFor(() => expect(item("show-hints").checked).toBe(showHints));

      click("show-hints");

      await waitFor(() => expect(item("show-hints").checked).toBe(showHints));
      expect(h.state.showHints).toBe(showHints);
    });

    it("show state that changed while the bar was being built", async () => {
      let finishBuilding = () => {};
      menuBuilt.current = new Promise((resolve) => {
        finishBuilding = resolve;
      });
      await render(<App />);
      await waitFor(() => expect(items.has("grid")).toBe(true));
      expect(item("grid").checked).toBe(false);

      act(() => API.setAppState({ gridModeEnabled: true }));
      await act(async () => finishBuilding());

      await waitFor(() => expect(item("grid").checked).toBe(true));
    });
  });
});
