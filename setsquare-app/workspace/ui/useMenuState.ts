import { useState } from "react";

/**
 * Whether a dropdown menu is open, with what its trigger and content call:
 * `toggle` for the trigger's `onToggle`, and `close` for the content's
 * `onClickOutside` and `onSelect`.
 */
export const useMenuState = () => {
  const [open, setOpen] = useState(false);
  return {
    open,
    toggle: () => setOpen(!open),
    close: () => setOpen(false),
  };
};
