import { Dialog } from "@setsquare/setsquare/components/Dialog";
import { FilledButton } from "@setsquare/setsquare/components/FilledButton";
import { useI18n } from "@setsquare/setsquare/i18n";
import { useCallback, useEffect, useMemo, useState } from "react";

import { newFolderIcon } from "../../web/icons";
import { useWorkspaceSnapshot } from "../../web/useWorkspaceSnapshot";
import { findItem, isTrashed, parentOf, subtree, uniqueName } from "../tree";

import { FolderTree } from "./FolderTree";

import type { FolderId, ItemRef, ParentId } from "../types";
import type { WorkspaceStore } from "../WorkspaceStore";

/**
 * Moves an item to the folder chosen from the tree, the root included. The
 * folder it's in is marked, and it can't go into itself or what's inside
 * it, which the store refuses too. A new folder is made in the one chosen.
 */
export const MoveDialog = ({
  store,
  item,
  onClose,
}: {
  store: WorkspaceStore;
  item: ItemRef;
  onClose: () => void;
}) => {
  const { t } = useI18n();
  const snapshot = useWorkspaceSnapshot(store);
  const found = isTrashed(snapshot, item)
    ? undefined
    : findItem(snapshot, item);
  const location = found ? parentOf(snapshot, found) : null;
  const [selected, setSelected] = useState<ParentId>(location);
  const [renaming, setRenaming] = useState<FolderId | null>(null);
  const disabled = useMemo(
    () =>
      new Set(
        item.kind === "folder"
          ? subtree(snapshot, item.id).folders.map((folder) => folder.id)
          : [],
      ),
    [snapshot, item],
  );

  // the choice it starts on, where the item is, rather than the dialog's
  // first button
  const focusChoice = useCallback((tree: HTMLDivElement | null) => {
    tree
      ?.querySelector<HTMLButtonElement>('button[aria-current="location"]')
      ?.focus();
  }, []);

  // such as when another tab deletes it or moves it to the Trash
  useEffect(() => {
    if (!found) {
      onClose();
    }
  }, [found, onClose]);
  if (!found) {
    return null;
  }

  const newFolder = async () => {
    try {
      const folder = await store.createFolder(
        selected,
        uniqueName(store.getSnapshot(), selected, t("workspace.newFolderName")),
      );
      setSelected(folder.id);
      setRenaming(folder.id);
    } catch (error) {
      console.error(error);
    }
  };

  const move = async () => {
    try {
      const result = await store.move(item, selected);
      if (!result.ok) {
        console.error("Couldn't move", item, result.reason);
      }
    } catch (error) {
      console.error(error);
    }
    onClose();
  };

  return (
    <Dialog
      title={t("workspace.moveTitle", {
        name: found.name || t("labels.untitled"),
      })}
      size="small"
      className="move-dialog"
      autofocus={false}
      onCloseRequest={onClose}
    >
      <div className="move-dialog__tree" ref={focusChoice}>
        <FolderTree
          snapshot={snapshot}
          currentId={selected}
          picker={{
            onSelect: setSelected,
            location,
            disabled,
            renaming: renaming && {
              id: renaming,
              onSave: (name) => {
                store
                  .renameFolder(renaming, name)
                  .catch((error) => console.error(error));
              },
              onClose: () => setRenaming(null),
            },
          }}
        />
      </div>
      <div className="move-dialog__actions">
        <FilledButton
          variant="outlined"
          icon={newFolderIcon}
          onClick={newFolder}
        >
          {t("workspace.newFolder")}
        </FilledButton>
        <div className="move-dialog__confirm">
          <FilledButton variant="outlined" color="muted" onClick={onClose}>
            {t("buttons.cancel")}
          </FilledButton>
          <FilledButton onClick={move} disabled={selected === location}>
            {t("workspace.move")}
          </FilledButton>
        </div>
      </div>
    </Dialog>
  );
};
