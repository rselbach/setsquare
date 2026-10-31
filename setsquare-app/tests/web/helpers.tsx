import { getNonDeletedElements } from "@setsquare/element";
import { restoreElements } from "@setsquare/setsquare/data/restore";
import {
  act,
  render,
  unmountComponent,
  waitFor,
} from "@setsquare/setsquare/tests/test-utils";
import { render as renderPlain, screen } from "@testing-library/react";

import SetsquareApp from "../../App";
import { navigate } from "../../web/router";
import * as workspaceStore from "../../web/workspaceStore";
import { contentWith, workspaceFixture } from "../workspace/helpers";

import type { Route } from "../../web/router";
import type { DrawingContent, DrawingId } from "../../workspace/types";

const { h } = window;

/**
 * Has the web app open a workspace of the test's own, returning it so the
 * test can open more stores on it. Call in beforeEach, and `cleanUpWebApp`
 * after each test.
 */
export const setUpTestWorkspace = () => {
  const workspace = workspaceFixture();
  vi.spyOn(workspaceStore, "openWorkspaceStore").mockImplementation(
    workspace.open,
  );
  return workspace;
};

/** Undoes what a test of the web app leaves behind. */
export const cleanUpWebApp = async (
  workspace: ReturnType<typeof workspaceFixture>,
) => {
  // unmounting saves the open drawing; let those writes finish before the
  // database closes under them
  unmountComponent();
  await new Promise((resolve) => setTimeout(resolve, 50));
  vi.restoreAllMocks();
  workspace.close();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
};

/**
 * A drawing's content with a rectangle for each id, as the editor saves it:
 * restored, so opening it changes nothing.
 */
export const savedContent = (
  name: string | null,
  ...ids: string[]
): DrawingContent => {
  const content = contentWith(name, ...ids);
  return {
    ...content,
    elements: getNonDeletedElements(restoreElements(content.elements, null)),
  };
};

/** Renders the web app as a page opened at path. */
export const renderWebAppAt = (
  path: string,
  options?: Parameters<typeof render>[1],
) => {
  window.history.replaceState(null, "", path);
  return render(<SetsquareApp />, options);
};

/**
 * Renders the web app as a page opened at path, resolving once it shows the
 * workspace page, which has no canvas to wait for.
 */
export const renderPageAt = async (path: string) => {
  window.history.replaceState(null, "", path);
  const result = renderPlain(<SetsquareApp />);
  await screen.findByRole("main");
  return result;
};

/** Waits for the workspace page at path, with the title it shows. */
export const waitForPage = (path: string, title: string) =>
  waitFor(() => {
    expect(window.location.pathname).toBe(path);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(title);
  });

/** The ids of the elements in the editor, deleted ones aside. */
export const elementIds = () =>
  h.elements.filter((element) => !element.isDeleted).map(({ id }) => id);

/** Navigates as a link in the app would. */
export const navigateTo = (route: Route) => act(() => navigate(route));

/** Waits for the editor to show the drawing with the given elements. */
export const waitForDrawing = (id: DrawingId, ids: string[]) =>
  waitFor(() => {
    expect(window.location.pathname).toBe(`/d/${id}`);
    expect(h.state.isLoading).toBe(false);
    expect(elementIds()).toEqual(ids);
  });

/** Waits out the autosave's debounce. */
export const waitForAutosave = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, 400)));

/**
 * Where screen readers hear the toast: the polite live region for news, the
 * alert for errors. Both are there before any message is.
 */
export const toastRegion = (kind: "news" | "error" = "news") =>
  document.querySelector<HTMLElement>(
    `.workspace-toast-announcer ${
      kind === "error" ? '[role="alert"]' : '[aria-live="polite"]'
    }`,
  )!;

/** Waits until the toast says `text`, returning the toast, with its buttons. */
export const findToast = async (
  text: string,
  kind: "news" | "error" = "news",
) => {
  await waitFor(() => expect(toastRegion(kind)).toHaveTextContent(text));
  return document.querySelector<HTMLElement>(".workspace-toast")!;
};
