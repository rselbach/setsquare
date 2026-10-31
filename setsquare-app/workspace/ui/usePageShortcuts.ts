import { KEYS, isWritableElement } from "@setsquare/common";
import { useEffect, useRef } from "react";

import { isModalOpen } from "../../web/isModalOpen";

import type { Dispatch, SetStateAction } from "react";

import type { PageSearch, PageView } from "./WorkspacePage";
import type { WorkspaceToastState } from "./WorkspaceToast";

/**
 * The page's keys, while no dialog is open: Cmd+Z for the toast's Undo, and
 * `/` to open and focus the search, outside the Trash. Returns the ref for
 * the search field, which also gets the focus as the search opens.
 */
export const usePageShortcuts = ({
  toast,
  view,
  search,
  setSearch,
}: {
  toast: WorkspaceToastState;
  view: PageView;
  search: PageSearch;
  setSearch: Dispatch<SetStateAction<PageSearch>>;
}) => {
  const searchRef = useRef<HTMLInputElement>(null);
  const { undo } = toast;
  const canUndo = !!toast.message?.undo;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isModalOpen(document)) {
        return;
      }
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

  return searchRef;
};
