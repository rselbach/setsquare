import { useI18n } from "@setsquare/setsquare/i18n";
import { useId } from "react";

import { DrawingCard } from "./DrawingCard";
import { FolderCard } from "./FolderCard";

import type {
  DrawingId,
  DrawingMeta,
  Folder,
  FolderId,
  ItemRef,
  Thumbnail,
  WorkspaceItem,
} from "../types";

/** What the cards of the grid do to their items. */
export type ItemActions = {
  startRename: (item: ItemRef) => void;
  stopRename: () => void;
  renameFolder: (id: FolderId, name: string) => void;
  renameDrawing: (id: DrawingId, name: string | null) => void;
  duplicate: (drawing: DrawingMeta) => void;
};

const isRenaming = (renaming: ItemRef | null, item: ItemRef) =>
  renaming?.kind === item.kind && renaming.id === item.id;

/** Folders first, then drawings, each under a caption of its own. */
export const ItemGrid = ({
  folders,
  drawings,
  thumbnails,
  now,
  locationOf,
  renaming,
  actions,
}: {
  folders: readonly Folder[];
  drawings: readonly DrawingMeta[];
  thumbnails: ReadonlyMap<DrawingId, Thumbnail>;
  now: number;
  /** where each item is, for lists across folders */
  locationOf?: (item: WorkspaceItem) => string;
  renaming: ItemRef | null;
  actions: ItemActions;
}) => {
  const { t } = useI18n();
  const id = useId();

  return (
    <>
      {folders.length > 0 && (
        <section className="workspace-section" aria-labelledby={`${id}-f`}>
          <h2 id={`${id}-f`} className="workspace-section__caption">
            {t("workspace.folders")}
          </h2>
          <ul className="workspace-folders">
            {folders.map((folder) => {
              const ref = { kind: "folder", id: folder.id } as const;
              return (
                <FolderCard
                  key={folder.id}
                  folder={folder}
                  location={locationOf?.(folder)}
                  renaming={isRenaming(renaming, ref)}
                  onStartRename={() => actions.startRename(ref)}
                  onStopRename={actions.stopRename}
                  onRename={(name) => actions.renameFolder(folder.id, name)}
                />
              );
            })}
          </ul>
        </section>
      )}
      {drawings.length > 0 && (
        <section className="workspace-section" aria-labelledby={`${id}-d`}>
          <h2 id={`${id}-d`} className="workspace-section__caption">
            {t("workspace.drawings")}
          </h2>
          <ul className="workspace-drawings">
            {drawings.map((drawing) => {
              const ref = { kind: "drawing", id: drawing.id } as const;
              return (
                <DrawingCard
                  key={drawing.id}
                  drawing={drawing}
                  thumbnail={thumbnails.get(drawing.id)}
                  now={now}
                  location={locationOf?.(drawing)}
                  renaming={isRenaming(renaming, ref)}
                  onStartRename={() => actions.startRename(ref)}
                  onStopRename={actions.stopRename}
                  onRename={(name) => actions.renameDrawing(drawing.id, name)}
                  onDuplicate={() => actions.duplicate(drawing)}
                />
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
};
