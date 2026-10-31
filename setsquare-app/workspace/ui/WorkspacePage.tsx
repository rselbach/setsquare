import { APP_NAME } from "@setsquare/common";
import { StandaloneUIProvider, useEditorInterface } from "@setsquare/setsquare";
import { useI18n } from "@setsquare/setsquare/i18n";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { Theme } from "@setsquare/element/types";

import { useAppLangCode } from "../../app-language/language-state";
import { STORAGE_KEYS } from "../../app_constants";
import { AccountMenu, AccountNotice } from "../../web/accountControls";
import { useBrowserImport } from "../../web/browserImport";
import { navigate, routeToPath } from "../../web/router";
import { useNow } from "../../web/useNow";
import { useWorkspaceSnapshot } from "../../web/useWorkspaceSnapshot";
import { useWorkspaceActions } from "../../web/workspaceActions";
import {
  ancestors,
  childrenOf,
  locationLabel,
  recentDrawings,
  searchItems,
  sortItems,
  visibleFolder,
} from "../tree";

import { EmptyView } from "./EmptyView";
import { ItemGrid } from "./ItemGrid";
import { MoveDialog } from "./MoveDialog";
import { TrashView } from "./TrashView";
import { useItemActions } from "./useItemActions";
import { usePageShortcuts } from "./usePageShortcuts";
import { useThumbnails } from "./useThumbnails";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { WorkspaceToast, useTasksOnPage } from "./WorkspaceToast";

import "./Workspace.scss";

import type { Dispatch, SetStateAction } from "react";

import type { QueuedTasks } from "../../web/editorTasks";
import type { Route } from "../../web/router";
import type { SortOrder } from "../tree";
import type {
  ItemRef,
  ParentId,
  WorkspaceItem,
  WorkspaceItems,
  WorkspaceSnapshot,
} from "../types";
import type { WorkspaceStore } from "../WorkspaceStore";

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

/** What the page lists: a folder, search results, Recent or the Trash. */
export type PageView = "folder" | "search" | "recent" | "trash";

// what the page at route shows, and the folder it shows, which is the root
// for a folder that's gone or in the Trash, whose address it leaves
const usePageView = (
  snapshot: WorkspaceSnapshot,
  route: PageRoute,
  search: PageSearch,
  sortOrder: SortOrder,
) => {
  const { t } = useI18n();
  const requested = route.kind === "drawings" ? route.folderId : null;
  const folderId = visibleFolder(snapshot, requested);
  useEffect(() => {
    if (requested !== folderId) {
      navigate(ROOT, { replace: true });
    }
  }, [requested, folderId]);

  const query = search.query.trim();
  const view: PageView =
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
  const locationOf =
    view === "folder"
      ? undefined
      : (item: WorkspaceItem) => locationLabel(snapshot, item, drawingsName);
  return { view, folderId, query, items, crumbs, title, isRoot, locationOf };
};

// the tab's title, which is the app's alone at the root
const useDocumentTitle = (title: string, isRoot: boolean) => {
  useEffect(() => {
    document.title = isRoot ? APP_NAME : `${title} · ${APP_NAME}`;
  }, [isRoot, title]);
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
  const browserImport = useBrowserImport(store);
  const isPhone = useEditorInterface().formFactor === "phone";
  const snapshot = useWorkspaceSnapshot(store);
  const now = useNow();
  const path = routeToPath(route);
  const [sortOrder, setSortOrder] = useSortOrder();
  useTasksOnPage(tasks, toast.show);
  const { view, folderId, query, items, crumbs, title, isRoot, locationOf } =
    usePageView(snapshot, route, search, sortOrder);
  const thumbnails = useThumbnails(store, items.drawings);
  // the folder shown, or the root for lists across folders
  const createIn: ParentId = view === "folder" ? folderId : null;
  const { itemActions, newFolder, renaming, moving, stopMoving, mainRef } =
    useItemActions({
      store,
      path,
      view,
      createIn,
      items,
      setSearch,
      show: toast.show,
      trash,
    });
  const { newDrawing, openFile } = useWorkspaceActions(
    store,
    useCallback(() => createIn, [createIn]),
    tasks.queueTask,
  );
  const searchRef = usePageShortcuts({ toast, view, search, setSearch });
  useDocumentTitle(title, isRoot);

  const accountMenu = <AccountMenu toast={toast} />;

  return (
    <div className="workspace">
      <main className="workspace__main" ref={mainRef}>
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
            <div className="workspace__content">
              {!items.folders.length && !items.drawings.length ? (
                <EmptyView
                  view={view}
                  folderId={folderId}
                  query={query}
                  browserImport={browserImport}
                  newDrawing={newDrawing}
                  toast={toast}
                />
              ) : (
                <ItemGrid
                  folders={items.folders}
                  drawings={items.drawings}
                  thumbnails={thumbnails}
                  now={now}
                  locationOf={locationOf}
                  renaming={renaming}
                  actions={itemActions}
                />
              )}
            </div>
          </>
        )}
      </main>
      {moving && (
        <MoveDialog store={store} item={moving} onClose={stopMoving} />
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
