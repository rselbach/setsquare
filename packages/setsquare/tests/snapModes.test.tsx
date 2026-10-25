import React from "react";

import { Setsquare } from "../index";
import { actionToggleGridMode } from "../actions/actionToggleGridMode";
import { actionToggleObjectsSnapMode } from "../actions/actionToggleObjectsSnapMode";
import { isSnappingEnabled } from "../snapping";

import { API } from "./helpers/api";
import { render } from "./test-utils";

const { h } = window;

const snapsToObjects = () =>
  isSnappingEnabled({
    app: h.app,
    event: { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false },
    selectedElements: [],
  });

describe("grid and object snapping", () => {
  beforeEach(async () => {
    await render(<Setsquare />);
  });

  it("restores object snapping when the grid turns off", () => {
    API.executeAction(actionToggleGridMode);
    expect(h.state.gridModeEnabled).toBe(true);
    expect(snapsToObjects()).toBe(false);
    expect(actionToggleObjectsSnapMode.checked!(h.state)).toBe(false);

    API.executeAction(actionToggleGridMode);
    expect(h.state.gridModeEnabled).toBe(false);
    expect(snapsToObjects()).toBe(true);
    expect(actionToggleObjectsSnapMode.checked!(h.state)).toBe(true);
  });

  it("snaps only to the grid when both modes are on", () => {
    API.setAppState({ gridModeEnabled: true, objectsSnapModeEnabled: true });
    expect(snapsToObjects()).toBe(false);
    expect(actionToggleObjectsSnapMode.checked!(h.state)).toBe(false);

    API.executeAction(actionToggleGridMode);
    expect(h.state.gridModeEnabled).toBe(false);
    expect(snapsToObjects()).toBe(true);
  });

  it("turns the grid off when object snapping turns on", () => {
    API.executeAction(actionToggleGridMode);

    API.executeAction(actionToggleObjectsSnapMode);
    expect(h.state.gridModeEnabled).toBe(false);
    expect(snapsToObjects()).toBe(true);

    API.executeAction(actionToggleObjectsSnapMode);
    expect(h.state.objectsSnapModeEnabled).toBe(false);
    expect(snapsToObjects()).toBe(false);
  });
});
