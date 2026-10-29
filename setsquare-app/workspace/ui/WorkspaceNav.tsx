import { APP_NAME, THEME } from "@setsquare/common";
import { RadioGroup } from "@setsquare/setsquare/components/RadioGroup";
import {
  DeviceDesktopIcon,
  MoonIcon,
  SetsquareMarkIcon,
  SunIcon,
  TrashIcon,
  historyIcon,
} from "@setsquare/setsquare/components/icons";
import { useI18n } from "@setsquare/setsquare/i18n";
import clsx from "clsx";

import type { Theme } from "@setsquare/element/types";

import { LanguageList } from "../../app-language/LanguageList";
import { StorageNote } from "../../web/accountControls";
import { drawingsIcon, sidebarIcon } from "../../web/icons";
import { RouteLink } from "../../web/RouteLink";
import { childrenOf, parentOf, sortItems } from "../tree";

import { FolderTree } from "./FolderTree";
import { NavDrawingRow } from "./NavDrawingRow";
import { useDropTarget } from "./useWorkspaceDrag";

import type { ReactNode } from "react";

import type { Route } from "../../web/router";
import type { DrawingId, ItemRef, ParentId, WorkspaceSnapshot } from "../types";
import type { WorkspaceStore } from "../WorkspaceStore";

import type { FolderContents } from "./FolderTree";
import type { OpenDrawing } from "./NavDrawingRow";

/** Which place of the workspace shows, to mark it in the nav. */
export type NavPlace =
  | { kind: "recent" }
  | { kind: "drawings"; folderId: ParentId }
  | { kind: "trash" }
  /** a drawing, in the editor or in its notice */
  | { kind: "drawing"; id: DrawingId }
  /** search results, which aren't a place */
  | null;

/**
 * Shows and hides the nav: beside the page on a wide window, where hiding
 * it gives the editor the whole width, and as a drawer below 900 px.
 */
export type NavToggle = {
  /** the nav's element id */
  id: string;
  /** whether the nav shows */
  open: boolean;
  onToggle: () => void;
};

/**
 * Shows the nav where it's hidden, at the start of a page's header or of
 * the editor's top bar, looking like the buttons around it there.
 */
export const NavButton = ({
  nav,
  inEditor = false,
}: {
  nav: NavToggle;
  inEditor?: boolean;
}) => {
  const { t } = useI18n();
  return (
    <button
      type="button"
      className={clsx(
        "workspace-nav-button",
        inEditor
          ? "ToolIcon ToolIcon_type_button ToolIcon_size_medium ToolIcon_type_button--show"
          : "workspace-header__nav",
      )}
      aria-label={t("workspace.showNav")}
      title={t("workspace.showNav")}
      aria-expanded={nav.open}
      aria-controls={nav.id}
      onClick={nav.onToggle}
    >
      {inEditor ? (
        <div className="ToolIcon__icon" aria-hidden="true">
          {sidebarIcon}
        </div>
      ) : (
        sidebarIcon
      )}
    </button>
  );
};

const PlaceLink = ({
  to,
  current,
  icon,
  drop,
  children,
}: {
  to: Route;
  current: boolean;
  icon: ReactNode;
  /** where the place takes dropped items, if it does */
  drop?: ReturnType<typeof useDropTarget>;
  children: string;
}) => (
  <RouteLink
    to={to}
    className={clsx("workspace-nav__place", {
      "workspace-drop": drop?.isOver,
    })}
    aria-current={current ? "page" : undefined}
    {...drop?.targetProps}
  >
    {icon}
    <span>{children}</span>
  </RouteLink>
);

/**
 * The app's navigation, beside the workspace page and the editor alike:
 * Recent, then Drawings with the folder tree, then Trash, and at the foot
 * where the drawings are kept, the theme and the language. The folder shown,
 * or the open drawing's, lists its drawings in the tree too, by name, to
 * open, rename, duplicate and trash them. Items can be dropped on Drawings,
 * its folders and Trash. Below 900 px it's a drawer, which a link followed
 * closes.
 */
