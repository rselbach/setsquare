import { KEYS } from "@setsquare/common";
import { DefaultSidebar, Sidebar, useSetsquareAPI } from "@setsquare/setsquare";
import DropdownMenu from "@setsquare/setsquare/components/dropdownMenu/DropdownMenu";
import {
  DotsHorizontalIcon,
  DuplicateIcon,
  PlusIcon,
  pencilIcon,
} from "@setsquare/setsquare/components/icons";
import { useUIAppState } from "@setsquare/setsquare/context/ui-appState";
import { useI18n } from "@setsquare/setsquare/i18n";
import { useRef, useState } from "react";

import { formatRelativeTime } from "../workspace/formatRelativeTime";
import { childrenOf, parentOf, sortItems, uniqueName } from "../workspace/tree";

import { drawingsIcon } from "./icons";
import { RouteLink } from "./RouteLink";
import { useNow } from "./useNow";
import { useWorkspaceSnapshot } from "./useWorkspaceSnapshot";

import "./DrawingsSidebar.scss";

import type { DrawingId, DrawingMeta } from "../workspace/types";
import type { WorkspaceStore } from "../workspace/WorkspaceStore";

const DRAWINGS_TAB = "drawings";

type DrawingsSidebarProps = {
  store: WorkspaceStore;
  /** the drawing the editor has open */
  drawingId: DrawingId;
  onNewDrawing: () => void;
  /** saves what the editor has of the open drawing, resolving once stored */
  saveDrawing: () => Promise<unknown>;
};

