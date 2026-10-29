import { LoadIcon } from "@setsquare/setsquare/components/icons";
import { useI18n } from "@setsquare/setsquare/i18n";

import { RouteLink } from "../../web/RouteLink";

import { InlineName, useCardRename } from "./InlineName";
import { ItemMenu } from "./ItemMenu";

import type { Folder } from "../types";

/**
 * A folder of the grid, drawn as a drawer label with a tab. The whole card
 * is its link.
 */
export const FolderCard = ({
  folder,
  location,
  renaming,
  onStartRename,
  onStopRename,
  onRename,
}: {
  folder: Folder;
  /** where the folder is, for lists across folders */
  location?: string;
  renaming: boolean;
  onStartRename: () => void;
  onStopRename: () => void;
  onRename: (name: string) => void;
}) => {
  const { t } = useI18n();
  const { cardRef, onKeyDown, onClose } = useCardRename({
    renaming,
    onStart: onStartRename,
    onStop: onStopRename,
  });
  const to = { kind: "drawings", folderId: folder.id } as const;

  return (
    <li
      ref={cardRef}
      className="workspace-card folder-card"
      onKeyDown={onKeyDown}
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
        />
      </div>
    </li>
  );
};
