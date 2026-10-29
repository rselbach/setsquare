import { LoadIcon, chevronRight } from "@setsquare/setsquare/components/icons";
import { useI18n } from "@setsquare/setsquare/i18n";
import clsx from "clsx";
import { useMemo, useState } from "react";

import { drawingsIcon } from "../../web/icons";
import { RouteLink } from "../../web/RouteLink";
import { ancestors, parentOf, sortItems } from "../tree";

import { InlineName } from "./InlineName";
import { useDropTarget } from "./useWorkspaceDrag";

import type { ReactNode } from "react";

import type { Folder, FolderId, ParentId, WorkspaceSnapshot } from "../types";

/**
 * What makes the tree a picker of where to put an item, as Move to… shows
 * it, with the root as a choice, instead of links to the folders.
 */
export type FolderPicker = {
  onSelect: (id: ParentId) => void;
  /** where the item is now, marked as such */
  location: ParentId;
  /** folders it can't go in, such as the item itself and what's in it */
  disabled: ReadonlySet<FolderId>;
  /** the folder being named in place, such as one just made */
  renaming: {
    id: FolderId;
    onSave: (name: string) => void;
    onClose: () => void;
  } | null;
};

// the folders outside the Trash in each folder, by name; a trashed folder
// isn't listed, so neither is anything inside it
const foldersByParent = (snapshot: WorkspaceSnapshot) => {
  const byParent = new Map<ParentId, Folder[]>();
  for (const folder of snapshot.folders.values()) {
    if (folder.trashedAt === null) {
      const parentId = parentOf(snapshot, folder);
      byParent.set(parentId, [...(byParent.get(parentId) ?? []), folder]);
    }
  }
  for (const [parentId, folders] of byParent) {
    byParent.set(parentId, sortItems(folders, "name"));
  }
  return byParent;
};

// a folder to choose in a picker, or to name in place
const Choice = ({
  id,
  name,
  icon,
  picker,
}: {
  id: ParentId;
  name: string;
  icon: ReactNode;
  picker: FolderPicker;
}) => {
  const { t } = useI18n();
  const { renaming } = picker;
  if (renaming && renaming.id === id) {
    return (
      <InlineName
        name={name}
        label={t("workspace.folderName")}
        className="folder-tree__name-field"
        // a folder always has a name
        onSave={(name) => name && renaming.onSave(name)}
        onClose={renaming.onClose}
      />
    );
  }
  const isLocation = id === picker.location;
  return (
    <button
      type="button"
      className="folder-tree__link"
      disabled={id !== null && picker.disabled.has(id)}
      aria-current={isLocation ? "location" : undefined}
      onClick={() => picker.onSelect(id)}
    >
      {icon}
      <span className="folder-tree__name" title={name}>
        {name}
      </span>
      {isLocation && (
        <span className="folder-tree__location" aria-hidden="true">
          {t("workspace.currentLocation")}
        </span>
      )}
    </button>
  );
};

// a folder's link in the nav, which items can be dropped on
const FolderLink = ({
  folder,
  isCurrent,
}: {
  folder: Folder;
  isCurrent: boolean;
}) => {
  const { isOver, targetProps } = useDropTarget({
    kind: "folder",
    id: folder.id,
  });
  return (
    <RouteLink
      to={{ kind: "drawings", folderId: folder.id }}
      className={clsx("folder-tree__link", { "workspace-drop": isOver })}
      aria-current={isCurrent ? "page" : undefined}
      {...targetProps}
    >
      {LoadIcon}
      <span className="folder-tree__name" title={folder.name}>
        {folder.name}
      </span>
    </RouteLink>
  );
};

