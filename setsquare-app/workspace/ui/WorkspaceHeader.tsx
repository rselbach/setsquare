import { KEYS } from "@setsquare/common";
import { FilledButton } from "@setsquare/setsquare/components/FilledButton";
import { IconButton } from "@setsquare/setsquare/components/IconButton";
import { TextField } from "@setsquare/setsquare/components/TextField";
import DropdownMenu from "@setsquare/setsquare/components/dropdownMenu/DropdownMenu";
import {
  CloseIcon,
  LoadIcon,
  PlusIcon,
  chevronDownIcon,
  chevronRight,
  searchIcon,
} from "@setsquare/setsquare/components/icons";
import { useI18n } from "@setsquare/setsquare/i18n";
import { useState } from "react";

import { newDrawingIcon, newFolderIcon } from "../../web/icons";
import { RouteLink } from "../../web/RouteLink";

import { useDropTarget } from "./useWorkspaceDrag";
import { NavButton } from "./WorkspaceNav";

import type { ReactNode, RefObject } from "react";

import type { SortOrder } from "../tree";
import type { ParentId } from "../types";

import type { NavToggle } from "./WorkspaceNav";

/** A folder on the way to the one shown, null for the root, linked. */
export type Crumb = { folderId: ParentId; name: string };

/** What the page offers to create where it creates. */
export type CreateActions = {
  newDrawing: () => void;
  newFolder: () => void;
  openFile: () => void;
};

