import React from "react";

import { MIME_TYPES } from "@setsquare/common";

import { serializeAsJSON } from "../data/json";
import { Setsquare } from "../index";

import { API } from "./helpers/api";
import { render, waitFor } from "./test-utils";

import type { SetsquareInitialDataState } from "../types";

const { h } = window;

const sceneWith = (id: string) => [
  API.createElement({ type: "rectangle", id }),
];

describe("launch queue", () => {
  afterEach(() => {
    delete (window as any).launchQueue;
    delete (window as any).LaunchParams;
  });

  it("loads a launched file over the initial scene", async () => {
    const file = new File(
      [serializeAsJSON(sceneWith("greendale"), {}, {}, "local")],
      "greendale.setsquare",
      { type: MIME_TYPES.setsquare },
    );
    const fileHandle = {
      kind: "file",
      name: file.name,
      getFile: async () => file,
    };
    Object.assign(window, {
      // like the browser, launches files as soon as a consumer is set
      launchQueue: {
        setConsumer: (consumer: (params: { files: unknown[] }) => void) =>
          consumer({ files: [fileHandle] }),
      },
      LaunchParams: class {},
    });

    // the autosaved scene arrives after the launched file has been read
    const initialData = new Promise<SetsquareInitialDataState>((resolve) =>
      setTimeout(() => resolve({ elements: sceneWith("city-college") }), 100),
    );
    await render(<Setsquare initialData={initialData} />);
    await initialData;

    await waitFor(() =>
      expect(
        h.elements.filter((element) => !element.isDeleted).map(({ id }) => id),
      ).toEqual(["greendale"]),
    );
  });
});
