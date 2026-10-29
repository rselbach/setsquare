import { APP_NAME, KEYS, isWritableElement } from "@setsquare/common";
import { StandaloneUIProvider, useEditorInterface } from "@setsquare/setsquare";
import { FilledButton } from "@setsquare/setsquare/components/FilledButton";
import { PlusIcon } from "@setsquare/setsquare/components/icons";
import { useI18n } from "@setsquare/setsquare/i18n";
import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import type { Theme } from "@setsquare/element/types";

import { useAppLangCode } from "../../app-language/language-state";
import { STORAGE_KEYS } from "../../app_constants";
import { useWorkspaceAccount } from "../../web/accountContext";
import { AccountNotice } from "../../web/accountControls";
import { useBrowserImport } from "../../web/browserImport";
import { navigate, routeToPath } from "../../web/router";
import { useNow } from "../../web/useNow";
import { useWorkspaceSnapshot } from "../../web/useWorkspaceSnapshot";
import { useWorkspaceActions } from "../../web/workspaceActions";
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
import { WorkspaceDragProvider } from "./useWorkspaceDrag";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { WorkspaceNav } from "./WorkspaceNav";
import { WorkspaceToast, useTasksOnPage } from "./WorkspaceToast";

import "./Workspace.scss";

import type { ReactNode } from "react";

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
import type { NavPlace } from "./WorkspaceNav";
import type { WorkspaceToastState } from "./WorkspaceToast";

/** The addresses the workspace page shows. */
export type PageRoute = Extract<
  Route,
  { kind: "drawings" | "recent" | "trash" }
>;

type WorkspacePageProps = {
  store: WorkspaceStore;
  route: PageRoute;
  /** the theme shown, with "system" resolved */
  theme: Theme;
  /** the theme chosen */
  appTheme: Theme | "system";
  onThemeChange: (theme: Theme | "system") => void;
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

const WorkspaceView = ({
  store,
  route,
  appTheme,
  onThemeChange,
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
  const navId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const path = routeToPath(route);
  const [sortOrder, setSortOrder] = useSortOrder();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // what Move to… is moving
  const [moving, setMoving] = useState<ItemRef | null>(null);
  // what's being renamed, on the page it shows on
  const [renaming, setRenaming] = useState<{
    item: ItemRef;
    path: string;
  } | null>(null);
  const [search, setSearch] = useState({ path, query: "", open: false });
  if (search.path !== path) {
    // each page starts unsearched
    setSearch({ path, query: "", open: false });
  }
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
      : query
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
      console.error(error);
    }
  };

  const itemActions: ItemActions = {
    startRename: (item) => setRenaming({ item, path }),
    stopRename: () => setRenaming(null),
    renameFolder: (id, name) => {
      store.renameFolder(id, name).catch((error) => console.error(error));
    },
    renameDrawing: (id, name) => {
      store.renameDrawing(id, name).catch((error) => console.error(error));
    },
    move: setMoving,
    trash,
    duplicate: async (drawing: DrawingMeta) => {
      try {
        const snap = store.getSnapshot();
        const name = t("workspace.copyName", {
          name: drawing.name || t("labels.untitled"),
        });
        await store.duplicateDrawing(
          drawing.id,
          uniqueName(snap, parentOf(snap, drawing), name),
        );
      } catch (error) {
        console.error(error);
      }
    },
  };

  const { undo } = toast;
  const canUndo = !!toast.message?.undo;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === KEYS.ESCAPE && drawerOpen) {
        setDrawerOpen(false);
      } else if (
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
  }, [drawerOpen, canUndo, undo, view]);

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

  const place: NavPlace =
    view === "search"
      ? null
      : route.kind === "recent" || route.kind === "trash"
      ? route
      : { kind: "drawings", folderId };

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
                      onClick={browserImport.run}
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

  const drawer = {
    id: navId,
    open: drawerOpen,
    onToggle: () => setDrawerOpen(!drawerOpen),
  };

  return (
    <WorkspaceDragProvider
      snapshot={snapshot}
      onMove={(item, target) => {
        store.move(item, target).then(
          (result) =>
            result.ok || console.error("Couldn't move", item, result.reason),
          (error) => console.error(error),
        );
      }}
      onTrash={trash}
    >
      <div
        className={clsx("workspace", {
          "workspace--drawer-open": drawerOpen,
        })}
      >
        <WorkspaceNav
          id={navId}
          snapshot={snapshot}
          place={place}
          appTheme={appTheme}
          onThemeChange={onThemeChange}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
        />
        {drawerOpen && (
          <div
            className="workspace__scrim"
            aria-hidden="true"
            onClick={() => setDrawerOpen(false)}
          />
        )}
        <main className="workspace__main">
          {view === "trash" ? (
            <TrashView
              store={store}
              snapshot={snapshot}
              now={now}
              drawer={drawer}
            />
          ) : (
            <>
              <WorkspaceHeader
                title={title}
                crumbs={crumbs}
                back={crumbs[crumbs.length - 1] ?? null}
                isPhone={isPhone}
                drawer={drawer}
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
              />
              <div className="workspace__content">
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
            item={moving}
            onClose={() => setMoving(null)}
          />
        )}
        <WorkspaceToast toast={toast} />
        {isPhone && <AccountNotice />}
      </div>
    </WorkspaceDragProvider>
  );
};

/**
 * The workspace's page of folders and drawings, at `/`, `/f/<id>` and
 * `/recent`: a nav with the folder tree, a header to search, sort and
 * create, and the items of the folder shown as cards that link to them,
 * which can be moved, by Move to… or dragging, and trashed with Undo. At
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
