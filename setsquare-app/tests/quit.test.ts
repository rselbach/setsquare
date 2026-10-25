import { invoke } from "@tauri-apps/api/core";

import { API } from "@setsquare/setsquare/tests/helpers/api";
import { getDefaultAppState } from "@setsquare/setsquare/appState";

import { STORAGE_KEYS } from "../app_constants";
import { LocalData } from "../data/LocalData";
import { quit } from "../desktop/quit";

// what the app hands the module when it loads in the desktop app
const { handlers } = vi.hoisted(() => ({
  handlers: {} as {
    closeRequested?: (event: { preventDefault: () => void }) => unknown;
    restartRequested?: () => unknown;
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => {}),
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: async (event: string, handler: () => unknown) => {
    if (event === "restart-requested") {
      handlers.restartRequested = handler;
    }
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (
      handler: (event: { preventDefault: () => void }) => unknown,
    ) => {
      handlers.closeRequested = handler;
    },
  }),
}));

// starts a local save whose images are still being stored
const startSaving = () => {
  let finish = () => {};
  vi.spyOn(LocalData.fileStorage, "saveFiles").mockReturnValue(
    new Promise((resolve) => {
      finish = () =>
        resolve({ savedFiles: new Map(), erroredFiles: new Map() });
    }),
  );
  LocalData.save(
    [API.createElement({ type: "rectangle", id: "troy" })],
    getDefaultAppState() as any,
    {},
    () => {},
  );
  return finish;
};

const expectToRunAfterSaving = async (
  start: () => unknown,
  command: string,
) => {
  const finishSaving = startSaving();

  const running = start();

  // the save no longer waits for its delay
  expect(localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_ELEMENTS)).toContain(
    "troy",
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(invoke).not.toHaveBeenCalled();

  finishSaving();
  await running;
  expect(invoke).toHaveBeenCalledWith(command);
};

describe("quitting the desktop app", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(invoke).mockClear();
    localStorage.clear();
  });

  it("saves the drawing locally before quitting", async () => {
    await expectToRunAfterSaving(quit, "quit");
  });

  it("saves the drawing locally before the window closes", async () => {
    const preventDefault = vi.fn();

    await expectToRunAfterSaving(
      () => handlers.closeRequested!({ preventDefault }),
      "quit",
    );
    expect(preventDefault).toHaveBeenCalled();
  });

  it("saves the drawing locally before restarting into an update", async () => {
    await expectToRunAfterSaving(handlers.restartRequested!, "restart");
  });
});
