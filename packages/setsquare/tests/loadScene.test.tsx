import React from "react";

import { KEYS, MIME_TYPES } from "@setsquare/common";

import * as filesystemModule from "../data/filesystem";
import { serializeAsJSON } from "../data/json";
import { Setsquare } from "../index";

import { API } from "./helpers/api";
import { Keyboard } from "./helpers/ui";
import { act, fireEvent, render, screen, waitFor } from "./test-utils";

const { h } = window;

const elementIds = () =>
  h.elements.filter((element) => !element.isDeleted).map(({ id }) => id);

const openFile = (id: string) =>
  vi
    .spyOn(filesystemModule, "fileOpen")
    .mockResolvedValue(
      new File(
        [
          serializeAsJSON(
            [API.createElement({ type: "rectangle", id })],
            {},
            {},
            "local",
          ),
        ],
        `${id}.setsquare`,
        { type: MIME_TYPES.setsquare },
      ) as any,
    );

const pressOpen = () =>
  act(() => {
    Keyboard.withModifierKeys({ ctrl: true }, () => {
      Keyboard.keyPress(KEYS.O);
    });
  });

describe("loading a drawing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens without asking when the drawing is empty", async () => {
    await render(<Setsquare handleKeyboardGlobally />);
    const fileOpen = openFile("greendale");

    pressOpen();

    await waitFor(() => expect(elementIds()).toEqual(["greendale"]));
    expect(fileOpen).toHaveBeenCalled();
  });

  it("asks before replacing a drawing, and keeps it if declined", async () => {
    await render(<Setsquare handleKeyboardGlobally />);
    API.setElements([API.createElement({ type: "ellipse", id: "troy" })]);
    const fileOpen = openFile("greendale");

    pressOpen();

    const dialog = await screen.findByRole("dialog");
    expect(fileOpen).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: KEYS.ESCAPE });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fileOpen).not.toHaveBeenCalled();
    expect(elementIds()).toEqual(["troy"]);
  });

  it("replaces a drawing once confirmed", async () => {
    await render(<Setsquare handleKeyboardGlobally />);
    API.setElements([API.createElement({ type: "ellipse", id: "troy" })]);
    openFile("greendale");

    pressOpen();

    fireEvent.click(
      await screen.findByRole("button", { name: "Load from file" }),
    );

    await waitFor(() => expect(elementIds()).toEqual(["greendale"]));
  });
});
