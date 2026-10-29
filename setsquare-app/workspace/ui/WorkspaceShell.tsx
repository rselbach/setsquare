import { KEYS } from "@setsquare/common";
import { StandaloneUIProvider } from "@setsquare/setsquare";
import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import type { Theme } from "@setsquare/element/types";

import { useAppLangCode } from "../../app-language/language-state";
import { STORAGE_KEYS } from "../../app_constants";
import { useWorkspaceSnapshot } from "../../web/useWorkspaceSnapshot";
import { visibleFolder } from "../tree";

import { WorkspaceDragProvider } from "./useWorkspaceDrag";
import { WorkspaceNav } from "./WorkspaceNav";

import type { ReactNode } from "react";

import type { Route } from "../../web/router";
import type { ItemRef, ParentId, WorkspaceSnapshot } from "../types";
import type { WorkspaceStore } from "../WorkspaceStore";

import type { OpenDrawing } from "./NavDrawingRow";
import type { NavPlace, NavToggle } from "./WorkspaceNav";

// the widest window where the nav is a drawer, as Workspace.scss has it
const DRAWER_MAX_WIDTH = 899;

const isNarrow = () => window.innerWidth <= DRAWER_MAX_WIDTH;

const subscribeToResize = (onChange: () => void) => {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
};

const loadHidden = () =>
  localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_WORKSPACE_NAV_HIDDEN) ===
  "true";

/** Where the nav shows, as the shell lays it out. */
export type NavState = {
  toggle: NavToggle;
  /** hidden beside the page, as chosen last in this browser */
  hidden: boolean;
  /** open as a drawer, below 900 px */
  drawerOpen: boolean;
  closeDrawer: () => void;
};

/**
 * The nav's state: on a wide window it shows beside the page unless it was
 * hidden, which this browser remembers; on a narrow one it's a drawer, which
 * Escape closes.
 */
export const useNavState = (): NavState => {
  const id = useId();
  const narrow = useSyncExternalStore(subscribeToResize, isNarrow);
  const [hidden, setHidden] = useState(loadHidden);
  const [drawerOpen, setDrawerOpen] = useState(false);
  if (drawerOpen && !narrow) {
    // a window widened past the drawer shows the nav as chosen instead
    setDrawerOpen(false);
  }

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === KEYS.ESCAPE) {
        setDrawerOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  const onToggle = useCallback(() => {
    if (isNarrow()) {
      setDrawerOpen((open) => !open);
      return;
    }
    localStorage.setItem(
      STORAGE_KEYS.LOCAL_STORAGE_WORKSPACE_NAV_HIDDEN,
      String(!hidden),
    );
    setHidden(!hidden);
  }, [hidden]);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const open = narrow ? drawerOpen : !hidden;
  const toggle = useMemo(() => ({ id, open, onToggle }), [id, open, onToggle]);
  return { toggle, hidden, drawerOpen, closeDrawer };
};

// what the nav marks for the route
const placeOf = (
  route: Route,
  snapshot: WorkspaceSnapshot,
  searching: boolean,
): NavPlace => {
  if (route.kind === "drawing") {
    return { kind: "drawing", id: route.id };
  }
  if (route.kind === "trash") {
    return { kind: "trash" };
  }
  if (searching) {
    return null;
  }
  if (route.kind === "recent") {
    return { kind: "recent" };
  }
  // a folder that's gone or in the Trash shows the root
  const requested: ParentId = route.kind === "drawings" ? route.folderId : null;
  return { kind: "drawings", folderId: visibleFolder(snapshot, requested) };
};

/**
 * The web app's frame: the nav, and beside it the page or the drawing the
 * route shows. The nav stays as the route changes, so opening a drawing
 * only changes what's beside it. Items dragged from the page can be dropped
 * on the nav's places.
 */
export const WorkspaceShell = ({
  store,
  route,
  searching,
  editing,
  trash,
  theme,
  appTheme,
  onThemeChange,
  nav,
  children,
}: {
  store: WorkspaceStore;
  route: Route;
  /** whether the page shows search results, which aren't a place */
  searching: boolean;
  /** the drawing the editor has open, once it has */
  editing: OpenDrawing | null;
  /** moves an item to the Trash, offering Undo */
  trash: (item: ItemRef) => void;
  /** the theme shown, with "system" resolved */
  theme: Theme;
  /** the theme chosen */
  appTheme: Theme | "system";
  onThemeChange: (theme: Theme | "system") => void;
  nav: NavState;
  children: ReactNode;
}) => {
  const [langCode] = useAppLangCode();
  const snapshot = useWorkspaceSnapshot(store);
  const onMove = useCallback(
    (item: ItemRef, target: ParentId) => {
      store.move(item, target).then(
        (result) =>
          result.ok || console.error("Couldn't move", item, result.reason),
        (error) => console.error(error),
      );
    },
    [store],
  );

  return (
    <WorkspaceDragProvider snapshot={snapshot} onMove={onMove} onTrash={trash}>
      <div
        className={clsx("workspace-shell", {
          "workspace-shell--nav-hidden": nav.hidden,
        })}
      >
        <StandaloneUIProvider
          theme={theme}
          langCode={langCode}
          className="setsquare-workspace workspace-shell__nav"
        >
          <WorkspaceNav
            store={store}
            snapshot={snapshot}
            place={placeOf(route, snapshot, searching)}
            editing={editing}
            trash={trash}
            appTheme={appTheme}
            onThemeChange={onThemeChange}
            toggle={nav.toggle}
            drawerOpen={nav.drawerOpen}
            onClose={nav.closeDrawer}
          />
          {nav.drawerOpen && (
            <div
              className="workspace__scrim"
              aria-hidden="true"
              onClick={nav.closeDrawer}
            />
          )}
        </StandaloneUIProvider>
        <div className="workspace-shell__main">{children}</div>
      </div>
    </WorkspaceDragProvider>
  );
};
