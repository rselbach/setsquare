import DropdownMenu from "@setsquare/setsquare/components/dropdownMenu/DropdownMenu";
import {
  DotsHorizontalIcon,
  DuplicateIcon,
  TrashIcon,
  pencilIcon,
} from "@setsquare/setsquare/components/icons";
import { useI18n } from "@setsquare/setsquare/i18n";
import { useState } from "react";

import { drawingIcon } from "../../web/icons";
import { RouteLink } from "../../web/RouteLink";
import { parentOf, uniqueName } from "../tree";

import { InlineName } from "./InlineName";

import type { DrawingMeta, ItemRef } from "../types";
import type { WorkspaceStore } from "../WorkspaceStore";

/**
 * What the nav reaches of the drawing the editor has open, through the
 * editor, so the editor's next save can't undo what the nav does.
 */
export type OpenDrawing = {
  id: DrawingMeta["id"];
  /** its name as the editor has it, ahead of its save */
  name: string | null;
  /** renames it in the editor, whose next save keeps the name */
  rename: (name: string | null) => void;
  /** saves what the editor has of it, resolving once stored */
  save: () => Promise<unknown>;
  /** leaves it for its folder, then moves it to the Trash with Undo */
  trash: () => void;
};

/**
 * A drawing in the nav's tree, linked, with a menu to rename, duplicate and
 * trash it. The open drawing goes through the editor for each, and has no
 * menu while it opens, since the editor would then save over a change.
 */
export const NavDrawingRow = ({
  store,
  drawing,
  isCurrent,
  editing,
  trash,
}: {
  store: WorkspaceStore;
  drawing: DrawingMeta;
  /** whether the editor shows it, or is opening it */
  isCurrent: boolean;
  /** the editor's hold on it, once it has it open */
  editing: OpenDrawing | null;
  /** moves an item to the Trash, offering Undo */
  trash: (item: ItemRef) => void;
}) => {
  const { t } = useI18n();
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const name = editing ? editing.name : drawing.name;
  const shownName = name || t("labels.untitled");

  const rename = (name: string | null) => {
    if (editing) {
      editing.rename(name);
      return;
    }
    store.renameDrawing(drawing.id, name).catch((error) => {
      console.error(error);
    });
  };

  const duplicate = async () => {
    try {
      // so the copy has what the editor shows, not only what's saved
      await editing?.save();
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
    <li
      role="treeitem"
      aria-label={shownName}
      aria-selected={isCurrent}
      className="folder-tree__item"
    >
      <div className="folder-tree__row nav-drawing">
        <span className="folder-tree__toggle" />
        {renaming ? (
          <InlineName
            name={name}
            label={t("workspace.drawingName")}
            untitled={t("labels.untitled")}
            className="folder-tree__name-field"
            onSave={rename}
            onClose={() => setRenaming(false)}
          />
        ) : (
          <RouteLink
            to={{ kind: "drawing", id: drawing.id }}
            className="folder-tree__link"
            aria-current={isCurrent ? "page" : undefined}
            onClick={(event) => {
              // it's open already, and reopening would add a history entry
              if (isCurrent) {
                event.preventDefault();
              }
            }}
          >
            {drawingIcon}
            <span className="folder-tree__name" title={shownName}>
              {shownName}
            </span>
          </RouteLink>
        )}
        {(!isCurrent || editing) && (
          <DropdownMenu open={menuOpen}>
            <DropdownMenu.Trigger
              className="nav-drawing__more"
              onToggle={() => setMenuOpen(!menuOpen)}
              title={t("workspace.drawingActions", { name: shownName })}
              aria-label={t("workspace.drawingActions", { name: shownName })}
            >
              {DotsHorizontalIcon}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content
              className="workspace-menu"
              onClickOutside={() => setMenuOpen(false)}
              onSelect={() => setMenuOpen(false)}
            >
              <DropdownMenu.Item
                icon={pencilIcon}
                onSelect={() => setRenaming(true)}
              >
                {t("buttons.rename")}
              </DropdownMenu.Item>
              <DropdownMenu.Item icon={DuplicateIcon} onSelect={duplicate}>
                {t("workspace.duplicate")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                icon={TrashIcon}
                onSelect={() =>
                  editing
                    ? editing.trash()
                    : trash({ kind: "drawing", id: drawing.id })
                }
              >
                {t("workspace.moveToTrash")}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu>
        )}
      </div>
    </li>
  );
};
