import ConfirmDialog from "@setsquare/setsquare/components/ConfirmDialog";
import { FilledButton } from "@setsquare/setsquare/components/FilledButton";
import { LoadIcon, TrashIcon } from "@setsquare/setsquare/components/icons";
import { useI18n } from "@setsquare/setsquare/i18n";
import clsx from "clsx";
import { useMemo, useState } from "react";

import { restoreIcon } from "../../web/icons";
import { formatTimeAgo } from "../formatRelativeTime";
import { ancestors, parentOf, trashRoots } from "../tree";

import { EmptyState } from "./EmptyState";
import { useThumbnails } from "./useThumbnails";
import { NavButton } from "./WorkspaceNav";

import type {
  ItemRef,
  Thumbnail,
  WorkspaceItem,
  WorkspaceSnapshot,
} from "../types";
import type { ReactNode } from "react";

import type { WorkspaceStore } from "../WorkspaceStore";

import type { NavToggle } from "./WorkspaceNav";

const refOf = (item: WorkspaceItem): ItemRef =>
  "parentId" in item
    ? { kind: "folder", id: item.id }
    : { kind: "drawing", id: item.id };

/** What's to be deleted for good once the user confirms it. */
type Confirming =
  | { kind: "item"; item: ItemRef; name: string }
  | { kind: "empty" };

const TrashRow = ({
  item,
  thumbnail,
  location,
  now,
  onRestore,
  onDelete,
}: {
  item: WorkspaceItem;
  thumbnail?: Thumbnail;
  location: string;
  now: number;
  onRestore: () => void;
  onDelete: () => void;
}) => {
  const { t, langCode } = useI18n();
  const isFolder = "parentId" in item;
  const name = item.name || t("labels.untitled");
  // trashed items always have the time they were trashed
  const trashedAt = item.trashedAt ?? now;
  const ago = formatTimeAgo(trashedAt, now, langCode);

  return (
    <li className="trash-row" aria-label={name}>
      <div
        className={clsx("trash-row__sheet", {
          "trash-row__sheet--folder": isFolder,
        })}
        aria-hidden="true"
      >
        {isFolder
          ? LoadIcon
          : thumbnail && <img src={thumbnail.src} alt="" draggable={false} />}
      </div>
      <div className="trash-row__label">
        <span
          className={clsx("trash-row__name", {
            "trash-row__name--untitled": !item.name,
          })}
          title={name}
        >
          {name}
        </span>
        <span className="trash-row__location" title={location}>
          {location}
        </span>
      </div>
      <time
        className="trash-row__deleted"
        dateTime={new Date(trashedAt).toISOString()}
      >
        {ago === null
          ? t("workspace.deletedJustNow")
          : t("workspace.deletedAgo", { time: ago })}
      </time>
      <div className="trash-row__actions">
        <FilledButton variant="outlined" icon={restoreIcon} onClick={onRestore}>
          {t("workspace.restore")}
        </FilledButton>
        <FilledButton
          variant="outlined"
          color="danger"
          icon={TrashIcon}
          onClick={onDelete}
        >
          {t("workspace.deleteForever")}
        </FilledButton>
      </div>
    </li>
  );
};

/**
 * The Trash at `/trash`: what was moved there, the latest first, with
 * where each was and when it went. A folder there holds what was in it,
 * which shows again once it's restored. Restoring needs no confirmation,
 * but deleting for good does. Nothing here opens in the editor.
 */
export const TrashView = ({
  store,
  snapshot,
  now,
  nav,
  account,
}: {
  store: WorkspaceStore;
  snapshot: WorkspaceSnapshot;
  now: number;
  /** shows the nav where it's hidden */
  nav: NavToggle;
  /** who is signed in, at the right end of the bar */
  account: ReactNode;
}) => {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState<Confirming | null>(null);

  const { folders, drawings } = useMemo(() => trashRoots(snapshot), [snapshot]);
  const items = useMemo(
    () =>
      [...folders, ...drawings].sort(
        (a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0),
      ),
    [folders, drawings],
  );
  const thumbnails = useThumbnails(store, drawings);

  const drawingsName = t("workspace.drawings");
  // where it was, as its folder is now; one that's gone means the root,
  // where restoring puts it
  const locationOf = (item: WorkspaceItem) =>
    [
      drawingsName,
      ...ancestors(snapshot, parentOf(snapshot, item)).map(
        (folder) => folder.name,
      ),
    ].join(" › ");

  const deleteForever = (confirmed: Confirming) => {
    const deleting =
      confirmed.kind === "empty"
        ? store.emptyTrash()
        : store.deleteForever(confirmed.item);
    deleting.catch((error) => console.error(error));
  };

  return (
    <>
      <header className="workspace-header">
        <div className="workspace-header__bar">
          <NavButton nav={nav} />
          <div className="workspace-header__heading">
            <h1 className="workspace-header__title">{t("workspace.trash")}</h1>
          </div>
          {account}
        </div>
        <div className="workspace-header__toolbar">
          <p className="trash-view__retention">
            {t("workspace.trashRetention")}
          </p>
          {items.length > 0 && (
            <FilledButton
              variant="outlined"
              color="danger"
              icon={TrashIcon}
              onClick={() => setConfirming({ kind: "empty" })}
            >
              {t("workspace.emptyTrash")}
            </FilledButton>
          )}
        </div>
      </header>
      <div className="workspace__content">
        {items.length ? (
          <ul className="trash-list" aria-label={t("workspace.trash")}>
            {items.map((item) => {
              const ref = refOf(item);
              return (
                <TrashRow
                  key={item.id}
                  item={item}
                  thumbnail={
                    "folderId" in item ? thumbnails.get(item.id) : undefined
                  }
                  location={locationOf(item)}
                  now={now}
                  onRestore={() => {
                    store.restore(ref).catch((error) => console.error(error));
                  }}
                  onDelete={() =>
                    setConfirming({
                      kind: "item",
                      item: ref,
                      name: item.name || t("labels.untitled"),
                    })
                  }
                />
              );
            })}
          </ul>
        ) : (
          <EmptyState title={t("workspace.trashEmpty")}>
            <p>{t("workspace.trashEmptyHint")}</p>
          </EmptyState>
        )}
      </div>
      {confirming && (
        <ConfirmDialog
          title={
            confirming.kind === "empty"
              ? t("workspace.emptyTrashTitle")
              : t("workspace.deleteForeverTitle", { name: confirming.name })
          }
          confirmText={
            confirming.kind === "empty"
              ? t("workspace.emptyTrash")
              : t("workspace.deleteForever")
          }
          onConfirm={() => {
            setConfirming(null);
            deleteForever(confirming);
          }}
          onCancel={() => setConfirming(null)}
        >
          <p>
            {confirming.kind === "empty"
              ? t("workspace.emptyTrashHint")
              : confirming.item.kind === "folder"
              ? t("workspace.deleteFolderForeverHint")
              : t("workspace.deleteDrawingForeverHint")}
          </p>
        </ConfirmDialog>
      )}
    </>
  );
};