const TreeItem = ({
  folder,
  byParent,
  expanded,
  currentId,
  onToggle,
  picker,
}: {
  folder: Folder;
  byParent: ReadonlyMap<ParentId, Folder[]>;
  expanded: ReadonlySet<FolderId>;
  currentId: ParentId;
  onToggle: (id: FolderId) => void;
  picker?: FolderPicker;
}) => {
  const { t } = useI18n();
  const children = byParent.get(folder.id) ?? [];
  const isOpen = children.length > 0 && expanded.has(folder.id);

  return (
    <li
      role="treeitem"
      aria-label={folder.name}
      aria-expanded={children.length ? isOpen : undefined}
      aria-selected={folder.id === currentId}
      className="folder-tree__item"
    >
      <div className="folder-tree__row">
        {children.length > 0 ? (
          <button
            type="button"
            className="folder-tree__toggle"
            aria-label={t(
              isOpen ? "workspace.collapseFolder" : "workspace.expandFolder",
              { name: folder.name },
            )}
            onClick={() => onToggle(folder.id)}
          >
            {chevronRight}
          </button>
        ) : (
          <span className="folder-tree__toggle" />
        )}
        {picker ? (
          <Choice
            id={folder.id}
            name={folder.name}
            icon={LoadIcon}
            picker={picker}
          />
        ) : (
          <FolderLink folder={folder} isCurrent={folder.id === currentId} />
        )}
      </div>
      {isOpen && (
        <ul role="group" className="folder-tree__group">
          {children.map((child) => (
            <TreeItem
              key={child.id}
              folder={child}
              byParent={byParent}
              expanded={expanded}
              currentId={currentId}
              onToggle={onToggle}
              picker={picker}
            />
          ))}
        </ul>
      )}
    </li>
  );
};

/**
 * The folders of the workspace as a tree, the current one marked and the
 * way to it open. In the nav, folders are links that items can be dropped
 * on; as a picker, they're choices under the root. Folders open and close
 * with their toggles; there's no arrow-key navigation yet.
 */
export const FolderTree = ({
  snapshot,
  currentId,
  picker,
}: {
  snapshot: WorkspaceSnapshot;
  /** the folder the page shows, if it shows one, or the picker's choice */
  currentId: ParentId;
  picker?: FolderPicker;
}) => {
  const { t } = useI18n();
  const byParent = useMemo(() => foldersByParent(snapshot), [snapshot]);
  const [expanded, setExpanded] = useState<ReadonlySet<FolderId>>(
    () => new Set(),
  );
  // opening a folder elsewhere, such as from the grid, reveals it here, but
  // what the user closes stays closed until then
  const [revealed, setRevealed] = useState<ParentId | undefined>();
  if (revealed !== currentId) {
    setRevealed(currentId);
    const path = ancestors(snapshot, currentId).map((folder) => folder.id);
    setExpanded((expanded) => new Set([...expanded, ...path]));
  }

  const toggle = (id: FolderId) =>
    setExpanded((expanded) => {
      const next = new Set(expanded);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });

  const top = byParent.get(null) ?? [];
  const items = top.map((folder) => (
    <TreeItem
      key={folder.id}
      folder={folder}
      byParent={byParent}
      expanded={expanded}
      currentId={currentId}
      onToggle={toggle}
      picker={picker}
    />
  ));
  if (picker) {
    const rootName = t("workspace.drawings");
    return (
      <ul
        role="tree"
        aria-label={t("workspace.folders")}
        className="folder-tree"
      >
        <li
          role="treeitem"
          aria-label={rootName}
          aria-expanded={top.length ? true : undefined}
          aria-selected={currentId === null}
          className="folder-tree__item"
        >
          <div className="folder-tree__row">
            <Choice
              id={null}
              name={rootName}
              icon={drawingsIcon}
              picker={picker}
            />
          </div>
          {top.length > 0 && (
            <ul role="group" className="folder-tree__group">
              {items}
            </ul>
          )}
        </li>
      </ul>
    );
  }
  if (!top.length) {
    return null;
  }
  return (
    <ul role="tree" aria-label={t("workspace.folders")} className="folder-tree">
      {items}
    </ul>
  );
};
