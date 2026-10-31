import { LoadIcon } from "@setsquare/setsquare/components/icons";
import { useI18n } from "@setsquare/setsquare/i18n";
import clsx from "clsx";

import { RouteLink } from "../../web/RouteLink";

import { InlineName, useCardKeys } from "./InlineName";
import { ItemMenu } from "./ItemMenu";
import { useDragSource, useDropTarget } from "./useWorkspaceDrag";

import type { Folder } from "../types";

/**
 * A folder of the grid, drawn as a drawer label with a tab. The whole card
 * is its link, which can be dragged, and items can be dropped on it.
 */
export const FolderCard = ({
  folder,
  location,
  renaming,
  onStartRename,
  onStopRename,
  onRename,
  onMove,
  onTrash,
}: {
  folder: Folder;
  /** where the folder is, for lists across folders */
  location?: string;
  renaming: boolean;
  onStartRename: () => void;
  onStopRename: () => void;
  onRename: (name: string) => void;
  /** given the card, where the focus goes back to */
  onMove: (card: HTMLElement | null) => void;
  onTrash: (card: HTMLElement | null) => void;
}) => {
  const { t } = useI18n();
  const { cardRef, onKeyDown, onClose } = useCardKeys({
    renaming,
    onStart: onStartRename,
    onStop: onStopRename,
    onTrash,
  });
  const to = { kind: "drawings", folderId: folder.id } as const;
  const { dragging, sourceProps } = useDragSource({
    kind: "folder",
    id: folder.id,
  });
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
              onSave={(name) => name && onRename(name)}
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
          onMove={() => onMove(cardRef.current)}
          onTrash={() => onTrash(cardRef.current)}
        />
      </div>
    </li>
  );
};
