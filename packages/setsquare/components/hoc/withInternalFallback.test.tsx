import React from "react";

import { Setsquare, MainMenu } from "../../index";
import { render, queryAllByTestId } from "../../tests/test-utils";

describe("Test internal component fallback rendering", () => {
  it("should render only one menu per setsquare instance (custom menu first scenario)", async () => {
    const { container } = await render(
      <div>
        <Setsquare>
          <MainMenu>test</MainMenu>
        </Setsquare>
        <Setsquare />
      </div>,
    );

    expect(queryAllByTestId(container, "main-menu-trigger")?.length).toBe(2);

    const excalContainers = container.querySelectorAll<HTMLDivElement>(
      ".setsquare-container",
    );

    expect(
      queryAllByTestId(excalContainers[0], "main-menu-trigger")?.length,
    ).toBe(1);
    expect(
      queryAllByTestId(excalContainers[1], "main-menu-trigger")?.length,
    ).toBe(1);
  });

  it("should render only one menu per setsquare instance (default menu first scenario)", async () => {
    const { container } = await render(
      <div>
        <Setsquare />
        <Setsquare>
          <MainMenu>test</MainMenu>
        </Setsquare>
      </div>,
    );

    expect(queryAllByTestId(container, "main-menu-trigger")?.length).toBe(2);

    const excalContainers = container.querySelectorAll<HTMLDivElement>(
      ".setsquare-container",
    );

    expect(
      queryAllByTestId(excalContainers[0], "main-menu-trigger")?.length,
    ).toBe(1);
    expect(
      queryAllByTestId(excalContainers[1], "main-menu-trigger")?.length,
    ).toBe(1);
  });

  it("should render only one menu per setsquare instance (two custom menus scenario)", async () => {
    const { container } = await render(
      <div>
        <Setsquare>
          <MainMenu>test</MainMenu>
        </Setsquare>
        <Setsquare>
          <MainMenu>test</MainMenu>
        </Setsquare>
      </div>,
    );

    expect(queryAllByTestId(container, "main-menu-trigger")?.length).toBe(2);

    const excalContainers = container.querySelectorAll<HTMLDivElement>(
      ".setsquare-container",
    );

    expect(
      queryAllByTestId(excalContainers[0], "main-menu-trigger")?.length,
    ).toBe(1);
    expect(
      queryAllByTestId(excalContainers[1], "main-menu-trigger")?.length,
    ).toBe(1);
  });

  it("should render only one menu per setsquare instance (two default menus scenario)", async () => {
    const { container } = await render(
      <div>
        <Setsquare />
        <Setsquare />
      </div>,
    );

    expect(queryAllByTestId(container, "main-menu-trigger")?.length).toBe(2);

    const excalContainers = container.querySelectorAll<HTMLDivElement>(
      ".setsquare-container",
    );

    expect(
      queryAllByTestId(excalContainers[0], "main-menu-trigger")?.length,
    ).toBe(1);
    expect(
      queryAllByTestId(excalContainers[1], "main-menu-trigger")?.length,
    ).toBe(1);
  });
});

describe("UIOptions.mainMenu", () => {
  it("renders no main menu when disabled and the host renders none", async () => {
    const { container } = await render(
      <Setsquare UIOptions={{ mainMenu: false }} />,
    );

    expect(queryAllByTestId(container, "main-menu-trigger").length).toBe(0);
  });
});