/** The search over the workspace's names. */
export type SearchControl = {
  query: string;
  onChange: (query: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  /** whether a phone shows the field, which it hides behind an icon */
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const SORT_ORDERS: readonly SortOrder[] = ["updated", "name"];

const SortMenu = ({
  order,
  onChange,
}: {
  order: SortOrder;
  onChange: (order: SortOrder) => void;
}) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const labels: Record<SortOrder, string> = {
    updated: t("workspace.sortUpdated"),
    name: t("workspace.sortName"),
  };

  return (
    <DropdownMenu open={open}>
      <DropdownMenu.Trigger
        className="workspace-sort"
        onToggle={() => setOpen(!open)}
      >
        <span className="workspace-caption">{t("workspace.sort")}</span>
        <span className="workspace-sort__value">{labels[order]}</span>
        {chevronDownIcon}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        className="workspace-menu"
        returnFocus
        onClickOutside={() => setOpen(false)}
        onSelect={() => setOpen(false)}
      >
        {SORT_ORDERS.map((each) => (
          <DropdownMenu.ItemCheckbox
            key={each}
            checked={each === order}
            onSelect={() => onChange(each)}
          >
            {labels[each]}
          </DropdownMenu.ItemCheckbox>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu>
  );
};

// the create actions folded into one `+` menu, for phones
const CreateMenu = ({ actions }: { actions: CreateActions }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open}>
      <DropdownMenu.Trigger
        className="workspace-header__icon workspace-header__create-menu"
        onToggle={() => setOpen(!open)}
        title={t("workspace.create")}
        aria-label={t("workspace.create")}
      >
        {PlusIcon}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        className="workspace-menu"
        returnFocus
        onClickOutside={() => setOpen(false)}
        onSelect={() => setOpen(false)}
      >
        <DropdownMenu.Item icon={newDrawingIcon} onSelect={actions.newDrawing}>
          {t("workspace.newDrawing")}
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={newFolderIcon} onSelect={actions.newFolder}>
          {t("workspace.newFolder")}
        </DropdownMenu.Item>
        <DropdownMenu.Item icon={LoadIcon} onSelect={actions.openFile}>
          {t("workspace.openFile")}
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
};

// a link back up, which items can be dropped on to move them there
const CrumbLink = ({ crumb }: { crumb: Crumb }) => {
  const { isOver, targetProps } = useDropTarget({
    kind: "folder",
    id: crumb.folderId,
  });
  return (
    <li>
      <RouteLink
        to={{ kind: "drawings", folderId: crumb.folderId }}
        className={isOver ? "workspace-drop" : undefined}
        {...targetProps}
      >
        {crumb.name}
      </RouteLink>
      {chevronRight}
    </li>
  );
};

const SearchField = ({
  search,
  onClose,
}: {
  search: SearchControl;
  /** hides the field, where it can hide */
  onClose?: () => void;
}) => {
  const { t } = useI18n();
  return (
    <label className="workspace-search">
      <span className="visually-hidden">{t("workspace.search")}</span>
      <TextField
        ref={search.inputRef}
        type="search"
        icon={searchIcon}
        placeholder={t("workspace.search")}
        value={search.query}
        onChange={search.onChange}
        onKeyDown={(event) => {
          if (event.key !== KEYS.ESCAPE) {
            return;
          }
          // Escape clears first, then leaves
          if (search.query) {
            search.onChange("");
          } else if (onClose) {
            onClose();
          } else {
            event.currentTarget.blur();
          }
        }}
      />
      {!onClose && (
        <kbd className="workspace-search__key" aria-hidden="true">
          /
        </kbd>
      )}
    </label>
  );
};

/**
 * The page's header: where the page is, with a search over the whole
 * workspace, the sort, and what can be created there. Phones get a shorter
 * one: back, the title, a search icon and a `+` menu.
 */
export const WorkspaceHeader = ({
  title,
  crumbs,
  back,
  isPhone,
  nav,
  search,
  sort,
  actions,
  account,
}: {
  title: string;
  /** the folders above the one shown, from the root */
  crumbs: readonly Crumb[];
  /** where a phone's back chevron goes, if anywhere */
  back: Crumb | null;
  isPhone: boolean;
  /** shows the nav where it's hidden */
  nav: NavToggle;
  search: SearchControl;
  /** the sort, where the page lets it change */
  sort: { order: SortOrder; onChange: (order: SortOrder) => void } | null;
  actions: CreateActions;
  /** who is signed in, at the right end of the bar */
  account: ReactNode;
}) => {
  const { t } = useI18n();
  const navButton = <NavButton nav={nav} />;

  if (isPhone) {
    const searching = search.open || search.query !== "";
    return (
      <header className="workspace-header workspace-header--phone">
        <div className="workspace-header__bar">
          {navButton}
          {back && (
            <RouteLink
              to={{ kind: "drawings", folderId: back.folderId }}
              className="workspace-header__icon workspace-header__back"
              aria-label={t("workspace.back", { name: back.name })}
              title={t("workspace.back", { name: back.name })}
            >
              {chevronRight}
            </RouteLink>
          )}
          <h1 className="workspace-header__title">{title}</h1>
          {!searching && (
            <IconButton
              type="button"
              icon={searchIcon}
              aria-label={t("workspace.search")}
              title={t("workspace.search")}
              className="workspace-header__icon"
              onClick={() => search.onOpenChange(true)}
            />
          )}
          <CreateMenu actions={actions} />
          {account}
        </div>
        {searching && (
          <div className="workspace-header__search-row">
            <SearchField
              search={search}
              onClose={() => {
                search.onChange("");
                search.onOpenChange(false);
              }}
            />
            <IconButton
              type="button"
              icon={CloseIcon}
              aria-label={t("buttons.close")}
              title={t("buttons.close")}
              className="workspace-header__icon"
              onClick={() => {
                search.onChange("");
                search.onOpenChange(false);
              }}
            />
          </div>
        )}
        {sort && (
          <div className="workspace-header__toolbar">
            <SortMenu {...sort} />
          </div>
        )}
      </header>
    );
  }

  return (
    <header className="workspace-header">
      <div className="workspace-header__bar">
        {navButton}
        <div className="workspace-header__heading">
          {crumbs.length > 0 && (
            <nav aria-label={t("workspace.breadcrumbs")}>
              <ol className="workspace-breadcrumbs">
                {crumbs.map((crumb) => (
                  <CrumbLink key={crumb.folderId ?? ""} crumb={crumb} />
                ))}
              </ol>
            </nav>
          )}
          <h1 className="workspace-header__title">{title}</h1>
        </div>
        <SearchField search={search} />
        {account}
      </div>
      <div className="workspace-header__toolbar">
        <div className="workspace-header__create">
          <FilledButton icon={PlusIcon} onClick={actions.newDrawing}>
            {t("workspace.newDrawing")}
          </FilledButton>
          <FilledButton
            variant="outlined"
            icon={newFolderIcon}
            onClick={actions.newFolder}
          >
            {t("workspace.newFolder")}
          </FilledButton>
          <FilledButton
            variant="outlined"
            icon={LoadIcon}
            onClick={actions.openFile}
          >
            {t("workspace.openFile")}
          </FilledButton>
        </div>
        {sort && <SortMenu {...sort} />}
      </div>
    </header>
  );
};
