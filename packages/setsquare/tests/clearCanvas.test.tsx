import React from "react";

import { Setsquare } from "../index";
import { actionClearCanvas } from "../actions/actionCanvas";

import { API } from "./helpers/api";
import { render } from "./test-utils";

const { h } = window;

describe("clear canvas", () => {
  beforeEach(async () => {
    await render(<Setsquare />);
  });

  it("keeps object snapping as the user set it", () => {
    API.setAppState({ objectsSnapModeEnabled: false });

    API.executeAction(actionClearCanvas);

    expect(h.state.objectsSnapModeEnabled).toBe(false);
  });

  it("leaves the new drawing unnamed", () => {
    API.setAppState({ name: "Greendale campus map" });

    API.executeAction(actionClearCanvas);

    expect(h.state.name).toBe(null);
    expect(
      document.querySelector<HTMLInputElement>(".TitleBlock__name")!.value,
    ).toBe("");
  });
});
