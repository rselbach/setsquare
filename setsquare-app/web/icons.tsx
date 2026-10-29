import { createIcon } from "@setsquare/setsquare/components/icons";

// drawn like the editor's tabler icons
const tablerIconProps = {
  width: 24,
  height: 24,
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Sheets stacked on each other, for the drawings of a folder. */
// tabler-icons: files
export const drawingsIcon = createIcon(
  <g strokeWidth={1.5}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M15 3v4a1 1 0 0 0 1 1h4" />
    <path d="M18 17h-7a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2h4l5 5v7a2 2 0 0 1 -2 2z" />
    <path d="M16 17v2a2 2 0 0 1 -2 2h-7a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2h2" />
  </g>,
  tablerIconProps,
);

/** A sheet with a plus, for a new drawing. */
// tabler-icons: file-plus
export const newDrawingIcon = createIcon(
  <g strokeWidth={1.25}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
    <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
    <path d="M12 11l0 6" />
    <path d="M9 14l6 0" />
  </g>,
  tablerIconProps,
);

/** A folder with a plus, for a new folder. */
// tabler-icons: folder-plus
export const newFolderIcon = createIcon(
  <g strokeWidth={1.25}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M12 19h-7a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v3.5" />
    <path d="M16 19h6" />
    <path d="M19 16v6" />
  </g>,
  tablerIconProps,
);
