import { APP_NAME, KEYS, isWritableElement } from "@setsquare/common";
import { StandaloneUIProvider, useEditorInterface } from "@setsquare/setsquare";
import { FilledButton } from "@setsquare/setsquare/components/FilledButton";
import { PlusIcon } from "@setsquare/setsquare/components/icons";
import { useI18n } from "@setsquare/setsquare/i18n";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { Theme } from "@setsquare/element/types";

import { useAppLangCode } from "../../app-language/language-state";
import { STORAGE_KEYS } from "../../app_constants";
import { useWorkspaceAccount } from "../../web/accountContext";
import {
  AccountMenu,
  AccountNotice,
  importBrowserDrawings,
} from "../../web/accountControls";
import { useBrowserImport } from "../../web/browserImport";
import { navigate, routeToPath } from "../../web/router";
import { useNow } from "../../web/useNow";
import { useWorkspaceSnapshot } from "../../web/useWorkspaceSnapshot";
import {
  attempt,
  reportFailure,
  useWorkspaceActions,
} from "../../web/workspaceActions";
import {
  ancestors,
  childrenOf,
  parentOf,
  recentDrawings,
  searchItems,
  sortItems,
  uniqueName,
  visibleFolder,
} from "../tree";

import { EmptyState } from "./EmptyState";
import { ItemGrid } from "./ItemGrid";
import { MoveDialog } from "./MoveDialog";
import { TrashView } from "./TrashView";
import { useThumbnails } from "./useThumbnails";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { WorkspaceToast, useTasksOnPage } from "./WorkspaceToast";

import "./Workspace.scss";

import type { Dispatch, ReactNode, SetStateAction } from "react";

import type { QueuedTasks } from "../../web/editorTasks";
import type { Route } from "../../web/router";
import type { SortOrder } from "../tree";
import type {
  DrawingMeta,
  ItemRef,
  ParentId,
  WorkspaceItem,
  WorkspaceItems,
} from "../types";
import type { WorkspaceStore } from "../WorkspaceStore";

import type { ItemActions } from "./ItemGrid";
import type { Crumb } from "./WorkspaceHeader";
import type { NavToggle } from "./WorkspaceNav";
import type { WorkspaceToastState } from "./WorkspaceToast";

/** The addresses the workspace page shows. */
export type PageRoute = Extract<
  Route,
  { kind: "drawings" | "recent" | "trash" }
>;

/** The page's search over the workspace, on the page at path. */
export type PageSearch = { path: string; query: string; open: boolean };

/**
 * The search on the page at route, which each page starts without. The
 * app holds it, since the nav marks no place while it shows results.
 */
export const usePageSearch = (route: Route) => {
  const path = routeToPath(route);
  const [search, setSearch] = useState<PageSearch>({
    path,
    query: "",
    open: false,
  });
  if (search.path !== path) {
    setSearch({ path, query: "", open: false });
  }
  return [search, setSearch] as const;
};

/** Whether the page shows search results rather than its place. */
export const isSearching = (route: Route, search: PageSearch) =>
  route.kind !== "trash" && search.query.trim() !== "";

type WorkspacePageProps = {
  store: WorkspaceStore;
  route: PageRoute;
  /** the theme shown, with "system" resolved */
  theme: Theme;
  nav: NavToggle;
  search: PageSearch;
  setSearch: Dispatch<SetStateAction<PageSearch>>;
  /** what's left to show from the editor or from opening files */
  tasks: QueuedTasks;
  toast: WorkspaceToastState;
  /** moves an item to the Trash, offering Undo */
  trash: (item: ItemRef) => void;
};

const ROOT = { kind: "drawings", folderId: null } as const;

const loadSortOrder = (): SortOrder =>
  localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_WORKSPACE_SORT) === "name"
    ? "name"
    : "updated";

// the sort chosen last in this browser
const useSortOrder = () => {
  const [order, setOrder] = useState(loadSortOrder);
  const change = useCallback((order: SortOrder) => {
    localStorage.setItem(STORAGE_KEYS.LOCAL_STORAGE_WORKSPACE_SORT, order);
    setOrder(order);
  }, []);
  return [order, change] as const;
};

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
// card that took its place, or the one before it, or the first one left
const focusBack = (
  { card, list, index }: CardPlace,
  content: HTMLElement | null,
) => {
  if (card.isConnected) {
    card.querySelector<HTMLElement>(".workspace-card__more")?.focus();
    return;
  }
  const cards = list?.isConnected ? [...list.children] : [];
  const near =
    cards[Math.min(index, cards.length - 1)] ?? content?.querySelector("li");
  near?.querySelector("a")?.focus();
};

