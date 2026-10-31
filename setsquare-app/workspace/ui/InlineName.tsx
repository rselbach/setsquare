import { KEYS } from "@setsquare/common";
import { useEffect, useRef, useState } from "react";

import type { KeyboardEvent } from "react";

const RENAME_KEY = "F2";

/**
 * Ends renaming in place, giving the focus to what `target` finds once
 * Enter or Escape ended it, as the field had it. Leaving by a click keeps
 * the focus where it went.
 */
export const useRenameClose = (
  renaming: boolean,
  onStop: () => void,
  target: () => HTMLElement | null | undefined,
) => {
  const refocus = useRef(false);

  useEffect(() => {
    if (!renaming && refocus.current) {
      refocus.current = false;
      target()?.focus();
    }
  }, [renaming, target]);

  return (byKey: boolean) => {
    refocus.current = byKey;
    onStop();
  };
};

/**
 * What a card needs for its keys and renaming in place: F2 starts renaming,
 * and the card's link takes the focus back when Enter or Escape ends it, as
 * it had it before. Delete or Backspace on the link trashes the item.
 */
export const useCardKeys = ({
  renaming,
  onStart,
  onStop,
  onTrash,
}: {
  renaming: boolean;
  onStart: () => void;
  onStop: () => void;
  onTrash: (card: HTMLLIElement | null) => void;
}) => {
  const cardRef = useRef<HTMLLIElement>(null);
  const onClose = useRenameClose(renaming, onStop, () =>
    cardRef.current?.querySelector("a"),
  );

  return {
    cardRef,
    onKeyDown: (event: KeyboardEvent) => {
      if (renaming) {
        return;
      }
      if (event.key === RENAME_KEY) {
        event.preventDefault();
        onStart();
      } else if (
        (event.key === KEYS.DELETE || event.key === KEYS.BACKSPACE) &&
        event.target === cardRef.current?.querySelector("a")
      ) {
        event.preventDefault();
        onTrash(cardRef.current);
      }
    },
    onClose,
  };
};

/**
 * Renames an item in place, like the footer's name field: Enter or leaving
 * saves, and Escape reverts. An item that can be `untitled` becomes so when
 * its name is emptied; any other keeps its name instead.
 */
export const InlineName = ({
  name,
  label,
  untitled,
  className,
  onSave,
  onClose,
}: {
  name: string | null;
  label: string;
  /** what an emptied name shows as, for items that can have none */
  untitled?: string;
  className?: string;
  onSave: (name: string | null) => void;
  /** called once renaming is over; byKey when Enter or Escape ended it */
  onClose: (byKey: boolean) => void;
}) => {
  const [value, setValue] = useState(name ?? "");
  const reverted = useRef(false);
  const byKey = useRef(false);

  return (
    <input
      type="text"
      className={className}
      value={value}
      placeholder={untitled}
      aria-label={label}
      spellCheck={false}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        const next = value.trim() || (untitled === undefined ? name : null);
        if (!reverted.current && next !== name) {
          onSave(next);
        }
        onClose(byKey.current);
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) {
          return;
        }
        if (event.key === KEYS.ENTER) {
          byKey.current = true;
          event.currentTarget.blur();
        } else if (event.key === KEYS.ESCAPE) {
          // Escape would clear the search or close the drawer too
          event.stopPropagation();
          byKey.current = true;
          reverted.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
};
