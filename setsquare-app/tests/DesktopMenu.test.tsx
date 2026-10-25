import { useState } from "react";

import { THEME } from "@setsquare/common";
import { Setsquare } from "@setsquare/setsquare";
import * as filesystemModule from "@setsquare/setsquare/data/filesystem";
import { API } from "@setsquare/setsquare/tests/helpers/api";
import { act, render, waitFor } from "@setsquare/setsquare/tests/test-utils";

import type { Theme } from "@setsquare/element/types";

import { DesktopMenu } from "../desktop/DesktopMenu";

// stands in for the native menu bar, keeping each item by its ID
const { items } = vi.hoisted(() => ({
  items: new Map<
    string,
    {
      text: string;
      enabled: boolean;
      checked: boolean;
      action?: (id: string) => void;
    }
  >(),
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
    CheckMenuItem: class extends Item {},
    Submenu,
    PredefinedMenuItem: { new: async () => ({}) },
    Menu: { new: async () => ({ setAsAppMenu: async () => {} }) },
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

// what macOS does when a menu item is clicked
const click = (id: string) => {
  const clicked = item(id);
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
});