const WorkspaceView = ({
  store,
  route,
  nav,
  search,
  setSearch,
  tasks,
  toast,
  trash,
}: Omit<WorkspacePageProps, "theme">) => {
  const { t } = useI18n();
  const account = useWorkspaceAccount();
  const browserImport = useBrowserImport(store);
  const isPhone = useEditorInterface().formFactor === "phone";
  const snapshot = useWorkspaceSnapshot(store);
  const now = useNow();
  const searchRef = useRef<HTMLInputElement>(null);
  const path = routeToPath(route);
  const [sortOrder, setSortOrder] = useSortOrder();
  // what Move to… is moving, and the card it was chosen on
  const [moving, setMoving] = useState<{
    item: ItemRef;
    from: CardPlace | null;
  } | null>(null);
  const movedFrom = useRef<CardPlace | null>(null);
  const trashedFrom = useRef<CardPlace | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // what's being renamed, on the page it shows on
  const [renaming, setRenaming] = useState<{
    item: ItemRef;
    path: string;
  } | null>(null);
  useTasksOnPage(tasks, toast.show);

  // a folder that's gone or in the Trash has nothing to show
  const requested = route.kind === "drawings" ? route.folderId : null;
  const folderId = visibleFolder(snapshot, requested);
  useEffect(() => {
    if (requested !== folderId) {
      navigate(ROOT, { replace: true });
    }
  }, [requested, folderId]);

  const query = search.query.trim();
  const view =
    route.kind === "trash"
      ? "trash"
      : isSearching(route, search)
      ? "search"
      : route.kind === "recent"
      ? "recent"
      : "folder";
  const items = useMemo((): WorkspaceItems => {
    const sorted = ({ folders, drawings }: WorkspaceItems) => ({
      folders: sortItems(folders, sortOrder),
      drawings: sortItems(drawings, sortOrder),
    });
    switch (view) {
      case "search":
        return sorted(searchItems(snapshot, query));
      case "recent":
        return { folders: [], drawings: recentDrawings(snapshot) };
      case "folder":
        return sorted(childrenOf(snapshot, folderId));
      // the Trash lists its own
      case "trash":
        return { folders: [], drawings: [] };
    }
  }, [snapshot, view, query, folderId, sortOrder]);
  const thumbnails = useThumbnails(store, items.drawings);

  useLayoutEffect(() => {
    const from = movedFrom.current;
    if (!moving && from) {
      movedFrom.current = null;
      if (isFocusLost()) {
        focusBack(from, contentRef.current);
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
        focusBack(from, contentRef.current);
      }
    }
  }, [items]);

  // the folder shown, or the root for lists across folders
  const createIn: ParentId = view === "folder" ? folderId : null;
  const { newDrawing, openFile } = useWorkspaceActions(
    store,
    useCallback(() => createIn, [createIn]),
    tasks.queueTask,
  );

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
      reportFailure(toast.show, { error }, "newFolder");
    }
  };

  const itemActions: ItemActions = {
    startRename: (item) => setRenaming({ item, path }),
    stopRename: () => setRenaming(null),
    renameFolder: (id, name) => {
      void attempt(toast.show, store.renameFolder(id, name), "rename", name);
    },
    renameDrawing: (id, name) => {
      void attempt(
        toast.show,
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
    duplicate: async (drawing: DrawingMeta) => {
      const shownName = drawing.name || t("labels.untitled");
      try {
        const snap = store.getSnapshot();
        const name = t("workspace.copyName", { name: shownName });
        const copy = await store.duplicateDrawing(
          drawing.id,
          uniqueName(snap, parentOf(snap, drawing), name),
        );
        if (!copy) {
          reportFailure(
            toast.show,
            { reason: "notFound" },
            "duplicate",
            shownName,
          );
        }
      } catch (error) {
        reportFailure(toast.show, { error }, "duplicate", shownName);
      }
    },
  };

  const { undo } = toast;
  const canUndo = !!toast.message?.undo;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        // the toast's Undo, while it shows
        canUndo &&
        event.key.toLowerCase() === KEYS.Z &&
        event[KEYS.CTRL_OR_CMD] &&
        !event.shiftKey &&
        !event.altKey &&
        !isWritableElement(event.target)
      ) {
        event.preventDefault();
        undo();
      } else if (
        view !== "trash" &&
        event.key === KEYS.SLASH &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !isWritableElement(event.target)
      ) {
        // the slash would go in the field too
        event.preventDefault();
        setSearch((search) => ({ ...search, open: true }));
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [canUndo, undo, view, setSearch]);

  // a phone shows the field only once it's opened
  useEffect(() => {
    if (search.open) {
      searchRef.current?.focus();
    }
  }, [search.open]);

  const drawingsName = t("workspace.drawings");
  const trail = ancestors(snapshot, folderId);
  const crumbs: Crumb[] =
    view === "folder" && folderId !== null
      ? [
          { folderId: null, name: drawingsName },
          ...trail.slice(0, -1).map((folder) => ({
            folderId: folder.id,
            name: folder.name,
          })),
        ]
      : [];
  const title =
    view === "search"
      ? t("workspace.searchResults")
      : view === "recent"
      ? t("workspace.recent")
      : view === "trash"
      ? t("workspace.trash")
      : trail[trail.length - 1]?.name ?? drawingsName;
  const isRoot = view === "folder" && folderId === null;
  useEffect(() => {
    document.title = isRoot ? APP_NAME : `${title} · ${APP_NAME}`;
  }, [isRoot, title]);

  const locationOf =
    view === "folder"
      ? undefined
      : (item: WorkspaceItem) =>
          [
            drawingsName,
            ...ancestors(snapshot, parentOf(snapshot, item)).map(
              (folder) => folder.name,
            ),
          ].join(" › ");

  let empty: ReactNode = null;
  if (!items.folders.length && !items.drawings.length) {
    switch (view) {
      case "search":
        empty = <EmptyState title={t("workspace.noResults", { query })} />;
        break;
      case "recent":
        empty = (
          <EmptyState title={t("workspace.emptyRecent")}>
            <p>{t("workspace.emptyRecentHint")}</p>
          </EmptyState>
        );
        break;
      case "trash":
        break;
      case "folder":
        empty =
          folderId === null ? (
            <EmptyState title={t("workspace.emptyWorkspace")}>
              <FilledButton icon={PlusIcon} onClick={newDrawing}>
                {t("workspace.newDrawing")}
              </FilledButton>
              {(!account ||
                account.state.kind === "local" ||
                account.state.kind === "signedOut" ||
                account.state.kind === "unreachable") && (
                <p className="workspace-empty__warning">
                  {t("welcomeScreen.app.center_heading")}{" "}
                  {t("welcomeScreen.app.center_heading_line2")}
                </p>
              )}
              {browserImport &&
                browserImport.state.kind !== "checking" &&
                browserImport.state.pending > 0 && (
                  <div className="workspace-empty__import">
                    <p>
                      {browserImport.state.pending === 1
                        ? t("workspace.emptyImportOne")
                        : t("workspace.emptyImport", {
                            count: browserImport.state.pending,
                          })}
                    </p>
                    <button
                      type="button"
                      className="account-button"
                      disabled={browserImport.state.kind === "importing"}
                      onClick={() =>
                        importBrowserDrawings(browserImport.run, toast)
                      }
                    >
                      {browserImport.state.kind === "importing"
                        ? t("workspace.accountImporting")
                        : t("workspace.accountImport")}
                    </button>
                  </div>
                )}
            </EmptyState>
          ) : (
            <EmptyState title={t("workspace.emptyFolder")}>
              <p>{t("workspace.emptyFolderHint")}</p>
            </EmptyState>
          );
        break;
    }
  }

  const accountMenu = <AccountMenu toast={toast} />;

  return (
    <div className="workspace">
      <main className="workspace__main">
        {view === "trash" ? (
          <TrashView
            store={store}
            snapshot={snapshot}
            now={now}
            nav={nav}
            account={accountMenu}
          />
        ) : (
          <>
            <WorkspaceHeader
              title={title}
              crumbs={crumbs}
              back={crumbs[crumbs.length - 1] ?? null}
              isPhone={isPhone}
              nav={nav}
              search={{
                query: search.query,
                onChange: (query) =>
                  setSearch((search) => ({ ...search, query })),
                inputRef: searchRef,
                open: search.open,
                onOpenChange: (open) =>
                  setSearch((search) => ({ ...search, open })),
              }}
              // Recent is in the order it was used
              sort={
                view === "recent"
                  ? null
                  : { order: sortOrder, onChange: setSortOrder }
              }
              actions={{ newDrawing, newFolder, openFile }}
              account={accountMenu}
            />
            <div className="workspace__content" ref={contentRef}>
              {empty ?? (
                <ItemGrid
                  folders={items.folders}
                  drawings={items.drawings}
                  thumbnails={thumbnails}
                  now={now}
                  locationOf={locationOf}
                  renaming={renaming?.path === path ? renaming.item : null}
                  actions={itemActions}
                />
              )}
            </div>
          </>
        )}
      </main>
      {moving && (
        <MoveDialog
          store={store}
          item={moving.item}
          onClose={() => {
            movedFrom.current = moving.from;
            setMoving(null);
          }}
        />
      )}
      <WorkspaceToast toast={toast} />
      <AccountNotice />
    </div>
  );
};

/**
 * The workspace's page of folders and drawings, at `/`, `/f/<id>` and
 * `/recent`, beside the shell's nav: a header to search, sort and create,
 * and the items of the folder shown as cards that link to them, which can
 * be moved, by Move to… or dragging, and trashed with Undo. At
 * `/trash` it shows the Trash. It has the editor's look, theme and language
 * without the editor, and shows what's left from an editor that didn't come.
 */
export const WorkspacePage = ({ theme, ...props }: WorkspacePageProps) => {
  const [langCode] = useAppLangCode();
  return (
    <StandaloneUIProvider
      theme={theme}
      langCode={langCode}
      className="setsquare-workspace"
    >
      <WorkspaceView {...props} />
    </StandaloneUIProvider>
  );
};
