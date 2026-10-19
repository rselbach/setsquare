import React from "react";

import { DEFAULT_SIDEBAR } from "@setsquare/common";

import { DefaultSidebar } from "../index";
import {
  fireEvent,
  waitFor,
  withSetsquareDimensions,
} from "../tests/test-utils";

import {
  assertSetsquareWithSidebar,
  assertSidebarDockButton,
} from "./Sidebar/siderbar.test.helpers";

const { h } = window;

describe("DefaultSidebar", () => {
  it("when `docked={undefined}` & `onDock={undefined}`, should allow docking", async () => {
    await assertSetsquareWithSidebar(
      <DefaultSidebar />,
      DEFAULT_SIDEBAR.name,
      async () => {
        expect(h.state.defaultSidebarDockedPreference).toBe(false);

        const { dockButton } = await assertSidebarDockButton(true);

        fireEvent.click(dockButton);
        await waitFor(() => {
          expect(h.state.defaultSidebarDockedPreference).toBe(true);
          expect(dockButton).toHaveClass("selected");
        });

        fireEvent.click(dockButton);
        await waitFor(() => {
          expect(h.state.defaultSidebarDockedPreference).toBe(false);
          expect(dockButton).not.toHaveClass("selected");
        });
      },
    );
  });

  it("when `docked={undefined}` & `onDock`, should allow docking", async () => {
    await assertSetsquareWithSidebar(
      <DefaultSidebar onDock={() => {}} />,
      DEFAULT_SIDEBAR.name,
      async () => {
        expect(h.state.defaultSidebarDockedPreference).toBe(false);

        const { dockButton } = await assertSidebarDockButton(true);

        fireEvent.click(dockButton);
        await waitFor(() => {
          expect(h.state.defaultSidebarDockedPreference).toBe(true);
          expect(dockButton).toHaveClass("selected");
        });

        fireEvent.click(dockButton);
        await waitFor(() => {
          expect(h.state.defaultSidebarDockedPreference).toBe(false);
          expect(dockButton).not.toHaveClass("selected");
        });
      },
    );
  });

  it("when `docked={true}` & `onDock`, should allow docking", async () => {
    await assertSetsquareWithSidebar(
      <DefaultSidebar onDock={() => {}} />,
      DEFAULT_SIDEBAR.name,
      async () => {
        expect(h.state.defaultSidebarDockedPreference).toBe(false);

        const { dockButton } = await assertSidebarDockButton(true);

        fireEvent.click(dockButton);
        await waitFor(() => {
          expect(h.state.defaultSidebarDockedPreference).toBe(true);
          expect(dockButton).toHaveClass("selected");
        });

        fireEvent.click(dockButton);
        await waitFor(() => {
          expect(h.state.defaultSidebarDockedPreference).toBe(false);
          expect(dockButton).not.toHaveClass("selected");
        });
      },
    );
  });

  it("when `onDock={false}`, should disable docking", async () => {
    await assertSetsquareWithSidebar(
      <DefaultSidebar onDock={false} />,
      DEFAULT_SIDEBAR.name,
      async () => {
        await withSetsquareDimensions(
          { width: 1920, height: 1080 },
          async () => {
            expect(h.state.defaultSidebarDockedPreference).toBe(false);

            await assertSidebarDockButton(false);
          },
        );
      },
    );
  });

  it("when `docked={true}` & `onDock={false}`, should force-dock sidebar", async () => {
    await assertSetsquareWithSidebar(
      <DefaultSidebar docked onDock={false} />,
      DEFAULT_SIDEBAR.name,
      async () => {
        expect(h.state.defaultSidebarDockedPreference).toBe(false);

        const { sidebar } = await assertSidebarDockButton(false);
        expect(sidebar).toHaveClass("sidebar--docked");
      },
    );
  });

  it("when `docked={true}` & `onDock={undefined}`, should force-dock sidebar", async () => {
    await assertSetsquareWithSidebar(
      <DefaultSidebar docked />,
      DEFAULT_SIDEBAR.name,
      async () => {
        expect(h.state.defaultSidebarDockedPreference).toBe(false);

        const { sidebar } = await assertSidebarDockButton(false);
        expect(sidebar).toHaveClass("sidebar--docked");
      },
    );
  });

  it("when `docked={false}` & `onDock={undefined}`, should force-undock sidebar", async () => {
    await assertSetsquareWithSidebar(
      <DefaultSidebar docked={false} />,
      DEFAULT_SIDEBAR.name,
      async () => {
        expect(h.state.defaultSidebarDockedPreference).toBe(false);

        const { sidebar } = await assertSidebarDockButton(false);
        expect(sidebar).not.toHaveClass("sidebar--docked");
      },
    );
  });
});
