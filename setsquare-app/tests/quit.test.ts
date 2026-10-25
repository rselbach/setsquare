import { invoke } from "@tauri-apps/api/core";

import { API } from "@setsquare/setsquare/tests/helpers/api";
import { getDefaultAppState } from "@setsquare/setsquare/appState";

import { STORAGE_KEYS } from "../app_constants";
import { LocalData } from "../data/LocalData";
import { quit } from "../desktop/quit";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => {}),
  isTauri: () => false,
}));

describe("quit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("saves the drawing locally before quitting", async () => {
    let finishSavingFiles = () => {};
    vi.spyOn(LocalData.fileStorage, "saveFiles").mockReturnValue(
      new Promise((resolve) => {
        finishSavingFiles = () =>
          resolve({ savedFiles: new Map(), erroredFiles: new Map() });
      }),
    );
    LocalData.save(
      [API.createElement({ type: "rectangle", id: "troy" })],
      getDefaultAppState() as any,
      {},
      () => {},
    );

    const quitting = quit();

    // the save no longer waits for its delay
    expect(localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS)).toContain(
      "troy",
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(invoke).not.toHaveBeenCalled();

    finishSavingFiles();
    await quitting;
    expect(invoke).toHaveBeenCalledWith("quit");
  });
});
