import { API } from "@setsquare/setsquare/tests/helpers/api";
import { act, render, waitFor } from "@setsquare/setsquare/tests/test-utils";

import SetsquareApp from "../App";
import { STORAGE_KEYS } from "../app_constants";

const testEnv = vi.hoisted(() => ({ enabled: true }));

// tab sync is off in tests, so turn it on while the test syncs
vi.mock("@setsquare/common", async (importOriginal) => {
  const module = await importOriginal<typeof import("@setsquare/common")>();
  const { mockThrottleRAF } = await import(
    "@setsquare/setsquare/tests/helpers/mocks"
  );
  return {
    ...module,
    throttleRAF: mockThrottleRAF,
    isTestEnv: () => testEnv.enabled,
  };
});

// the native menu bar needs the desktop app itself; DesktopMenu.test covers it
vi.mock("../desktop/DesktopMenu", () => ({ DesktopMenu: () => null }));

const { h } = window;

// the single scene's tab sync; the web app syncs each drawing's revision
describe("tab sync", () => {
  beforeEach(() => {
    Object.assign(window, { isTauri: true });
  });

  afterEach(() => {
    delete (window as any).isTauri;
  });

  it("keeps the tab's file handle when another tab saved the scene", async () => {
    await render(<SetsquareApp />);
    const fileHandle = { name: "Greendale.setsquare" } as any;
    act(() => {
      h.setState({ fileHandle });
    });

    // another tab saves its scene
    const rect = API.createElement({ type: "rectangle", id: "shirley" });
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS,
      JSON.stringify([rect]),
    );
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_APP_STATE,
      JSON.stringify({ name: "Study group" }),
    );
    localStorage.setItem(
      STORAGE_KEYS.VERSION_DATA_STATE,
      JSON.stringify(Date.now()),
    );

    testEnv.enabled = false;
    try {
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      await waitFor(() =>
        expect(h.elements.map((element) => element.id)).toEqual(["shirley"]),
      );
    } finally {
      testEnv.enabled = true;
    }

    expect(h.state.name).toBe("Study group");
    expect(h.state.fileHandle).toBe(fileHandle);
  });
});
