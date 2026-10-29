import { LoadIcon, chevronRight } from "@setsquare/setsquare/components/icons";
import { useI18n } from "@setsquare/setsquare/i18n";
import { useMemo, useState } from "react";

import { RouteLink } from "../../web/RouteLink";
import { ancestors, parentOf, sortItems } from "../tree";

import type { Folder, FolderId, ParentId, WorkspaceSnapshot } from "../types";

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

const TreeItem = ({
  folder,
  byParent,
  expanded,
  currentId,
  onToggle,
}: {
  folder: Folder;
  byParent: ReadonlyMap<ParentId, Folder[]>;
  expanded: ReadonlySet<FolderId>;
  currentId: ParentId;
  onToggle: (id: FolderId) => void;
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
        <RouteLink
          to={{ kind: "drawings", folderId: folder.id }}
          className="folder-tree__link"
          aria-current={folder.id === currentId ? "page" : undefined}
        >
          {LoadIcon}
          <span className="folder-tree__name" title={folder.name}>
            {folder.name}
          </span>
        </RouteLink>
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
            />
          ))}
        </ul>
      )}
    </li>
  );
};

/**
 * The folders of the workspace as a tree, the one shown marked and the way
 * to it open. Folders open and close with their toggles; there's no arrow-key
 * navigation yet.
 */
export const FolderTree = ({
  snapshot,
  currentId,
}: {
  snapshot: WorkspaceSnapshot;
  /** the folder the page shows, if it shows one */
  currentId: ParentId;
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
  if (!top.length) {
    return null;
  }
  return (
    <ul role="tree" aria-label={t("workspace.folders")} className="folder-tree">
      {top.map((folder) => (
        <TreeItem
          key={folder.id}
          folder={folder}
          byParent={byParent}
          expanded={expanded}
          currentId={currentId}
          onToggle={toggle}
        />
      ))}
    </ul>
  );
};