export const WorkspaceNav = ({
  store,
  snapshot,
  place,
  editing,
  trash,
  appTheme,
  onThemeChange,
  toggle,
  drawerOpen,
  onClose,
}: {
  store: WorkspaceStore;
  snapshot: WorkspaceSnapshot;
  place: NavPlace;
  /** the drawing the editor has open, once it has */
  editing: OpenDrawing | null;
  /** moves an item to the Trash, offering Undo */
  trash: (item: ItemRef) => void;
  appTheme: Theme | "system";
  onThemeChange: (theme: Theme | "system") => void;
  /** hides the nav, from its own button */
  toggle: NavToggle;
  /** whether it shows as a drawer, below 900 px */
  drawerOpen: boolean;
  onClose: () => void;
}) => {
  const { t } = useI18n();
  const folderId = place?.kind === "drawings" ? place.folderId : null;
  const dropOnRoot = useDropTarget({ kind: "folder", id: null });
  const dropOnTrash = useDropTarget({ kind: "trash" });

  const openId = place?.kind === "drawing" ? place.id : null;
  const open = openId === null ? undefined : snapshot.drawings.get(openId);
  // the folder shown, or the one the open drawing is in
  const listed =
    place?.kind === "drawings"
      ? place.folderId
      : open
      ? parentOf(snapshot, open)
      : undefined;
  const drawings =
    listed === undefined
      ? []
      : sortItems(childrenOf(snapshot, listed).drawings, "name");
  const contents: FolderContents | undefined =
    listed === undefined || !drawings.length
      ? undefined
      : {
          folderId: listed,
          items: drawings.map((drawing) => (
            <NavDrawingRow
              key={drawing.id}
              store={store}
              drawing={drawing}
              isCurrent={drawing.id === openId}
              editing={editing?.id === drawing.id ? editing : null}
              trash={trash}
            />
          )),
        };

  return (
    <nav
      id={toggle.id}
      className={clsx("workspace-nav", { "workspace-nav--open": drawerOpen })}
      aria-label={t("workspace.navigation")}
      onClick={(event) => {
        if ((event.target as Element).closest("a")) {
          onClose();
        }
      }}
    >
      <div className="workspace-nav__brand">
        {SetsquareMarkIcon}
        <span>{APP_NAME}</span>
        <button
          type="button"
          className="workspace-nav__hide"
          aria-label={t("workspace.hideNav")}
          title={t("workspace.hideNav")}
          onClick={toggle.onToggle}
        >
          {sidebarIcon}
        </button>
      </div>
      <ul className="workspace-nav__places">
        <li>
          <PlaceLink
            to={{ kind: "recent" }}
            current={place?.kind === "recent"}
            icon={historyIcon}
          >
            {t("workspace.recent")}
          </PlaceLink>
        </li>
        <li>
          <PlaceLink
            to={{ kind: "drawings", folderId: null }}
            current={place?.kind === "drawings" && folderId === null}
            icon={drawingsIcon}
            drop={dropOnRoot}
          >
            {t("workspace.drawings")}
          </PlaceLink>
          <FolderTree
            snapshot={snapshot}
            currentId={folderId}
            contents={contents}
          />
        </li>
        <li>
          <PlaceLink
            to={{ kind: "trash" }}
            current={place?.kind === "trash"}
            icon={TrashIcon}
            drop={dropOnTrash}
          >
            {t("workspace.trash")}
          </PlaceLink>
        </li>
      </ul>
      <div className="workspace-nav__foot">
        <StorageNote />
        <div className="workspace-nav__prefs">
          <RadioGroup
            name="workspace-theme"
            value={appTheme}
            onChange={onThemeChange}
            choices={[
              {
                value: THEME.LIGHT,
                label: SunIcon,
                ariaLabel: t("buttons.lightMode"),
              },
              {
                value: THEME.DARK,
                label: MoonIcon,
                ariaLabel: t("buttons.darkMode"),
              },
              {
                value: "system",
                label: DeviceDesktopIcon,
                ariaLabel: t("buttons.systemMode"),
              },
            ]}
          />
          <LanguageList />
        </div>
      </div>
    </nav>
  );
};
