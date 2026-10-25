import React from "react";

import {
  actionSaveFileToDisk,
  actionSaveToActiveFile,
} from "../actions/actionExport";
import * as filesystemModule from "../data/filesystem";
import { Setsquare } from "../index";

import { API } from "./helpers/api";
import { act, render, waitFor } from "./test-utils";

const { h } = window;

const fileHandle = { kind: "file", name: "greendale.setsquare" } as any;

describe("saving", () => {
  beforeEach(async () => {
    await render(<Setsquare />);
    API.setElements([API.createElement({ type: "rectangle", id: "troy" })]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tells the user when saving to the open file fails", async () => {
    API.setAppState({ fileHandle });
    vi.spyOn(filesystemModule, "fileSave").mockRejectedValue(
      "No space left on device (os error 28)",
    );

    act(() => {
      h.app.actionManager.executeAction(actionSaveToActiveFile);
    });

    await waitFor(() =>
      expect(h.state.errorMessage).toBe(
        "Couldn't save the file: No space left on device (os error 28)",
      ),
    );
    expect(h.state.fileHandle).toBe(fileHandle);
  });

  it("tells the user when saving to a new file fails", async () => {
    vi.spyOn(filesystemModule, "fileSave").mockRejectedValue(
      new Error("Permission denied"),
    );

    act(() => {
      h.app.actionManager.executeAction(actionSaveFileToDisk);
    });

    await waitFor(() =>
      expect(h.state.errorMessage).toBe(
        "Couldn't save the file: Permission denied",
      ),
    );
  });

  it("says nothing when the user cancels", async () => {
    const fileSave = vi
      .spyOn(filesystemModule, "fileSave")
      .mockRejectedValue(new DOMException("Cancelled", "AbortError"));

    act(() => {
      h.app.actionManager.executeAction(actionSaveFileToDisk);
    });

    await waitFor(() => expect(fileSave).toHaveBeenCalled());
    await act(() => Promise.resolve());
    expect(h.state.errorMessage).toBe(null);
  });
});
