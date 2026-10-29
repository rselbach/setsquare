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

const drawing = (id: string) =>
  new File(
    [serializeAsJSON(sceneWith(id), {}, {}, "local")],
    `${id}.setsquare`,
    { type: MIME_TYPES.setsquare },
  );

const handleFor = (file: File) => ({
  kind: "file",
  name: file.name,
  getFile: async () => file,
});

// like the browser, launches files as soon as a consumer is set
const launch = (...fileHandles: unknown[]) => {
  Object.assign(window, {
    launchQueue: {
      setConsumer: (consumer: (params: { files: unknown[] }) => void) =>
        consumer({ files: fileHandles }),
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
  afterEach(async () => {
    delete (window as any).launchQueue;
    delete (window as any).LaunchParams;
    await h.app.library.resetLibrary();
  });

  it("loads a launched file into an empty drawing without asking", async () => {
    launch(handleFor(drawing("greendale")));

    await render(<Setsquare />);

    await waitFor(() => expect(elementIds()).toEqual(["greendale"]));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("loads a launched file over the initial scene once confirmed", async () => {
    launch(handleFor(drawing("greendale")));

    await renderWithAutosave("city-college");

    fireEvent.click(
      await screen.findByRole("button", { name: "Load from file" }),
    );
    await waitFor(() => expect(elementIds()).toEqual(["greendale"]));
  });

  it("keeps the drawing if replacing it is declined", async () => {
    launch(handleFor(drawing("greendale")));

    await renderWithAutosave("city-college");

    fireEvent.keyDown(await screen.findByRole("dialog"), {
      key: KEYS.ESCAPE,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(elementIds()).toEqual(["city-college"]);
  });

  it("loads a drawing and a library launched together", async () => {
    launch(
      handleFor(drawing("greendale")),
      handleFor(await API.loadFile("./fixtures/fixture_library.setsquarelib")),
    );

    await render(<Setsquare />);

    await waitFor(async () => {
      expect(elementIds()).toEqual(["greendale"]);
      expect(await h.app.library.getLatestLibrary()).toHaveLength(1);
    });
  });

  it("takes launches, and lets go of them when it unmounts", async () => {
    const setConsumer = vi.fn();
    Object.assign(window, {
      launchQueue: { setConsumer },
      LaunchParams: class {},
    });

    const { unmount } = await render(<Setsquare />);
    expect(setConsumer).toHaveBeenCalledTimes(1);
    unmount();

    expect(setConsumer).toHaveBeenCalledTimes(2);
  });

  it("leaves launches to a host that doesn't let it load scenes", async () => {
    const setConsumer = vi.fn();
    Object.assign(window, {
      launchQueue: { setConsumer },
      LaunchParams: class {},
    });

    const { unmount } = await render(
      <Setsquare UIOptions={{ canvasActions: { loadScene: false } }} />,
    );
    unmount();

    expect(setConsumer).not.toHaveBeenCalled();
  });

  it("reports a file it can't read and still loads the others", async () => {
    launch(
      {
        kind: "file",
        name: "abed.setsquare",
        getFile: () => Promise.reject(new Error("permission denied")),
      },
      handleFor(drawing("greendale")),
    );

    await render(<Setsquare />);

    await waitFor(() => expect(elementIds()).toEqual(["greendale"]));
    expect(h.state.errorMessage).toBe('Couldn\'t open "abed.setsquare".');
  });
});
