import React from "react";

import { Setsquare } from "../index";

import { fireEvent, render, waitFor } from "./test-utils";

const { h } = window;

describe("export button", () => {
  it("opens the image export dialog", async () => {
    const { container } = await render(<Setsquare />);

    fireEvent.click(container.querySelector(".export-button")!);

    await waitFor(() => {
      expect(h.state.openDialog).toEqual({ name: "imageExport" });
      expect(document.querySelector(".ImageExportModal")).not.toBe(null);
    });
  });

  it("is hidden when image export is disabled", async () => {
    const { container } = await render(
      <Setsquare UIOptions={{ canvasActions: { saveAsImage: false } }} />,
    );

    expect(container.querySelector(".export-button")).toBe(null);
  });
});
