import {
  createContext,
  useContext,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import { canMove, findItem, parentOf } from "../tree";

import type { DragEvent, ReactNode } from "react";

import type { ItemRef, ParentId } from "../types";
import type { WorkspaceStore } from "../WorkspaceStore";

/** Where a dragged item can go: a folder, null for the root, or the Trash. */
export type DropTarget = { kind: "folder"; id: ParentId } | { kind: "trash" };

// the browser wants the drag to carry something; the page goes by the item
// it saw picked up, since a drag can't be read until it's dropped
const DRAG_TYPE = "application/x-setsquare-item";

// the element the item is over, if it takes it, by the id its hook has; a
// folder can be a target in several places. Kept out of React state, so
// moving onto a target rerenders only it and the one the item left.
const overStore = () => {
  let over: string | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => over,
    set: (id: string | null) => {
      if (id === over) {
        return;
      }
      over = id;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

type WorkspaceDrag = {
  dragged: ItemRef | null;
  over: ReturnType<typeof overStore>;
  start: (item: ItemRef) => void;
  end: () => void;
  canDrop: (target: DropTarget) => boolean;
  enter: (id: string) => void;
  leave: (id: string) => void;
  drop: (target: DropTarget) => void;
};

const WorkspaceDragContext = createContext<WorkspaceDrag | null>(null);

/**
 * Lets the page's cards be dragged, with the browser's own drag and drop,
 * into folders and the Trash that its parts make targets of with
 * {@link useDragSource} and {@link useDropTarget}. A target only takes an
 * item that can move there, so the browser shows any other drop as not
 * allowed. Touch has Move to… instead.
 */
export const WorkspaceDragProvider = ({
  store,
  onMove,
  onTrash,
  children,
}: {
  store: WorkspaceStore;
  onMove: (item: ItemRef, target: ParentId) => void;
  onTrash: (item: ItemRef) => void;
  children: ReactNode;
}) => {
  const [dragged, setDragged] = useState<ItemRef | null>(null);
  const [over] = useState(overStore);

  // read as each drag event comes, so a change to the workspace doesn't
  // rerender every card
  const drag = useMemo((): WorkspaceDrag => {
    const canDrop = (target: DropTarget) => {
      const snapshot = store.getSnapshot();
      const item = dragged && findItem(snapshot, dragged);
      if (!dragged || !item) {
        return false;
      }
      // the folder it's in already wouldn't move it
      return (
        target.kind === "trash" ||
        (parentOf(snapshot, item) !== target.id &&
          canMove(snapshot, dragged, target.id).ok)
      );
    };
    const end = () => {
      setDragged(null);
      over.set(null);
    };
    return {
      dragged,
      over,
      start: setDragged,
      end,
      canDrop,
      enter: over.set,
      leave: (id) => {
        if (over.get() === id) {
          over.set(null);
        }
      },
      drop: (target) => {
        if (dragged && canDrop(target)) {
          if (target.kind === "trash") {
            onTrash(dragged);
          } else {
            onMove(dragged, target.id);
          }
        }
        end();
      },
    };
  }, [dragged, over, store, onMove, onTrash]);

  return (
    <WorkspaceDragContext.Provider value={drag}>
      {children}
    </WorkspaceDragContext.Provider>
  );
};

/**
 * Makes a card draggable as item: handlers for the card, which take over
 * the drag its link starts, and whether it's the card being dragged.
 */
export const useDragSource = (item: ItemRef) => {
  const drag = useContext(WorkspaceDragContext);
  if (!drag) {
    return { dragging: false, sourceProps: {} };
  }
  return {
    dragging: drag.dragged?.kind === item.kind && drag.dragged.id === item.id,
    sourceProps: {
      onDragStart: (event: DragEvent<HTMLElement>) => {
        const { dataTransfer } = event;
        // the link's address would drop as a link anywhere that takes one
        dataTransfer.clearData();
        dataTransfer.setData(DRAG_TYPE, JSON.stringify(item));
        dataTransfer.effectAllowed = "move";
        // the whole card, held where it was picked up, not the link's text
        const card = event.currentTarget.getBoundingClientRect();
        dataTransfer.setDragImage(
          event.currentTarget,
          event.clientX - card.left,
          event.clientY - card.top,
        );
        drag.start(item);
      },
      onDragEnd: drag.end,
    },
  };
};

const noSubscription = () => () => {};

/**
 * Makes an element a place to drop items: handlers for it, and whether an
 * item it would take is over it, to show so.
 */
export const useDropTarget = (target: DropTarget) => {
  const drag = useContext(WorkspaceDragContext);
  const id = useId();
  const isOver = useSyncExternalStore(
    drag?.over.subscribe ?? noSubscription,
    () => drag?.over.get() === id,
  );
  if (!drag) {
    return { isOver: false, targetProps: {} };
  }
  // the default is to refuse the drop, so only allowed drops prevent it
  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!drag.canDrop(target)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    drag.enter(id);
  };
  return {
    isOver,
    targetProps: {
      onDragEnter: onDragOver,
      onDragOver,
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        // moving onto one of its own children isn't leaving it
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          drag.leave(id);
        }
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        drag.drop(target);
      },
    },
  };
};
