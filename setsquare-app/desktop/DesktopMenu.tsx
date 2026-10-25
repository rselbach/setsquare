// The desktop app's menu bar, which replaces the editor's main menu. It is
// built here rather than in Rust because its labels, check marks and enabled
// states follow editor state that only the webview has.
//
// The editor handles its own shortcuts before the menu sees them, so an item's
// accelerator mostly labels the item. Keys the editor leaves alone, such as
// those typed into a text field, do reach the menu, which is why only
// command-key accelerators are declared.

import {
  CheckMenuItem,
  Menu,
  MenuItem,
  PredefinedMenuItem,
  Submenu,
} from "@tauri-apps/api/menu";
import { useEffect, useRef } from "react";

import {
  DEFAULT_CANVAS_BACKGROUND_PICKS,
  isWritableElement,
  THEME,
} from "@setsquare/common";
import {
  actionChangeViewBackgroundColor,
  actionClearCanvas,
} from "@setsquare/setsquare/actions/actionCanvas";
import {
  actionLoadScene,
  actionSaveFileToDisk,
  actionSaveToActiveFile,
} from "@setsquare/setsquare/actions/actionExport";
import { actionShortcuts } from "@setsquare/setsquare/actions/actionMenu";
import { actionSelectAll } from "@setsquare/setsquare/actions/actionSelectAll";
import { actionToggleArrowBinding } from "@setsquare/setsquare/actions/actionToggleArrowBinding";
import { actionToggleGridMode } from "@setsquare/setsquare/actions/actionToggleGridMode";
import { actionToggleMidpointSnapping } from "@setsquare/setsquare/actions/actionToggleMidpointSnapping";
import { actionToggleObjectsSnapMode } from "@setsquare/setsquare/actions/actionToggleObjectsSnapMode";
import { actionToggleSearchMenu } from "@setsquare/setsquare/actions/actionToggleSearchMenu";
import { actionToggleShowHints } from "@setsquare/setsquare/actions/actionToggleShowHints";
import { actionToggleStats } from "@setsquare/setsquare/actions/actionToggleStats";
import { actionToggleViewMode } from "@setsquare/setsquare/actions/actionToggleViewMode";
import { actionToggleZenMode } from "@setsquare/setsquare/actions/actionToggleZenMode";
import { resolveInputDevice } from "@setsquare/setsquare/appState";
import { activeConfirmDialogAtom } from "@setsquare/setsquare/components/ActiveConfirmDialog";
import {
  useApp,
  useSetsquareActionManager,
  useSetsquareSetAppState,
} from "@setsquare/setsquare/components/App";
import { useUIAppState } from "@setsquare/setsquare/context/ui-appState";
import { useSetAtom } from "@setsquare/setsquare/editor-jotai";
import { languages, useI18n } from "@setsquare/setsquare/i18n";

import type { Action } from "@setsquare/setsquare/actions/types";
import type { Theme } from "@setsquare/element/types";

import { useAppLangCode } from "../app-language/language-state";

import type { PredefinedMenuItemOptions } from "@tauri-apps/api/menu";

type Command = {
  kind: "command";
  id: string;
  text: string;
  accelerator?: string;
  enabled?: boolean;
  run: () => void;
};

type Check = {
  kind: "check";
  id: string;
  text: string;
  accelerator?: string;
  enabled?: boolean;
  checked: boolean;
  run: () => void;
};

type Group = {
  kind: "submenu";
  id: string;
  text: string;
  items: Entry[];
  // the menus macOS fills in itself
  role?: "window" | "help";
};

type Entry =
  | Command
  | Check
  | Group
  | { kind: "predefined"; item: PredefinedMenuItemOptions["item"] };

type Labelled = Command | Check | Group;

type Handle = MenuItem | CheckMenuItem | Submenu;

const separator: Entry = { kind: "predefined", item: "Separator" };

const predefined = (item: PredefinedMenuItemOptions["item"]): Entry => ({
  kind: "predefined",
  item,
});

const command = (
  id: string,
  text: string,
  run: () => void,
  rest: Pick<Command, "accelerator" | "enabled"> = {},
): Command => ({ kind: "command", id, text, run, ...rest });

const check = (
  id: string,
  text: string,
  checked: boolean,
  run: () => void,
  rest: Pick<Check, "accelerator" | "enabled"> = {},
): Check => ({ kind: "check", id, text, checked, run, ...rest });

