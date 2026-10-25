import React from "react";

import { KEYS, MIME_TYPES } from "@setsquare/common";

import { serializeAsJSON } from "../data/json";
import { Setsquare } from "../index";

import { API } from "./helpers/api";
import { fireEvent, render, screen, waitFor } from "./test-utils";

import type { SetsquareInitialDataState } from "../types";

const { h } = window;

const sceneWith = (id: string) => [
  API.createElement({ type: "rectangle", id }),
];

const elementIds = () =>
  h.elements.filter((element) => !element.isDeleted).map(({ id }) => id);

// like the browser, launches files as soon as a consumer is set
const launch = (id: string) => {
  const file = new File(
    [serializeAsJSON(sceneWith(id), {}, {}, "local")],
    `${id}.setsquare`,
    { type: MIME_TYPES.setsquare },
  );
  const fileHandle = {
    kind: "file",
    name: file.name,
    getFile: async () => file,
  };
  Object.assign(window, {
    launchQueue: {
      setConsumer: (consumer: (params: { files: unknown[] }) => void) =>
        consumer({ files: [fileHandle] }),
    },
    LaunchParams: class {},
  });
};

// the autosaved scene arrives after the launched file has been read
const renderWithAutosave = async (id: string) => {
  const initialData = new Promise<SetsquareInitialDataState>((resolve) =>
    setTimeout(() => resolve({ elements: sceneWith(id) }), 100),
  );
  await render(<Setsquare initialData={initialData} />);
  await initialData;
};

describe("launch queue", () => {
  afterEach(() => {
    delete (window as any).launchQueue;
    delete (window as any).LaunchParams;
  });

  it("loads a launched file into an empty drawing without asking", async () => {
    launch("greendale");

    await render(<Setsquare />);

    await waitFor(() => expect(elementIds()).toEqual(["greendale"]));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("loads a launched file over the initial scene once confirmed", async () => {
    launch("greendale");

    await renderWithAutosave("city-college");

    fireEvent.click(
      await screen.findByRole("button", { name: "Load from file" }),
    );
    await waitFor(() => expect(elementIds()).toEqual(["greendale"]));
  });

  it("keeps the drawing if replacing it is declined", async () => {
    launch("greendale");

    await renderWithAutosave("city-college");

    fireEvent.keyDown(await screen.findByRole("dialog"), {
      key: KEYS.ESCAPE,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(elementIds()).toEqual(["city-college"]);
  });
});
