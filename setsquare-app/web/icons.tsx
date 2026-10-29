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

/** A sheet, for one drawing. */
// tabler-icons: file
export const drawingIcon = createIcon(
  <g strokeWidth={1.25}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
    <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
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

/** A folder with an arrow going in, for moving into another folder. */
// tabler-icons: folder-symlink
export const moveIcon = createIcon(
  <g strokeWidth={1.25}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M3 21v-4a3 3 0 0 1 3 -3h5" />
    <path d="M8 17l3 -3l-3 -3" />
    <path d="M3 11v-5a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-9.5" />
  </g>,
  tablerIconProps,
);

/** A window with a panel at its start, for showing or hiding the nav. */
// tabler-icons: layout-sidebar
export const sidebarIcon = createIcon(
  <g strokeWidth={1.25}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z" />
    <path d="M9 4l0 16" />
  </g>,
  tablerIconProps,
);

/** A counterclockwise arrow, for taking something out of the Trash. */
// tabler-icons: restore
export const restoreIcon = createIcon(
  <g strokeWidth={1.25}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M3.06 13a9 9 0 1 0 .49 -4.087" />
    <path d="M3 4.001v5h5" />
    <path d="M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
  </g>,
  tablerIconProps,
);

/** GitHub's octocat, for signing in with a GitHub account. */
// tabler-icons: brand-github
export const githubIcon = createIcon(
  <g strokeWidth={1.5}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <path d="M9 19c-4.3 1.4 -4.3 -2.5 -6 -3m12 5v-3.5c0 -1 .1 -1.4 -.5 -2c2.8 -.3 5.5 -1.4 5.5 -6a4.6 4.6 0 0 0 -1.3 -3.2a4.2 4.2 0 0 0 -.1 -3.2s-1.1 -.3 -3.5 1.3a12.3 12.3 0 0 0 -6.2 0c-2.4 -1.6 -3.5 -1.3 -3.5 -1.3a4.2 4.2 0 0 0 -.1 3.2a4.6 4.6 0 0 0 -1.3 3.2c0 4.6 2.7 5.7 5.5 6c-.6 .6 -.6 1.2 -.5 2v3.5" />
  </g>,
  tablerIconProps,
);