const submenu = (
  id: string,
  text: string,
  items: Entry[],
  role?: "window" | "help",
): Group => ({ kind: "submenu", id, text, items, role });

const backgroundNames = ["white", "gray", "blue", "yellow", "bronze"] as const;

const index = (entries: Entry[], into = new Map<string, Labelled>()) => {
  for (const entry of entries) {
    if (entry.kind === "predefined") {
      continue;
    }
    into.set(entry.id, entry);
    if (entry.kind === "submenu") {
      index(entry.items, into);
    }
  }
  return into;
};

// a lone ampersand marks a mnemonic, so one in a label must be doubled
const label = (text: string) => text.replace(/&/g, "&&");

// what the bar shows for an entry
const state = (entry: Labelled) => ({
  text: entry.text,
  enabled: entry.kind === "submenu" || entry.enabled !== false,
  checked: entry.kind === "check" && entry.checked,
});

const build = async (
  entries: Entry[],
  dispatch: (id: string) => void,
  handles: Map<string, Handle>,
  roles: { window?: Submenu; help?: Submenu },
) => {
  const items = [];
  for (const entry of entries) {
    switch (entry.kind) {
      case "predefined":
        items.push(await PredefinedMenuItem.new({ item: entry.item }));
        break;
      case "submenu": {
        const menu = await Submenu.new({
          id: entry.id,
          text: label(entry.text),
          items: await build(entry.items, dispatch, handles, roles),
        });
        if (entry.role) {
          roles[entry.role] = menu;
        }
        handles.set(entry.id, menu);
        items.push(menu);
        break;
      }
      case "command":
      case "check": {
        const options = {
          id: entry.id,
          text: label(entry.text),
          accelerator: entry.accelerator,
          enabled: entry.enabled ?? true,
          action: dispatch,
        };
        const item =
          entry.kind === "check"
            ? await CheckMenuItem.new({ ...options, checked: entry.checked })
            : await MenuItem.new(options);
        handles.set(entry.id, item);
        items.push(item);
      }
    }
  }
  return items;
};

const report = (error: unknown) =>
  console.error("Couldn't update the menu bar", error);

