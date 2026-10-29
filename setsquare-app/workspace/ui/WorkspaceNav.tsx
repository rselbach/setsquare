import { APP_NAME, THEME } from "@setsquare/common";
import { RadioGroup } from "@setsquare/setsquare/components/RadioGroup";
import {
  DeviceDesktopIcon,
  MoonIcon,
  SetsquareMarkIcon,
  SunIcon,
  historyIcon,
} from "@setsquare/setsquare/components/icons";
import { useI18n } from "@setsquare/setsquare/i18n";
import clsx from "clsx";

import type { Theme } from "@setsquare/element/types";

import { LanguageList } from "../../app-language/LanguageList";
import { drawingsIcon } from "../../web/icons";
import { RouteLink } from "../../web/RouteLink";

import { FolderTree } from "./FolderTree";

import type { ReactNode } from "react";

import type { Route } from "../../web/router";
import type { ParentId, WorkspaceSnapshot } from "../types";

/** Which place of the workspace the page shows, to mark it in the nav. */
export type NavPlace =
  | { kind: "recent" }
  | { kind: "drawings"; folderId: ParentId }
  /** search results, which aren't a place */
  | null;

const PlaceLink = ({
  to,
  current,
  icon,
  children,
}: {
  to: Route;
  current: boolean;
  icon: ReactNode;
  children: string;
}) => (
  <RouteLink
    to={to}
    className="workspace-nav__place"
    aria-current={current ? "page" : undefined}
  >
    {icon}
    <span>{children}</span>
  </RouteLink>
);

/**
 * The page's navigation: Recent, then Drawings with the folder tree, and at
 * the foot where the drawings are kept, the theme and the language. Below
 * 900 px it's a drawer, which a link followed closes.
 */
export const WorkspaceNav = ({
  id,
  snapshot,
  place,
  appTheme,
  onThemeChange,
  open,
  onClose,
}: {
  id: string;
  snapshot: WorkspaceSnapshot;
  place: NavPlace;
  appTheme: Theme | "system";
  onThemeChange: (theme: Theme | "system") => void;
  /** whether it shows as a drawer, below 900 px */
  open: boolean;
  onClose: () => void;
}) => {
  const { t } = useI18n();
  const folderId = place?.kind === "drawings" ? place.folderId : null;

  return (
    <nav
      id={id}
      className={clsx("workspace-nav", { "workspace-nav--open": open })}
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
          >
            {t("workspace.drawings")}
          </PlaceLink>
          <FolderTree snapshot={snapshot} currentId={folderId} />
        </li>
      </ul>
      <div className="workspace-nav__foot">
        <p className="workspace-nav__storage">
          <span className="workspace-caption">
            {t("workspace.storedInBrowser")}
          </span>
          {t("welcomeScreen.app.center_heading_line2")}
        </p>
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
