import { LoadIcon } from "@setsquare/setsquare/components/icons";
import { useI18n } from "@setsquare/setsquare/i18n";
import clsx from "clsx";
import { memo } from "react";

import { RouteLink } from "../../web/RouteLink";

import { InlineName, useCardKeys } from "./InlineName";
import { ItemMenu } from "./ItemMenu";
import { useDragSource, useDropTarget } from "./useWorkspaceDrag";

import type { Folder } from "../types";

import type { ItemActions } from "./ItemGrid";

/**
 * A folder of the grid, drawn as a drawer label with a tab. The whole card
 * is its link, which can be dragged, and items can be dropped on it. It
 * rerenders only when what it shows changes, so keep `actions` the same.
 */
export const FolderCard = memo(
  ({
    folder,
    location,
    renaming,
    actions,
  }: {
    folder: Folder;
    /** where the folder is, for lists across folders */
    location?: string;
    renaming: boolean;
    actions: ItemActions;
  }) => {
    const { t } = useI18n();
    const item = { kind: "folder", id: folder.id } as const;
    const onStartRename = () => actions.startRename(item);
    const { cardRef, onKeyDown, onClose } = useCardKeys({
      renaming,
      onStart: onStartRename,
      onStop: actions.stopRename,
      onTrash: (card) => actions.trash(item, card),
    });
    const to = { kind: "drawings", folderId: folder.id } as const;
    const { dragging, sourceProps } = useDragSource(item);
    const { isOver, targetProps } = useDropTarget({
      kind: "folder",
      id: folder.id,
    });

    return (
      <li
        ref={cardRef}
        className={clsx("workspace-card folder-card", {
          "workspace-card--dragging": dragging,
          "workspace-drop": isOver,
        })}
        onKeyDown={onKeyDown}
        {...(renaming ? {} : sourceProps)}
        {...targetProps}
      >
        <div className="workspace-card__strip">
          <span className="folder-card__icon" aria-hidden="true">
            {LoadIcon}
          </span>
          <div className="workspace-card__label">
            {renaming ? (
              <InlineName
                name={folder.name}
                label={t("workspace.folderName")}
                className="workspace-card__name-field"
                // a folder always has a name
                onSave={(name) => name && actions.renameFolder(folder.id, name)}
                onClose={onClose}
              />
            ) : (
              <RouteLink to={to} className="workspace-card__link">
                <span className="workspace-card__name" title={folder.name}>
                  {folder.name}
                </span>
              </RouteLink>
            )}
            {location && (
              <span className="workspace-card__location">{location}</span>
            )}
          </div>
          <ItemMenu
            label={t("workspace.folderActions", { name: folder.name })}
            to={to}
            onRename={onStartRename}
            onMove={() => actions.move(item, cardRef.current)}
            onTrash={() => actions.trash(item, cardRef.current)}
          />
        </div>
      </li>
    );
  },
);