export const DesktopMenu = ({
  theme,
  setTheme,
}: {
  theme: Theme | "system";
  setTheme: (theme: Theme | "system") => void;
}) => {
  const { t } = useI18n();
  const [langCode, setLangCode] = useAppLangCode();
  const app = useApp();
  const actionManager = useSetsquareActionManager();
  const appState = useUIAppState();
  const setAppState = useSetsquareSetAppState();
  const setActiveConfirmDialog = useSetAtom(activeConfirmDialogAtom);

  // like the action's shortcut, which view mode blocks unless the action
  // allows it
  const run = (action: Action) => {
    if (appState.viewModeEnabled && !action.viewMode) {
      return;
    }
    actionManager.executeAction(action, "ui");
  };

  // a focused text field gets the browser's own text editing, as it would
  // from the standard menu items; otherwise the command edits the drawing
  const editTextOrRun = (textCommand: string, action: Action) => {
    if (isWritableElement(document.activeElement)) {
      document.execCommand(textCommand);
    } else {
      run(action);
    }
  };

  const toggle = (
    id: string,
    text: string,
    checked: boolean,
    action: Action,
    accelerator?: string,
  ) =>
    check(id, text, checked, () => run(action), {
      accelerator,
      enabled: actionManager.isActionEnabled(action),
    });

  // like any macOS document, an untitled drawing asks where to save it
  const save = appState.fileHandle
    ? actionSaveToActiveFile
    : actionSaveFileToDisk;

  const entries: Entry[] = [
    submenu("app", "Setsquare", [
      predefined({ About: null }),
      separator,
      submenu("preferences", t("labels.preferences"), [
        submenu("box-selection", t("labels.boxSelectionMode"), [
          check(
            "select-contain",
            t("labels.boxSelectionContain"),
            appState.boxSelectionMode === "contain",
            () => setAppState({ boxSelectionMode: "contain" }),
          ),
          check(
            "select-overlap",
            t("labels.boxSelectionOverlap"),
            appState.boxSelectionMode === "overlap",
            () => setAppState({ boxSelectionMode: "overlap" }),
          ),
        ]),
        submenu("input-device", t("labels.inputDevice"), [
          check(
            "input-trackpad",
            t("labels.inputDeviceTrackpad"),
            resolveInputDevice(appState.inputDevice) === "trackpad",
            () => setAppState({ inputDevice: "trackpad" }),
          ),
          check(
            "input-mouse",
            t("labels.inputDeviceMouse"),
            resolveInputDevice(appState.inputDevice) === "mouse",
            () => setAppState({ inputDevice: "mouse" }),
          ),
        ]),
        separator,
        check(
          "tool-lock",
          t("labels.preferences_toolLock"),
          appState.activeTool.locked,
          () => app.toggleLock(),
        ),
        toggle(
          "arrow-binding",
          t("labels.arrowBinding"),
          appState.bindingPreference === "enabled",
          actionToggleArrowBinding,
        ),
        toggle(
          "midpoint-snapping",
          t("labels.midpointSnapping"),
          appState.isMidpointSnappingEnabled,
          actionToggleMidpointSnapping,
        ),
        toggle(
          "show-hints",
          t("labels.showHints"),
          appState.showHints,
          actionToggleShowHints,
        ),
      ]),
      separator,
      predefined("Services"),
      separator,
      predefined("Hide"),
      predefined("HideOthers"),
      predefined("ShowAll"),
      separator,
      predefined("Quit"),
    ]),
    submenu("file", t("desktopMenu.file"), [
      command("open", `${t("buttons.load")}…`, () => run(actionLoadScene), {
        accelerator: "CmdOrCtrl+O",
        enabled: actionManager.isActionEnabled(actionLoadScene),
      }),
      separator,
      command("save", t("buttons.save"), () => run(save), {
        accelerator: "CmdOrCtrl+S",
        enabled: actionManager.isActionEnabled(save),
      }),
      command(
        "save-as",
        `${t("buttons.saveAs")}…`,
        () => run(actionSaveFileToDisk),
        {
          accelerator: "CmdOrCtrl+Shift+S",
          enabled: actionManager.isActionEnabled(actionSaveFileToDisk),
        },
      ),
      command("save-to", t("buttons.export"), () =>
        setAppState({ openDialog: { name: "jsonExport" } }),
      ),
      separator,
      command(
        "export-image",
        t("buttons.exportImage"),
        () => setAppState({ openDialog: { name: "imageExport" } }),
        { accelerator: "CmdOrCtrl+Shift+E" },
      ),
      separator,
      command(
        "clear-canvas",
        `${t("buttons.clearReset")}…`,
        () => setActiveConfirmDialog("clearCanvas"),
        { enabled: actionManager.isActionEnabled(actionClearCanvas) },
      ),
      separator,
      predefined("CloseWindow"),
    ]),
    submenu("edit", t("desktopMenu.edit"), [
      command(
        "undo",
        t("buttons.undo"),
        () => editTextOrRun("undo", actionManager.actions.undo),
        { accelerator: "CmdOrCtrl+Z" },
      ),
      command(
        "redo",
        t("buttons.redo"),
        () => editTextOrRun("redo", actionManager.actions.redo),
        { accelerator: "CmdOrCtrl+Shift+Z" },
      ),
      separator,
      predefined("Cut"),
      predefined("Copy"),
      predefined("Paste"),
      command(
        "select-all",
        t("labels.selectAll"),
        () => editTextOrRun("selectAll", actionSelectAll),
        { accelerator: "CmdOrCtrl+A" },
      ),
      separator,
      command(
        "find",
        `${t("search.title")}…`,
        () => run(actionToggleSearchMenu),
        { accelerator: "CmdOrCtrl+F" },
      ),
      command(
        "command-palette",
        `${t("commandPalette.title")}…`,
        () => setAppState({ openDialog: { name: "commandPalette" } }),
        { accelerator: "CmdOrCtrl+/" },
      ),
    ]),
    submenu("view", t("desktopMenu.view"), [
      submenu("appearance", t("desktopMenu.appearance"), [
        check(
          "theme-light",
          t("buttons.lightMode"),
          theme === THEME.LIGHT,
          () => setTheme(THEME.LIGHT),
        ),
        check("theme-dark", t("buttons.darkMode"), theme === THEME.DARK, () =>
          setTheme(THEME.DARK),
        ),
        check("theme-system", t("buttons.systemMode"), theme === "system", () =>
          setTheme("system"),
        ),
      ]),
      submenu(
        "background",
        t("labels.canvasBackground"),
        DEFAULT_CANVAS_BACKGROUND_PICKS.map((color, i) =>
          check(
            `background-${backgroundNames[i]}`,
            t(`desktopMenu.background.${backgroundNames[i]}`),
            appState.viewBackgroundColor === color,
            () =>
              actionManager.executeAction(
                actionChangeViewBackgroundColor,
                "ui",
                {
                  viewBackgroundColor: color,
                },
              ),
            {
              enabled:
                !appState.viewModeEnabled &&
                !!app.props.UIOptions.canvasActions.changeViewBackgroundColor,
            },
          ),
        ),
      ),
      separator,
      toggle(
        "grid",
        t("labels.toggleGrid"),
        appState.gridModeEnabled,
        actionToggleGridMode,
        "CmdOrCtrl+Quote",
      ),
      toggle(
        "snap",
        t("buttons.objectsSnapMode"),
        actionToggleObjectsSnapMode.checked!(appState),
        actionToggleObjectsSnapMode,
      ),
      toggle(
        "zen-mode",
        t("buttons.zenMode"),
        appState.zenModeEnabled,
        actionToggleZenMode,
      ),
      toggle(
        "view-mode",
        t("labels.viewMode"),
        appState.viewModeEnabled,
        actionToggleViewMode,
      ),
      toggle(
        "stats",
        t("stats.fullTitle"),
        appState.stats.open,
        actionToggleStats,
      ),
      separator,
      predefined("Fullscreen"),
    ]),
    submenu(
      "language",
      t("labels.language"),
      languages.map((language) =>
        check(
          `language-${language.code}`,
          language.label,
          language.code === langCode,
          () => setLangCode(language.code),
        ),
      ),
    ),
    submenu(
      "window",
      t("desktopMenu.window"),
      [
        predefined("Minimize"),
        predefined("Maximize"),
        separator,
        predefined("CloseWindow"),
      ],
      "window",
    ),
    submenu(
      "help",
      t("desktopMenu.help"),
      [command("help", t("helpDialog.title"), () => run(actionShortcuts))],
      "help",
    ),
  ];

  // the menu bar dispatches by ID into the latest entries, so handlers always
  // see current state without the bar being rebuilt
  const latestTree = useRef(entries);
  latestTree.current = entries;
  const latest = useRef(new Map<string, Labelled>());
  latest.current = index(entries);

  const handles = useRef(new Map<string, Handle>());
  const applied = useRef(
    new Map<string, { text: string; enabled: boolean; checked: boolean }>(),
  );

  // built once; replacing the bar later stalls when it happens from a menu
  // action, so labels are updated in place instead
  useEffect(() => {
    let cancelled = false;
    const built = new Map<string, Handle>();
    const roles: { window?: Submenu; help?: Submenu } = {};
    const tree = latestTree.current;
    (async () => {
      const items = await build(
        tree,
        (id) => {
          const entry = latest.current.get(id);
          if (entry && entry.kind !== "submenu") {
            entry.run();
          }
        },
        built,
        roles,
      );
      const menu = await Menu.new({ items });
      if (cancelled) {
        return;
      }
      await menu.setAsAppMenu();
      await roles.window?.setAsWindowsMenuForNSApp();
      await roles.help?.setAsHelpMenuForNSApp();
      applied.current = new Map(
        [...index(tree)].map(([id, entry]) => [id, state(entry)]),
      );
      handles.current = built;
    })().catch(report);
    return () => {
      cancelled = true;
    };
  }, []);

  // labels, check marks and enabled states follow editor state
  useEffect(() => {
    for (const entry of latest.current.values()) {
      const item = handles.current.get(entry.id);
      if (!item) {
        continue;
      }
      const previous = applied.current.get(entry.id);
      const next = state(entry);
      if (previous?.text !== next.text) {
        item.setText(label(next.text)).catch(report);
      }
      if (previous?.enabled !== next.enabled) {
        item.setEnabled(next.enabled).catch(report);
      }
      if (item instanceof CheckMenuItem && previous?.checked !== next.checked) {
        item.setChecked(next.checked).catch(report);
      }
      applied.current.set(entry.id, next);
    }
  });

  return null;
};