// renames in place like the footer's name field: Enter or leaving saves,
// Escape reverts, and an empty name leaves the drawing untitled
const NameField = ({
  name,
  onSave,
  onClose,
}: {
  name: string | null;
  onSave: (name: string | null) => void;
  onClose: () => void;
}) => {
  const { t } = useI18n();
  const [value, setValue] = useState(name ?? "");
  const reverted = useRef(false);

  return (
    <input
      type="text"
      className="drawings-sidebar__name-field"
      value={value}
      placeholder={t("labels.untitled")}
      aria-label={t("workspace.drawingName")}
      spellCheck={false}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        const next = value.trim() ? value : null;
        if (!reverted.current && next !== (name || null)) {
          onSave(next);
        }
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) {
          return;
        }
        if (event.key === KEYS.ENTER) {
          event.currentTarget.blur();
        } else if (event.key === KEYS.ESCAPE) {
          // Escape would close the sidebar too
          event.stopPropagation();
          reverted.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
};

const DrawingRow = ({
  drawing,
  name,
  isCurrent,
  now,
  onRename,
  onDuplicate,
}: {
  drawing: DrawingMeta;
  name: string | null;
  isCurrent: boolean;
  now: number;
  onRename: (name: string | null) => void;
  onDuplicate: () => void;
}) => {
  const { t, langCode } = useI18n();
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const shownName = name || t("labels.untitled");

  return (
    <li
      className={`drawings-sidebar__row${
        isCurrent ? " drawings-sidebar__row--current" : ""
      }`}
    >
      {renaming ? (
        <NameField
          name={name}
          onSave={onRename}
          onClose={() => setRenaming(false)}
        />
      ) : (
        <RouteLink
          to={{ kind: "drawing", id: drawing.id }}
          className="drawings-sidebar__link"
          aria-current={isCurrent ? "page" : undefined}
          onClick={(event) => {
            // it's open already, and reopening would add a history entry
            if (isCurrent) {
              event.preventDefault();
            }
          }}
        >
          <span className="drawings-sidebar__name" title={shownName}>
            {shownName}
          </span>{" "}
          <time
            className="drawings-sidebar__time"
            dateTime={new Date(drawing.updatedAt).toISOString()}
          >
            {formatRelativeTime(drawing.updatedAt, now, langCode)}
          </time>
        </RouteLink>
      )}
      <DropdownMenu open={menuOpen}>
        <DropdownMenu.Trigger
          className="drawings-sidebar__more"
          onToggle={() => setMenuOpen(!menuOpen)}
          title={t("workspace.drawingActions", { name: shownName })}
          aria-label={t("workspace.drawingActions", { name: shownName })}
        >
          {DotsHorizontalIcon}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content
          className="drawings-sidebar__menu"
          onClickOutside={() => setMenuOpen(false)}
          onSelect={() => setMenuOpen(false)}
        >
          <DropdownMenu.Item
            icon={pencilIcon}
            onSelect={() => setRenaming(true)}
          >
            {t("buttons.rename")}
          </DropdownMenu.Item>
          <DropdownMenu.Item icon={DuplicateIcon} onSelect={onDuplicate}>
            {t("workspace.duplicate")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu>
    </li>
  );
};

// only mounted while the tab shows
const DrawingsTab = ({
  store,
  drawingId,
  onNewDrawing,
  saveDrawing,
}: DrawingsSidebarProps) => {
  const { t } = useI18n();
  const setsquareAPI = useSetsquareAPI();
  const snapshot = useWorkspaceSnapshot(store);
  // the open drawing's name as the editor has it, ahead of its save
  const { name: openName } = useUIAppState();
  const now = useNow();

  const open = snapshot.drawings.get(drawingId);
  const folderId = open ? parentOf(snapshot, open) : null;
  const folderName =
    folderId === null
      ? t("workspace.drawings")
      : snapshot.folders.get(folderId)?.name;
  const drawings = sortItems(
    childrenOf(snapshot, folderId).drawings,
    "updated",
  );

  const rename = (drawing: DrawingMeta, name: string | null) => {
    if (drawing.id === drawingId) {
      // through the editor, so its next save keeps the name, and the footer
      // shows it
      setsquareAPI?.updateScene({ appState: { name } });
      return;
    }
    store.renameDrawing(drawing.id, name).catch((error) => {
      console.error(error);
    });
  };

  const duplicate = async (drawing: DrawingMeta) => {
    try {
      if (drawing.id === drawingId) {
        // so the copy has what the editor shows, not only what's saved
        await saveDrawing();
      }
      const snap = store.getSnapshot();
      const source = snap.drawings.get(drawing.id);
      if (!source) {
        return;
      }
      const copyName = t("workspace.copyName", {
        name: source.name || t("labels.untitled"),
      });
      await store.duplicateDrawing(
        source.id,
        uniqueName(snap, parentOf(snap, source), copyName),
      );
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <>
      <h2 className="drawings-sidebar__folder" title={folderName}>
        {folderName}
      </h2>
      <button
        type="button"
        className="drawings-sidebar__new"
        onClick={onNewDrawing}
      >
        {PlusIcon}
        {t("workspace.newDrawing")}
      </button>
      <ul className="drawings-sidebar__list" aria-label={folderName}>
        {drawings.map((drawing) => {
          const isCurrent = drawing.id === drawingId;
          return (
            <DrawingRow
              key={drawing.id}
              drawing={drawing}
              name={isCurrent ? openName : drawing.name}
              isCurrent={isCurrent}
              now={now}
              onRename={(name) => rename(drawing, name)}
              onDuplicate={() => duplicate(drawing)}
            />
          );
        })}
      </ul>
    </>
  );
};

/**
 * The editor's sidebar with a Drawings tab next to Search and Library. The
 * tab lists the drawings in the open drawing's folder, the latest edited
 * first, to switch between them, create, rename and duplicate them. Phones
 * hide the footer, so this is where they rename the open drawing too.
 */
export const DrawingsSidebar = (props: DrawingsSidebarProps) => {
  const { t } = useI18n();
  return (
    <DefaultSidebar>
      <DefaultSidebar.TabTriggers>
        <Sidebar.TabTrigger
          tab={DRAWINGS_TAB}
          title={t("workspace.drawings")}
          aria-label={t("workspace.drawings")}
        >
          {drawingsIcon}
        </Sidebar.TabTrigger>
      </DefaultSidebar.TabTriggers>
      <Sidebar.Tab tab={DRAWINGS_TAB} className="drawings-sidebar">
        <DrawingsTab {...props} />
      </Sidebar.Tab>
    </DefaultSidebar>
  );
};
