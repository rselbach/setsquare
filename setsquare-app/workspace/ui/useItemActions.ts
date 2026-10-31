import { useI18n } from "@setsquare/setsquare/i18n";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { navigate, routeToPath } from "../../web/router";
import {
  attempt,
  duplicateDrawing,
  reportFailure,
} from "../../web/workspaceActions";
import { uniqueName } from "../tree";

import type { Dispatch, SetStateAction } from "react";

import type { DrawingMeta, ItemRef, ParentId, WorkspaceItems } from "../types";
import type { WorkspaceStore } from "../WorkspaceStore";

import type { ItemActions } from "./ItemGrid";
import type { PageSearch, PageView } from "./WorkspacePage";
import type { WorkspaceToastState } from "./WorkspaceToast";

const ROOT = { kind: "drawings", folderId: null } as const;

/** A card the focus left for Move to… or the Trash, and where it was. */
type CardPlace = { card: HTMLElement; list: HTMLElement | null; index: number };

const placeOf = (card: HTMLElement | null): CardPlace | null => {
  if (!card) {
    return null;
  }
  const list = card.parentElement;
  return { card, list, index: list ? [...list.children].indexOf(card) : 0 };
};

// whether the focus fell to the page, as when what had it went
const isFocusLost = () =>
  !document.activeElement || document.activeElement === document.body;

// back to the card's ⋯ button, or once the card's gone, to the link of the
// card that took its place, or the one before it, or the first one left, or
// with none left, to the page's heading
const focusBack = (
  { card, list, index }: CardPlace,
  main: HTMLElement | null,
) => {
  if (card.isConnected) {
    card.querySelector<HTMLElement>(".workspace-card__more")?.focus();
    return;
  }
  const cards = list?.isConnected ? [...list.children] : [];
  const near =
    cards[Math.min(index, cards.length - 1)] ??
    main?.querySelector(".workspace__content li");
  (near?.querySelector("a") ?? main?.querySelector<HTMLElement>("h1"))?.focus();
};

/**
 * What the page's cards and New folder do, at path: renaming, Move to…,
 * the Trash and duplicating, with the focus given back to the cards once
 * Move to… closes or a card goes to the Trash. Give `mainRef` to the
 * element the cards are in.
 */
export const useItemActions = ({
  store,
  path,
  view,
  createIn,
  items,
  setSearch,
  show,
  trash,
}: {
  store: WorkspaceStore;
  path: string;
  view: PageView;
  /** where New folder makes its folder */
  createIn: ParentId;
  /** the items shown, which change as a trashed card goes */
  items: WorkspaceItems;
  setSearch: Dispatch<SetStateAction<PageSearch>>;
  show: WorkspaceToastState["show"];
  /** moves an item to the Trash, offering Undo */
  trash: (item: ItemRef) => void;
}) => {
  const { t } = useI18n();
  // what Move to… is moving, and the card it was chosen on
  const [moving, setMoving] = useState<{
    item: ItemRef;
    from: CardPlace | null;
  } | null>(null);
  const movedFrom = useRef<CardPlace | null>(null);
  const trashedFrom = useRef<CardPlace | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  // what's being renamed, on the page it shows on
  const [renaming, setRenaming] = useState<{
    item: ItemRef;
    path: string;
  } | null>(null);

  useLayoutEffect(() => {
    const from = movedFrom.current;
    if (!moving && from) {
      movedFrom.current = null;
      if (isFocusLost()) {
        focusBack(from, mainRef.current);
      }
    }
  }, [moving]);

  // once the trashed card goes, which is after its menu gave its ⋯ button
  // the focus back
  useLayoutEffect(() => {
    const from = trashedFrom.current;
    if (from && !from.card.isConnected) {
      trashedFrom.current = null;
      if (isFocusLost()) {
        focusBack(from, mainRef.current);
      }
    }
  }, [items]);

  const newFolder = async () => {
    try {
      const folder = await store.createFolder(
        createIn,
        uniqueName(store.getSnapshot(), createIn, t("workspace.newFolderName")),
      );
      // straight into renaming, where the folder shows
      setRenaming({
        item: { kind: "folder", id: folder.id },
        path: routeToPath({ kind: "drawings", folderId: createIn }),
      });
      if (view !== "folder") {
        if (path === routeToPath(ROOT)) {
          setSearch({ path, query: "", open: false });
        } else {
          navigate(ROOT);
        }
      }
    } catch (error) {
      reportFailure(show, { error }, "newFolder");
    }
  };

  const itemActions = useMemo(
    (): ItemActions => ({
      startRename: (item) => setRenaming({ item, path }),
      stopRename: () => setRenaming(null),
      renameFolder: (id, name) => {
        void attempt(show, store.renameFolder(id, name), "rename", name);
      },
      renameDrawing: (id, name) => {
        void attempt(
          show,
          store.renameDrawing(id, name),
          "rename",
          name || t("labels.untitled"),
        );
      },
      move: (item, card) => setMoving({ item, from: placeOf(card) }),
      trash: (item, card) => {
        trashedFrom.current = placeOf(card);
        trash(item);
      },
      duplicate: (drawing: DrawingMeta) => {
        void duplicateDrawing(store, drawing.id, show, {
          name: drawing.name || t("labels.untitled"),
        });
      },
    }),
    [path, store, show, trash, t],
  );

  const stopMoving = () => {
    movedFrom.current = moving?.from ?? null;
    setMoving(null);
  };

  return {
    itemActions,
    newFolder,
    /** what's being renamed on this page */
    renaming: renaming?.path === path ? renaming.item : null,
    /** what Move to… is moving */
    moving: moving?.item ?? null,
    stopMoving,
    mainRef,
  };
};
