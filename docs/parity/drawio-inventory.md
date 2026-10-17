# draw.io feature inventory (parity reference)

Source: `jgraph/drawio` release 32.4.1, commit `9034053fba80a435e27d68d374bc564b83917ae9` (2026-10-08). The inventory was read from a sparse clone of the source; no code from it was run. Paths are relative to `src/main/webapp/` unless a row says otherwise. Line numbers (`#L123`) refer to that commit.

Scope: user-facing features of the draw.io web app, the embed and viewer modes, and the desktop (Electron) hooks that live in this repo. The desktop main process (native OS menu bar, CLI export, draft file naming) lives in `jgraph/drawio-desktop` and is not covered.

Main sources: `js/grapheditor/*` (generic editor layer: `Actions.js`, `Menus.js`, `Format.js`, `Sidebar.js`, `Dialogs.js`, `EditorUi.js`, `Editor.js`, `Graph.js`, `Shapes.js`, `Toolbar.js`, `InlineToolbar.js`), `js/diagramly/*` (draw.io app layer: `App.js`, `EditorUi.js`, `Editor.js`, `Menus.js`, `Dialogs.js`, `Pages.js`, `Trees.js`, `Minimal.js`, `Simple.js`, `ElectronApp.js`, `DrawioFile*.js`, storage clients, `sidebar/Sidebar-*.js`), `mxgraph/src/*` (mxGraph core), `shapes/*`, `js/stencils.min.js` (decoded as data), `plugins/*`, `templates/index.xml`, `resources/dia.txt` (English UI strings), `shortcuts.svg`.

## Conventions

- Labels are the English strings from `resources/dia.txt`. `Ctrl` means `Editor.ctrlKey` (Cmd on macOS); `Alt` is Option on macOS.
- "(unconfirmed: ...)" marks anything the code did not settle. Nothing marked that way was guessed.
- Each section ends with a `Counts:` line that says how it was counted.

Tags mark items the code gates. Untagged items are available in the default web app.

| Tag | Meaning |
|---|---|
| `[desktop]` | Electron desktop app only (`mxIsElectron` / `EditorUi.isElectronApp`) |
| `[web]` | Not in Electron |
| `[drive]` `[onedrive]` `[dropbox]` `[github]` `[gitlab]` `[trello]` | Only with that storage backend or file type |
| `[browser]` | Browser storage (IndexedDB / localStorage) |
| `[device]` | Local file system from the browser (File System Access API or download/upload) |
| `[embed]` | Embed mode only (`embed=1`, postMessage host) |
| `[theme:x]` | Only in UI theme `x` (`kennedy` = Classic, `simple`, `sketch`, `min`, `atlas`, legacy `dark`) |
| `[plugin:x]` | Provided by plugin `x` (`plugins/*.js`) |
| `[flag:x]` | Gated by URL parameter or configuration key `x` |
| `[conf]` | Confluence / Jira Cloud host only (atlas mode; host plugin code is not in this repo) |
| `[server]` | Needs a draw.io server-side service (export server, proxy, realtime relay, icon search) |

## Summary counts

| Area | Count | Notes |
|---|---|---|
| Menu actions | 200 unique action ids reachable from menus | About 290 leaf entries; 37 named menus and submenus; 281 to 284 action ids defined in core (§1) |
| Actions outside the menubar | 90 action ids | Plus 16 context-menu variants, about 127 key bindings, 52 canvas and hover affordances (§2) |
| Format panel | 138 control rows in 37 sections over 5 panels | Plus 246 generated property rows; about 237 style keys touched (§3) |
| Shape libraries | 505 palette ids | 66 More Shapes entries in 5 groups; 73 library-set ids; 830 registered shape types; 51 stencil namespaces with 9,090 stencil shapes; about 13,750 sidebar entries, with overlap (§4) |
| Edges | 10 edge styles, 15 perimeters, 34 arrowhead ids, 8 dash presets + custom, 5 jump styles, 10 edge shapes | (§5) |
| Layouts | 10 one-shot algorithms + Run Last Layout + Custom JSON + WebCola plugin | 7 live layout containers; 8 `childLayout` values (§6) |
| Dialogs | 122 (47 dialog constructors + 75 ad-hoc dialogs) | Plus 15 non-modal windows (§7) |
| Import formats | 23 | (§8) |
| Export formats | 12 file formats | Plus 9 embed and publish outputs, 4 clipboard outputs, 44 distinct export options (§8) |
| Storage backends | 14 | 12 implemented in this repo, plus Confluence/Jira and Nextcloud host integrations (§9) |
| Collaboration features | 17 | (§9) |
| Configuration | 163 URL parameters, 139 config keys, 41 persisted user settings (+2 legacy) | (§10) |
| Extensibility and content | 23 plugin ids, 155 templates in 15 categories, 27 embed actions, 28 embed events, 41 viewer config keys | (§10) |
| Editor | 42 UI languages, 5 UI themes, 23 custom link action types, 7 sketch fill styles | (§10) |

Counting notes:

- §1 counts the page, zoom and table dropdowns of the simple, sketch and min theme headers as menus. §2 counts the same 12 ids (`insertPage`, `duplicatePage`, `removePage`, `renamePage`, `sortPages`, `fitWindow`, `fitPage`, `fitTwoPages`, `fitPageWidth`, `customZoom`, `mergeCells`, `unmergeCells`) as outside the menubar, because the classic menubar does not contain them.
- Library counts overlap: several sets (for example AWS 17, AWS 18 and current AWS) share stencils.

## Contents

1. Menus
2. Actions not reachable from menus
3. Format panel
4. Shape libraries
5. Edge styles, routing, perimeters, arrowheads, line patterns, jumps
6. Layouts
7. Dialogs
8. File formats
9. Storage, collaboration, and offline
10. Editor behaviors (including templates, plugins, embed mode, URL parameters, configuration, viewer)
11. Parity tiers

## 1. Menus

Source baseline: draw.io 32.4.1 (`9034053f`). Paths relative to `src/main/webapp/`.

Conventions for this section:

- `id` is the action id (`Actions.prototype.addAction` strips a trailing `...` from the key, `js/grapheditor/Actions.js#L2236`). `▸ name` is a submenu (`Menus.prototype.addSubmenu`), `(item)` is a direct `menu.addItem` entry with no action id.
- Labels come from `resources/dia.txt`. Missing keys render as the raw key (`mxResources.get` fallback override, `js/grapheditor/Graph.js#L398`).
- Shortcuts are the `Action.shortcut` strings shown in menus. `Ctrl` is `Editor.ctrlKey` (Cmd on macOS); `Alt` is Option on macOS. Key-binding conflicts are listed under "Ambiguities".
- "classic" means the menubar UI (`Editor.currentTheme` not `simple`/`sketch`/`min`, i.e. `kennedy`, `atlas`, legacy `dark`). The other themes build their menus from the `diagram`, `view`, `insert`, `pages`, `share` and `dynamicAppearance` menus.
- `[flag:!offline]` means the item is hidden when `EditorUi.isOffline()` is true: `offline=1`, `stealth=1`, `lockdown=1`, or browser offline in web (`js/diagramly/EditorUi.js#L1519`).
- Any menu can be removed by configuration: `hideMenus` drops top-level menus and `hideMenuItems` drops action ids (`js/diagramly/Editor.js#L3787-3822`, `Menus.prototype.hiddenMenuItems`). `noFileMenu=1` removes File (`js/diagramly/Menus.js#L225`).

### Top-level menu layout per theme

| Theme / platform | Top-level menus | Source |
|---|---|---|
| classic (web) | File, Edit, View, Arrange, Extras, Help | `js/grapheditor/Menus.js` `Menus.prototype.defaultMenuItems`, `Menus.prototype.createMenubar` |
| classic `[desktop]` | Same menus. File is replaced by the Electron variant. | `js/diagramly/ElectronApp.js` `this.put('file', ...)` |
| `[theme:sketch]` | Top-left: hamburger `diagram` menu plus Delete/Undo/Redo buttons. Vertical picker toolbar with an `insert` menu. Footer: `pages` menu. | `js/diagramly/Simple.js` `createMainMenuForTheme`, `createPickerMenuForTheme`, `createFooterMenuForTheme` |
| `[theme:simple]` | Top-left: `view` menu. Top-right: `share` menu, `diagram` main menu, Format button, `dynamicAppearance` overflow menu. Picker toolbar: `insert`. Footer: `pages`. | `js/diagramly/Simple.js#L62`, `#L572`, `#L704`, `#L760` |
| `[theme:min]` | `diagram` menu button (icon when narrow), `insert` menu button, plus Shapes/Format/Delete/Undo/Redo/Fit/Zoom buttons | `js/diagramly/Minimal.js` `refreshMenu` `addMenu('diagram')`, `addMenu('insert')` |
| any | Plugins can append items to any named menu | `Menus.prototype.addPluginMenuItems` / `appendPluginMenuItems` (`js/grapheditor/Menus.js#L549-589`) |

### File (classic, web)

Source: `js/diagramly/Menus.js` `this.put('file', ...)`, final `else` branch (`#L5957-6087`).

| id / submenu | Label | Shortcut | Tags / condition |
|---|---|---|---|
| exportOptionsDisabled | Export options disabled... | | `[drive]`, only for restricted files (`file.isRestricted()`) |
| save | Save | Ctrl+S | Shown first for Drive files |
| share | Share... | | `[drive]` at the top for Drive files. For other files: `[web]`, draw.io service, not `offline=1`, a file must be open. Calls `file.share()`: Drive, OneDrive, GitHub, GitLab, default. |
| synchronize | Synchronize | Alt+Shift+S | `[drive]` at the top. Otherwise `[web]` for files that are not plain `LocalFile` (LocalFile with `fileHandle` qualifies). Has an FAQ help link. |
| new | New... | | Not shown for Drive files in this position |
| myDiagrams | My Diagrams... | | `[drive]` `[flag:home=1]`. `App.prototype.isHomeEnabled` requires Drive mode, HomeDialog, `home=1` or the preprod host, and not embed. |
| ▸ openFrom | Open from | | See "Open from" |
| ▸ openRecent | Open Recent | | `[browser]`, needs localStorage |
| new, rename, makeCopy, openFolder, moveToFolder | New..., Rename..., Make a Copy..., Open Folder..., Move to Folder... | | `[drive]` file branch |
| save, saveAs | Save, Save as... | Ctrl+S, Ctrl+Shift+S | Non-Drive branch |
| rename | Rename... | | `file.isRenamable()`: LocalFile, StorageFile, OneDrive, editable Drive |
| upload | Upload... | | `[flag:offline=1]` instead of makeCopy. Visible only when online and not `stealth`/`lockdown`. |
| makeCopy | Make a Copy... | | Not `offline=1` |
| moveToFolder | Move to Folder... | | `[onedrive]` in the non-Drive branch |
| openFolder | Open Folder... | | When `file.getFolderUrl() != null` |
| ▸ importFrom | Import from | | |
| ▸ exportAs | Export as | | |
| ▸ embed | Embed | | `[flag:!offline]` |
| ▸ publish | Publish | | `[flag:!offline]` |
| ▸ newLibrary | New Library | | `Editor.enableCustomLibraries` (config `enableCustomLibraries`) |
| ▸ openLibraryFrom | Open Library from | | Same flag |
| revisionHistory | Revision History... | | `file.isRevisionHistorySupported()`: Drive, Dropbox (`DriveFile.js#L627`, `DropboxFile.js#L101`) |
| properties | Properties... | | A file is open, `fileNode != null`, not `embedInline=1` |
| pageSetup | Page Setup... | | |
| print | Print... | Ctrl+P | Hidden in iOS standalone (PWA) |
| close | Close | | |

### File (embed mode) `[embed]`

Source: `js/diagramly/Menus.js` `this.put('file')` `urlParams['embed'] == '1'` branch (`#L5797-5842`).

| id / submenu | Label | Shortcut | Condition |
|---|---|---|---|
| ▸ importFrom, ▸ exportAs, ▸ embed | Import from, Export as, Embed | | |
| ▸ newLibrary, ▸ openLibraryFrom | | | `[flag:libraries=1]` |
| revisionHistory | Revision History... | | When supported |
| pageSetup, print | Page Setup..., Print... | Ctrl+P | |
| rename | Rename... | | |
| save | Save | Ctrl+S | Not `noSaveBtn=1`, not `embedInline=1` |
| saveAndExit | Save & Exit | Ctrl+S | `[flag:saveAndExit=1]`, or `noSaveBtn=1` unless `saveAndExit=0` |
| exit | Exit | Escape when `embedInline=1` | Not `noExitBtn=1` |

### File `[desktop]`

Source: `js/diagramly/ElectronApp.js` `Menus.prototype.init` `this.put('file')` (`#L396-415`) and `this.put('openRecent')` (`#L353`).

| id / submenu | Label | Shortcut | Notes |
|---|---|---|---|
| new | New... | Ctrl+N | Shortcut and binding: `ElectronApp.js#L682`, `#L697` |
| open | Open... | Ctrl+O | `#L694`, `#L698` |
| ▸ openRecent | Open Recent | | One entry per recent path (opens via `loadArgs`), then Reset |
| synchronize | Synchronize | Alt+Shift+S | Reloads from disk |
| save, saveAs | Save, Save as... | Ctrl+S, Ctrl+Shift+S | |
| import | Import... | | Electron override, `ElectronApp.js#L522` |
| ▸ exportAs | Export as | | |
| ▸ embed | Embed | | Embed actions exist only when not `isOffline()`. Whether the desktop launch passes `offline` is unconfirmed: the desktop URL params live in the drawio-desktop repo. |
| presentationMode | Presentation Mode... | | |
| newLibrary, openLibrary | New Library..., Open Library... | | Device-backed libraries, `ElectronApp.js#L511-520` |
| properties | Properties... | | When a file is open |
| pageSetup, print | Page Setup..., Print... | Ctrl+P | |
| close | Close | | |
| exit | Exit | | Electron override, `ElectronApp.js#L879` |

### File (simple / sketch / min, opened from the Diagram menu)

Source: `js/diagramly/Menus.js` `this.put('file')` `minTheme` branch (`#L5843-5955`).

| id / submenu | Label | Condition |
|---|---|---|
| new | New... | |
| myDiagrams | My Diagrams... | `[drive]` `[flag:home=1]` |
| ▸ openFrom, ▸ openRecent | Open from, Open Recent | Open Recent needs localStorage |
| save | Save | |
| saveAs | Save as... | Hidden for Drive files |
| synchronize | Synchronize | `[web]`, not plain LocalFile |
| share | Share... | Not simple. `[drive]` `[github]` `[onedrive]` |
| publishLink | Publish... | `[theme:sketch\|min]` `[web]` |
| presentationMode | Presentation Mode... | `[theme:sketch\|min]` `[web]`, own Drive domain (`App.prototype.isOwnGDriveDomain`: app.diagrams.net, preprod, test) |
| rename | Rename... | Renamable files |
| upload / makeCopy | Upload... / Make a Copy... | Upload when `offline=1` |
| moveToFolder | Move to Folder... | `[drive]` `[onedrive]` |
| openFolder | Open Folder... | When a folder URL exists |
| openFile | Open File... | When a file URL exists |
| revisionHistory | Revision History... | When supported |
| properties | Properties... | When `fileNode` exists, not `embedInline` |
| autosave | Autosave (toggle) | `[theme:simple]` |

### Diagram menu (hamburger / main menu) `[theme:sketch|simple|min]`

Source: `js/diagramly/Menus.js` `this.put('diagram')` (`#L5608-5767`).

| Entry | Label | Condition |
|---|---|---|
| ▸ extras | Settings | First entry, except in simple, where it is near the end |
| new, open, ▸ openRecent, synchronize, properties, save, saveAs | | Chrome app or `[desktop]` |
| save, saveAndExit, revisionHistory | | Atlas mode (`App.MODE_ATLAS`, `[conf]`). Save is hidden with `noSaveBtn`/`embedInline`. |
| ▸ file | File | Otherwise, unless `noFileMenu=1` |
| toggleShapes, format, layers, tags, findReplace, comments | Shapes, Format, Layers, Tags, Find/Replace, Comments | `[theme:min]`. Comments only when `file.commentsSupported()` (Drive only: `DriveFile.js#L876`). |
| ▸ exportAs | Export as | |
| import / ▸ importFrom | Import... / Import from | `import` in Chrome app, `[desktop]` and `atlassian`; otherwise the Import from submenu |
| findReplace, comments, toggleShapes, format, layers, tags, pageSetup | | `[theme:sketch]` |
| ▸ newLibrary, ▸ openLibraryFrom | | `[theme:simple]` |
| pageSetup | Page Setup... | simple, min |
| print | Print... | Not `noFileMenu`, not iOS standalone |
| ▸ extras | Settings | `[theme:simple]` |
| ▸ help | Help | |
| save, saveAndExit, revisionHistory | | `[embed]`, gated by `noSaveBtn` / `saveAndExit` |
| exit | Exit | `[embed]` or Atlas, not `noExitBtn` |
| close | Close | Non-embed, file open, not Atlassian plugin (`AtlasFile` undefined) |

### Edit

Source: `js/diagramly/Menus.js` `this.put('edit')` (`#L5058`). This overrides `js/grapheditor/Menus.js#L468`. Same items in every theme.

| id | Label | Shortcut | Notes |
|---|---|---|---|
| undo | Undo | Ctrl+Z | |
| redo | Redo | Ctrl+Shift+Z (Ctrl+Y on Windows) | Ctrl+Y bound on all platforms (`grapheditor/EditorUi.js#L8591`) |
| cut | Cut | Ctrl+X | |
| copy | Copy | Ctrl+C | |
| copyAsImage | Copy as Image | Ctrl+Alt+X | Visible when `Editor.enableNativeClipboard` and export-to-canvas are both on |
| copyAsSvg | Copy as SVG | Ctrl+Alt+Shift+X | Same gate |
| paste | Paste | Ctrl+V | |
| delete | Delete | Delete (also Backspace) | |
| duplicate | Duplicate | Ctrl+D | |
| findReplace | Find/Replace ("Find" when the graph is read-only; label built at runtime from `find` + `replace`, `js/diagramly/EditorUi.js` `updateActionStates` #L31134) | Ctrl+F | Shift+click opens find-only mode |
| editData | Edit Data... | Ctrl+M | |
| editTooltip | Edit Tooltip... | Alt+Shift+T | |
| editNote | Edit Note... | Alt+Shift+N | |
| editStyle | Edit Style... | Ctrl+E | |
| editGeometry | Edit Geometry... | Ctrl+Shift+M | |
| editPolygon | Edit Polygon... | | |
| editConnectionPoints | Edit Connection Points... | Alt+Shift+Q (see "Ambiguities") | |
| edit | Edit | F2/Enter | Starts label editing |
| editLink | Edit Link... | Alt+Shift+L | |
| openLink | Open Link | | |
| selectVertices | Select Vertices | Ctrl+Shift+I | |
| selectEdges | Select Edges | Ctrl+Shift+E | |
| selectAll | Select All | Ctrl+A | |
| selectNone | Select None | Ctrl+Shift+A | |
| lockUnlock | Lock/Unlock | Ctrl+L | |

### View (classic)

Source: `js/diagramly/Menus.js` `this.put('view')` `else` branch (`#L5200-5236`).

| id / submenu | Label | Shortcut | Condition |
|---|---|---|---|
| format | Format | Ctrl+Shift+P | |
| outline | Outline | Ctrl+Shift+O | |
| layers | Layers | Ctrl+Shift+L | |
| tags | Tags | Ctrl+K | |
| comments | Comments | | `commentsSupported()`: Drive |
| search | Search Shapes (toggle) | | Toggles the sidebar search palette (`action.label = searchShapes`) |
| scratchpad | Scratchpad (toggle) | | Needs localStorage or the Chrome app. Has an FAQ link. |
| toggleShapes | Shapes | Ctrl+Shift+K | |
| pageView | Page View (toggle) | | |
| pageScale | Page Scale... | | |
| ▸ units | Units | | |
| pageTabs | Page Tabs (toggle) | | `isPageMenuVisible()`: pages exist and (`pages!=0`, more than one page, or `Editor.pagesVisible`) |
| ruler | Ruler (toggle) | | |
| tooltips | Tooltips (toggle) | | |
| animations | Flow Animations (toggle) | | |
| zoomWheel | Zoom with Mouse Wheel (toggle) | | |
| grid | Grid (toggle) | Ctrl+Shift+G | |
| guides | Guides (toggle) | | |
| connectionArrows | Connection Arrows (toggle) | Alt+Shift+A | |
| connectionPoints | Connection Points (toggle) | Alt+Shift+O | |
| resetView | Reset View | Enter/Home | |
| zoomIn | Zoom In | Ctrl + / Ctrl+Mousewheel | |
| zoomOut | Zoom Out | Ctrl - / Ctrl+Mousewheel | |
| fullscreen | Fullscreen | | Not `sketch=1` |

### View `[theme:simple]` (top-left menu)

Source: same `put('view')`, `Editor.currentTheme == 'simple'` branch (`#L5167-5199`).

toggleShapes, format, pageTabs (conditional), ruler, then search, scratchpad (+FAQ link), then findReplace, layers, tags, outline, comments (Drive), collaboration items (see "Collaboration items"), then fullscreen.

### Arrange (all themes with a menubar)

Source: `js/grapheditor/Menus.js` `this.put('arrange')` (`#L389-422`) plus submenus. diagramly does not override it. The menu is disabled when the graph is not editable.

| id / submenu | Label | Shortcut | Notes |
|---|---|---|---|
| toFront | To Front | Ctrl+Shift+F | |
| toBack | To Back | Ctrl+Shift+B | |
| bringForward | Bring Forward | Ctrl+Alt+Shift+F | |
| sendBackward | Send Backward | Ctrl+Alt+Shift+B | |
| ▸ direction | Direction | | |
| └ (item) | Flip Horizontal | | Toggles `flipH`. Plain `addItem`, no action id. |
| └ (item) | Flip Vertical | | Toggles `flipV` |
| └ rotation | Rotation | | Prompts for an angle |
| turn | Rotate Shape Only by 90° / Reverse | Ctrl+R (no shortcut on Safari) | Shift reverses. Title is overridden in `Actions.js#L486`. |
| ▸ align | Align | | Enabled for more than one vertex. Calls `graph.alignCells` directly; the equivalent actions `alignCells*` are not in the menu. |
| └ (items) | Left Align, Center, Right Align, Top Align, Middle, Bottom Align | | |
| └ snapToGrid | Snap to Grid | | |
| ▸ distribute | Distribute | | |
| └ (items) | Horizontal, Vertical | | `graph.distributeCells(horizontal)` |
| └ ▸ distributeSpacing | Spacing ▸ Horizontal, Vertical | | Equal spacing (`distributeCells(h, null, true)`) |
| ▸ navigation | Navigation | | |
| └ home | Home | Shift+Home | |
| └ exitGroup / enterGroup | Exit Group / Enter Group | Ctrl+Shift+Home / Ctrl+Shift+End | |
| └ expand / collapse | Expand / Collapse | Ctrl+End / Ctrl+Home | |
| └ collapsible | Collapsible (toggle) | | |
| ▸ insert | Insert | | See "Insert" |
| ▸ layout | Layout | | See "Layout" |
| group | Group | Ctrl+G | Inline help icon to the docs (`#L402-419`) |
| ungroup | Ungroup | Ctrl+Shift+U | |
| removeFromGroup | Remove from Group | | |
| clearWaypoints | Clear Waypoints | Alt+Shift+R | |
| autosize | Autosize | Ctrl+Shift+Y | |

### Insert

Source: `js/diagramly/Menus.js` `this.put('insert')` (`#L4516-4590`). In classic it is reached as Arrange ▸ Insert. In other themes it is a toolbar or picker menu.

| id / submenu | Label | Shortcut | Theme / condition |
|---|---|---|---|
| showShapePicker | Shapes... | | `[flag:Editor.passiveScroll]` variant only, first |
| toggleShapes | Shapes | Ctrl+Shift+K | `[theme:sketch]` |
| ▸ table | Table | | passiveScroll, sketch, min, simple. Not in classic. |
| insertRectangle | Rectangle | D | Not sketch |
| insertEllipse | Ellipse | F | Not sketch |
| insertRhombus | Rhombus | R | Not sketch |
| insertEdge | Line | C | Not sketch |
| insertNote | Note | S | Not sketch |
| insertText | Text | A | |
| insertLink | Link... | L | |
| insertImage | Image... | | |
| createShape | Shape... | | |
| insertPolygon | Polygon... | | |
| insertTemplate | Template... | | `insertTemplateEnabled` (default true) and not offline |
| mermaid | Mermaid... | | `EditorUi.isMermaidSupported()`. Not shown in the passiveScroll variant. |
| insertFreehand | Freehand | X | |
| generate | Generate (AI, toggle) | | Defined only under a compound gate (`Menus.js#L1380-1391`): Electron, or `Editor.enableAi`, or the `ac.draw.io`/`aj.draw.io` hosts, plus online, `Editor.aiActions` non-empty, external data comms allowed, `getServiceName()=='draw.io'` and Mermaid supported |
| ▸ layout | Layout | | sketch, passiveScroll, min, simple (the Arrange ▸ Layout menu) |
| ▸ insertLayout | "Layout" (classic) / "Insert" (min, simple) | | |
| ▸ insertAdvanced | Advanced | | |

Table submenu (`Menus.prototype.addInsertTableCellItem` / `addInsertTableItem`, `js/grapheditor/Menus.js#L589-1068`):

- A rows × columns grid picker with Title and Container checkboxes. Shown when no table or stack is selected, or as a submenu.
- With a table, row or cell selected: Insert Column Left, Insert Column Right, Delete Column, Insert Row Above, Insert Row Below, Delete Row. Stacks map to lanes.
- `mergeCells` (Merge) when the selection is mergeable. `unmergeCells` (Unmerge) when a cell has colspan or rowspan.

Insert Layout submenu (`put('insertLayout')`, `#L4597`). Each item inserts a live layout container with a seed graph (`addInsertLayoutAction`, `#L4247-4310`):

| id | Label |
|---|---|
| horizontalFlow | Horizontal Flow |
| verticalFlow | Vertical Flow |
| horizontalTree | Horizontal Tree |
| verticalTree | Vertical Tree |
| radialTree | Radial Tree |
| organic | Organic |
| circle | Circle |

Advanced submenu (`put('insertAdvanced')`, `#L4610`):

| id | Label | Condition |
|---|---|---|
| fromText | From Text... | |
| plantUml | PlantUML... | Always available (native converter) |
| formatSql | SQL... | |
| csv | CSV... | |
| createShape | Shape... | `[theme:simple\|min]` |
| editDiagram | Edit Diagram... | `[theme:simple\|min]` |

### Layout (Arrange ▸ Layout)

Source: `js/diagramly/Menus.js` `this.get('layout').funct` (`#L1716-1979`). This replaces the empty `put('layout')` in grapheditor.

| Entry | Label | Shortcut | Condition / behavior |
|---|---|---|---|
| runLastLayout | Run Last Layout | Ctrl+Alt+T | Disabled until a layout has run in the session |
| (item) | Vertical Flow... | | `[flag:ElkLayout loaded]`. ELK presets with an options dialog (`ElkLayout.MENU_PRESETS`, `ElkLayout.runWithDialog`). |
| (item) | Horizontal Flow... | | ELK |
| (item) | Vertical Tree... | | ELK |
| (item) | Horizontal Tree... | | ELK |
| (item) | Radial Tree... | | ELK |
| (item) | Organic... | | ELK |
| (item) | Org Chart... | | Dialog: type (Linear, Hanger 2, Hanger 4, Fishbone 1, Fishbone 2, 1 Column Left, 1 Column Right, Smart), parent-child spacing, sibling spacing |
| (item) | Circle | | `mxCircleLayout`, or applied to selected layout containers |
| (item) | Orthogonal Routing... | | `[flag:LibavoidRouting loaded]`. Prompts for spacing. |
| (item) | Parallels... | | `mxParallelEdgeLayout`, prompts for spacing |
| runLayout | Custom... | | Custom layout JSON dialog (`showCustomLayoutDialog`) |
| webColaLayout | WebCola Layout... | | `[plugin:webcola]` |

### Export as

Source: `js/diagramly/Menus.js` `this.put('exportAs')` (`#L3331-3408`).

| id | Label | Condition |
|---|---|---|
| exportPng | PNG... | Canvas export (`Editor.useCanvasForExport` or Chrome app), or remote export enabled (online, `EXPORT_URL` set, not iOS standalone) |
| exportJpg | JPEG... | Canvas export plus `Editor.jpgSupported`, or remote export |
| exportWebp | WebP... | Canvas export plus `Editor.webpSupported` |
| exportAnimatedGif | Animation... | Canvas export |
| exportSvg | SVG... | Always |
| exportPdf | PDF... | Always except iOS standalone without print-PDF. Falls back to print when no export service (`isPrintPdfExport`). |
| exportVsdx | VSDX (beta)... | `[conf]`: `EditorUi.prototype.vsdxExportEnabled` returns `getServiceName()=='atlassian'` (`EditorUi.js#L33009`), and `VsdxExport` loaded or online |
| exportHtml | HTML... | |
| exportXml | XML... | |
| exportUrl | URL... | `Editor.enableExportUrl` (config `enableExportUrl`, default true) |
| exportJson | JSON... | |
| export | Advanced... | `[flag:!offline]`. The generic Export dialog, relabeled. |
| publishLink | Link... | `[theme:min]` `[web]` `[flag:!offline]` |
| ▸ embed | Embed | `[theme:simple\|sketch\|min]` `[flag:!offline]`, not Atlas mode, not `extAuth=1` |

### Import from

Source: `js/diagramly/Menus.js` `this.put('importFrom')` (`#L3410-3651`). Disabled when the graph is not editable.

| Entry (plain items) | Condition |
|---|---|
| Google Drive... | `[drive]` Google picker loaded. Shows "(Loading...)" while initializing. |
| OneDrive... | `[onedrive]` |
| Dropbox... | `[dropbox]` |
| GitHub... | `[github]` |
| GitLab... | `[gitlab]` |
| Trello... | `[trello]` |
| Browser... | `[browser]` localStorage, not `browser=0` |
| Device... | `[device]` not `noDevice=1` |
| URL... | `[flag:!offline]`. Loads through `PROXY_URL`. |

Electron, Chrome app and `atlassian` show the single `import` (Import...) action instead (`put('diagram')`, `#L5668`). `[plugin:import]` adds a top-level "Import" menu with "Freemind..." (`plugins/import.js#L206`).

### Embed

Source: `js/diagramly/Menus.js` `this.put('embed')` (`#L4208-4226`). Actions are defined only when not offline (`#L2954`).

| id | Label | Condition |
|---|---|---|
| liveImage | Live image... (hard-coded label, not localized) | Drive or GitHub file named `*.png` |
| embedImage | Image... | |
| embedSvg | SVG... | |
| embedHtml | HTML... | |
| embedIframe | IFrame... | Not iOS standalone, not offline |
| microsoftOffice | Microsoft Office... | Not embed mode. Opens office.draw.io. |
| embedNotion | Notion... | Not embed mode |

### Publish / Share

| Menu | id | Label | Condition | Source |
|---|---|---|---|---|
| Publish | publishLink | Link... | Action visible only when not offline | `put('publish')` `#L3949`, action `#L3135` |
| Publish | presentationMode | Presentation Mode... | | `#L3954` |
| Share `[theme:simple]` | (status item) | Offline / network or realtime error text, disabled | Not a standalone app | `put('share')` `#L5576` |
| Share | share | Share... | Not a standalone app | |
| Share | publishLink | Publish... | | |
| Share | presentationMode | Presentation Mode... | `[web]`, own Drive domain, draw.io service | |
| Share | accounts | Accounts... | `getMainUser() != null` | |

### Open from / Open Recent / New Library / Open Library from

Source: `js/diagramly/Menus.js` `put('openRecent')` `#L4621`, `put('openFrom')` `#L4659`, `put('newLibrary')` `#L4803`, `put('openLibraryFrom')` `#L4891`. Library menus exist only when `Editor.enableCustomLibraries` is set.

| Menu | Entries (plain items) |
|---|---|
| Open from | Google Drive `[drive]`, OneDrive `[onedrive]`, Microsoft 365 (`App.MODE_M365`, gated by the `ms365` URL param per Init.js), Dropbox `[dropbox]`, GitHub `[github]`, GitLab `[gitlab]`, Trello `[trello]`, Browser `[browser]`, Device `[device]`, URL... `[flag:!offline]` (sets `#U<url>` or opens a new window). Unready backends show "(Loading...)" disabled. |
| Open Recent (web) | "<title> (<storage>)" per recent file, then Reset. `[browser]` needs localStorage. |
| Open Recent `[desktop]` | One entry per recent file path, then Reset |
| New Library | Google Drive, OneDrive, GitHub, Trello, Browser, Device, Confluence Cloud `[flag:confLib=1]`. No Dropbox or GitLab entry. |
| Open Library from | Google Drive, OneDrive, Dropbox, GitHub, GitLab, Trello, Browser, Device, URL... `[flag:!offline]`, Confluence Cloud `[flag:confLib=1]` |

### Extras (classic)

Source: `js/diagramly/Menus.js` `this.put('extras')` `else` branch (`#L5494-5549`).

| id / submenu | Label | Condition |
|---|---|---|
| ▸ appearance | Appearance | Not embed, or `atlas=1`. Disabled without `light-dark()` support. |
| ▸ language | Language | Needs localStorage or the Chrome app. In embed mode only without `lang`. |
| ▸ theme | Theme | `isThemeMenuVisible()`: not embed (unless `themes=1` with no `ui`/`sketch`), not `extAuth`, not Atlas mode |
| googleFonts | Google Fonts (toggle) | `[desktop]`. Requires a restart. |
| spellCheck | Spell Checker (toggle) | `[desktop]`. Requires a restart. |
| autoBkp | Automatic Backup (toggle) | `[desktop]` |
| drafts | Drafts... | `[desktop]`. Sets the draft save interval in seconds; 0 disables. |
| autoUpdate | Automatic Updates (toggle) | `[desktop]`, `autoUpdate` URL param present and not `disableUpdate=1` |
| mathematicalTypesetting | Mathematical Typesetting (toggle) | `DrawioMathJax` loaded. FAQ link. |
| autosave | Autosave (toggle) | Not embed. `[desktop]` toggles PDF autosave for PDF files (`ElectronApp.js#L1900`). |
| collapseExpand | Collapse/Expand (toggle) | |
| (collaboration items) | See "Collaboration items" | Not embed |
| ▸ diagramLanguage | Diagram Language | |
| editDiagram | Edit Diagram... | |
| plugins | Plugins... | Not `offline=1`, localStorage, not `plugins=0`. `[desktop]` overrides the action (`ElectronApp.js#L825`). |
| configuration | Configuration... | localStorage, not embed |

### Extras as "Settings" `[theme:simple|sketch|min]`

Source: same `put('extras')`, first branch (`#L5443-5492`).

| Entry | Condition |
|---|---|
| ▸ appearance | Not embed (or `atlas=1`), not `extAuth`, not `embedInline` |
| ▸ language | Language menu exists; in embed only without `lang` |
| ▸ theme | `isThemeMenuVisible()` |
| ▸ units | Includes Page Scale... in these themes |
| ▸ diagramLanguage | |
| collapseExpand, animations, tooltips, zoomWheel | |
| ruler + collaboration items | Not simple (simple has them in View) |
| googleFonts, spellCheck, autoBkp, drafts, autoUpdate | `[desktop]` |
| configuration | Not Atlas mode. Shown even when the action is undefined; the item is skipped if the action is missing. |

These themes have no Mathematical Typesetting, Autosave (except File in simple), Plugins or Edit Diagram (simple/min have Edit Diagram under Insert ▸ Advanced) in Settings.

### Appearance / Language / Theme / Units / Diagram Language

| Menu | Entries | Source |
|---|---|---|
| Appearance | autoMode "Automatic" (when `matchMedia` is supported), lightMode "Light", darkMode "Dark", highContrast "High Contrast" (toggle, when the high-contrast stylesheet is present, + GitHub issue link) | `put('appearance')` `#L3695`. Actions `#L442-470`, `#L3186`. |
| Language | "Automatic", then one entry per `mxLanguageMap` language (disabled offline if not cached), then "Manage..." (language dialog, when a service worker is ready) | `put('language')` `#L1593` |
| Theme | "Automatic" (`''`), "Classic" (`kennedy`), then `Editor.themes`: Simple, Sketch, Atlas, Minimal (`min`). The order depends on bundle load order (`Simple.js#L8-10`, `Minimal.js#L8`). | `put('theme')` `#L3733` |
| Units | points "Points", inches "Inches", millimeters "Millimeters", centimeters "Centimeters", meters "Meters" (toggles), + pageScale in simple/sketch/min | `put('units')` `#L370`. The ruler context menu reuses points/inches/millimeters/meters (`mxRuler.js#L629`). |
| Diagram Language | languageCode "Language Code..." (translates diagram labels via `Graph.diagramLanguage`), "Disabled" | `put('diagramLanguage')` `#L2122` |

### Help

Source: `js/diagramly/Menus.js` `this.put('help')` (`#L1981-2101`). This overrides grapheditor's `help`/`about`; grapheditor's `help` action is unused in diagramly.

| Variant | Entries |
|---|---|
| Offline or iOS standalone (not Chrome app) | keyboardShortcuts "Keyboard Shortcuts...", about |
| Web | (item) "Search:" with an inline text box (help search, `searchHelp`), keyboardShortcuts, quickStart "Quick Start Video...", downloadDesktop "Get Desktop...", support "Support...", about |
| `[desktop]` | Search box, keyboardShortcuts (shows bundled shortcuts.svg in a dialog), quickStart, website "Website...", support, check4Updates "Check for Updates" or restartToUpdate "Restart to Update" (when downloaded; hidden with `disableUpdate=1`), desktopResetZoom "Actual Size", desktopZoomIn "Zoom In", desktopZoomOut "Zoom Out" (window zoom), openDevTools "Open Developer Tools", about |
| `[flag:test=1]` | ▸ testDevelop "Develop": createSidebarEntry, showBoundingBox, testCheckPages, testChecksum, testFixPages, testCheckFile, testDiff, testInspect, testOptimize, testXmlImageExport, (item) Performance (toggle), testShowConsole (`#L2903`) |

`about` has the label `'v' + EditorUi.VERSION` (e.g. "v32.4.1"). Shift+click toggles debug output on desktop and own domains (`#L1209`).

### Collaboration items

Source: `Menus.prototype.addCollaborationItems` (`js/diagramly/Menus.js#L141`). Shown when `file.isRealtimeEnabled() && file.isRealtimeSupported()`: Drive and OneDrive (`DriveFile.js#L560`, `OneDriveFile.js#L226`), `Editor.enableRealtime`, not `fast-sync=0`. Appears in Extras (classic), Settings (sketch/min), View (simple) and the View Panels dropdown.

| id | Label |
|---|---|
| showRemoteCursors | Show Remote Mouse Cursors (toggle) |
| shareCursor | Share Mouse Cursor (toggle) |
| bringEveryoneToMe | Bring Everyone to Me |
| presentToEveryone | Present to Everyone (toggle) |

### Pages menus

| Menu | Entries | Source |
|---|---|---|
| Pages (simple/sketch footer, simple overflow, page-tab "Pages" control) | insertPage "Insert Page", then one item per page. The current page opens ▸ currentPage; a checkmark marks the current page; the tooltip shows the page id. Then sortPages "Sort Pages" and (item) "Delete All". | `put('pages')` `#L5282`, `Pages.js` `createPageMenuTab` `#L2671` |
| Current Page | renamePage "Rename Page...", removePage "Remove Page", ▸ movePage "Move" (when there is more than one page), duplicatePage "Duplicate Page", (item) "Open in New Window" (`[web]`, draw.io service, not embed) | `put('currentPage')` `#L5252` |
| Move | One item per other page | `put('movePage')` `#L5552` |
| Page tab context menu | Open in New Window `[web]`, duplicatePage, ▸ movePage, removePage, renamePage | `Pages.js` `EditorUi.prototype.createPageMenu` `#L2805` |

Keyboard-only page actions not in menus: previousPage / nextPage (Ctrl+Shift+PgUp / PgDn, `Pages.js#L903-916`).

### Toolbar dropdown menus (not menubar, listed for completeness)

| Menu | Entries | Source |
|---|---|---|
| viewPanels (classic toolbar) | toggleShapes, format, ruler, findReplace, layers, tags, outline, comments (Drive), collaboration items, fullscreen | `js/diagramly/Menus.js#L5147` |
| viewZoom (classic toolbar; "Zoom" in simple overflow) | resetView, fitWindow (Ctrl+Shift+H), (items) 25%, 50%, 75%, 100%, 125%, 150%, 200%, 300%, 400%, fitPageWidth, fitPage (Ctrl+J), fitTwoPages (Ctrl+Shift+J), customZoom "Custom..." (Ctrl+0). `[theme:sketch\|min]` adds outline and fullscreen. | `js/grapheditor/Menus.js#L444`, `js/diagramly/Menus.js#L1701` |
| dynamicAppearance `[theme:simple]` overflow | Width-dependent: ▸ Zoom (under 750px), ▸ Pages (under 460px), ▸ Insert (under 320px), ▸ Share (under 360px) | `#L3654` |
| save | save, makeCopy/saveAs, rename, moveToFolder, upload, autosave, revisionHistory | `put('save')` `#L5769`. Defined, but no current menubar reference found. Only `Minimal.js#L234` enables it (unconfirmed where it is shown). |
| adaptiveColors | defaultAdaptiveColors, automaticAdaptiveColors, simpleAdaptiveColors, noAdaptiveColors | `put('adaptiveColors')` `#L944`. No reference by name found (unconfirmed usage). |

Format-panel and toolbar style menus are defined in `js/grapheditor/Menus.js` `init` and covered in sections 3 and 5: `edgeStyle`, `edgeShape`, `line`, `fontFamily`, `formatBlock`, `fontSize`. Context-menu submenus (`editCell`, popup items) are covered in section 2.

### Plugin-contributed menu items

Source: `plugins/*.js`. Loaded via the Plugins dialog, `App.pluginRegistry` (`js/diagramly/App.js#L331`).

| Plugin | Adds | Menu |
|---|---|---|
| anim (`animation.js`) | animation "Animation" | Extras |
| anon (`anonymize.js`) | anonymizeCurrentPage "Anonymize Current Page" | Extras |
| props | extractData "Extract Data..." | Extras |
| page (not public) | page "Reorder pages...", place "Place pages..." | Extras |
| tags | hiddenTags "Hidden Tags..." | Extras |
| sql | fromSql "From SQL" | Insert |
| replay | record "Record...", replay "Replay..." | Extras |
| text | extractText "Extract Text" (core action, menu entry added by the plugin) | Extras |
| number | number "Number..." | View (Extras when `sketch=1`) |
| rnd (not public) | randomLabel, reorderChildren, swapChildren, placeChildren | Extras (Develop when `test=1`) |
| webcola | webColaLayout "WebCola Layout..." | Arrange ▸ Layout |
| import (not public) | importFreemind "Freemind..." | New top-level "Import" menu |
| ex, flow, trees | exploreFromHere, toggleFlow, selectChildren/selectSubtree/... | Context menu only (section 2) |

### Ambiguities

- Shortcut display versus binding conflicts:
  - `editConnectionPoints` displays Alt+Shift+Q, but diagramly rebinds Alt+Shift+Q to copyStyle and Alt+Shift+W to pasteStyle (`js/diagramly/EditorUi.js#L19756-19757`).
  - `pasteTextStyle` displays Alt+Shift+V, which is bound to pasteSize (`EditorUi.prototype.altShiftActions`).
  - `copyTextStyle` displays Alt+Shift+C, which `Trees.js#L1442` binds to selectChildren when a cell is selected.
  - `synchronize` (Alt+Shift+S) collides with selectSiblings in the same Trees.js map.
  - Alt+C / Alt+V for copy/paste style come from `Trees.js#L1448` and are confirmed by shortcuts.svg.
- VSDX export is gated to `getServiceName()=='atlassian'` in this repo. The draw.io web app ships with `getServiceName()=='draw.io'`, so the web menu should not show it. Not verified against a running build.
- Theme order in the Theme menu depends on concatenation order of Minimal.js and Simple.js. The build file was not inspected.
- Availability of ELK (`ElkLayout`) and libavoid (`LibavoidRouting`) layout items depends on bundle loading. Both are standard in app.min.js per repo notes; not verified.
- Desktop gating (`EditorUi.isElectronApp`) is visible here, but desktop-native menus (the OS menu bar) live in the drawio-desktop repo and are not covered.

Counts: menu_items=200, menu_leaf_entries≈290, submenus=31 (37 named menus including the 6 classic top-level menus), total_action_ids_defined=284 (core, excluding plugins).

How counted:

- menu_items: unique action ids placed by `addMenuItem(s)` in any menu reachable from a top-level menu in any theme or platform. Scripted over `js/grapheditor/*.js` and `js/diagramly/*.js`, plus variable lists (`exportItems`, `desktopItems`), runLastLayout, and mergeCells/unmergeCells (Table submenu). Excludes context-menu-only, toolbar-dropdown-only, plugin and grapheditor-only (`help`) items. Includes 12 `test=1` developer items.
- menu_leaf_entries: menu_items plus plain `addItem` entries. That covers align ×6, distribute ×4, flip ×2, zoom % ×9, ELK/orgChart/circle/orthogonal/parallels ×10, Open from ×10, Import from ×9, New Library ×7, Open Library from ×10, recent/reset, language/theme/diagram-language selectors, Pages list, Delete All, Open in New Window, help search, Performance, and table row/column ops ×6. Dynamic lists count as one entry each, so the result is approximate.
- submenus: distinct named menus reachable from the menubar: file, edit, view, arrange, extras, help, direction, align, distribute, distributeSpacing, navigation, insert, layout, insertLayout, insertAdvanced, table, exportAs, importFrom, embed, publish, openFrom, openRecent, newLibrary, openLibraryFrom, units, appearance, language, theme, diagramLanguage, testDevelop, diagram, pages, currentPage, movePage, share, dynamicAppearance, viewZoom. That is 37 names, 31 of them beyond the 6 classic top-level menus. `diagram`, `view`, `insert`, `pages` and `share` also act as top-level buttons in simple/sketch/min.
- total_action_ids_defined: unique ids from `addAction`/`put(id, new Action)` in `js/grapheditor/Actions.js` and `js/diagramly/*.js`, plus loop-registered ids (bold/italic/underline, 7 layout containers, 4 parse-dialog inserts, turn, rotateEdge, smartFit, openFolder, exportVsdx).

## 2. Actions not reachable from menus

Scope: action ids that are not placed in any menubar menu, plus context menus, keyboard-only bindings, and canvas affordances. Menubar reachability was computed from every `this.put('<menu>', new Menu(...))` body in `js/grapheditor/Menus.js` and `js/diagramly/Menus.js`, including `Menus.prototype.addCollaborationItems`, the desktop `desktopItems` list in the Extras menu (`js/diagramly/Menus.js#L5355-5440`), and the Electron `file` override (`js/diagramly/ElectronApp.js#L396`). The top-level menus are `file edit view arrange extras help` (`Menus.prototype.defaultMenuItems`) and `diagram` (the single "hamburger" menu of the min, sketch and simple themes).

Not part of the menubar: `viewPanels` (toolbar panels dropdown), `viewZoom` (zoom dropdown), `edgeStyle` and `edgeShape` (toolbar), `formatBlock`, `fontFamily` and `fontSize` (text toolbar), `line` (context menu), `editCell` (context menu), `pages`, `currentPage` and `movePage` (page tabs), `dynamicAppearance` (overflow menu in the simple theme), and `adaptiveColors` (orphan, see below).

### Action ids not reachable from the menubar (90)

Source: definitions are in `js/grapheditor/Actions.js` (`Actions.prototype.init`) unless noted. Labels are English values from `resources/dia.txt`. "Omni" means the item can be found and run from the sidebar search box. That box is the "Type / to search" command palette in `Sidebar.prototype.addSearchPalette`, and it lists every visible, enabled action except `about`, `deleteAll`, `showBoundingBox`, `createSidebarEntry`, `downloadDesktop` and the `test*` ids (`js/grapheditor/Sidebar.js#L1985 hiddenTags/findAction`).

| id | label | shortcut | where reachable |
|---|---|---|---|
| adaptiveColors (`diagramly/Menus.js#L1689`) | Adaptive Colors | Ctrl/Cmd+Shift+6 | Keyboard (`diagramly/EditorUi.js#L19755`), omni. Opens the non-modal `AdaptiveColorsWindow` (`diagramly/Dialogs.js#L10756`). |
| defaultAdaptiveColors, automaticAdaptiveColors, simpleAdaptiveColors, noAdaptiveColors (`diagramly/Menus.js#L886-931`) | (no dia.txt key) / Automatic / Simple / None | – | They belong only to the `adaptiveColors` Menu (`Menus.js#L944`), which nothing attaches to the UI. Reachable only from omni (unconfirmed: probably dead code). |
| addConnectionPoint | Add Connection Point | – | Context menu on a vertex when the right-click lands on a connection point (`Menus.prototype.addConnectionPointMenuItem`). Also in the `editCell` submenu. |
| addToScratchpad (`diagramly/Menus.js#L3718`) | Add to Scratchpad | – | Context menu when the selection is not empty (`diagramly/EditorUi.js#L19357`). Hidden in passiveScroll mode. |
| addWaypoint / removeWaypoint | Add Waypoint / Remove Waypoint | – | Context menu on a single edge. Which one appears depends on whether the right-click is on a waypoint handle (`Menus.prototype.addPopupMenuCellItems`). |
| alignCellsLeft, alignCellsCenter, alignCellsRight, alignCellsTop, alignCellsMiddle, alignCellsBottom | Align Left/Center/Right/Top/Middle/Bottom | – | Omni only. Arrange > Align and the Format Arrange buttons call `graph.alignCells` directly (`grapheditor/Menus.js#L358`, `Format.js#L2587`). |
| distributeHorizontal, distributeVertical | Distribute Horizontally / Vertically | – | Omni only. Arrange > Distribute calls `graph.distributeCells` directly. |
| animation (`diagramly/Menus.js#L1339`) | Animation | – | Page Setup dialog > Animation > "Edit" button (`grapheditor/Editor.js#L3259`), omni. Opens the animation window. |
| backgroundColor, borderColor, fontColor, gradientColor | Background Color / Border Color / Font Color / Color | – | Omni only. The Format panel uses its own color controls. |
| fillColor, strokeColor | Fill Color / Line Color | – | Classic toolbar (`Toolbar.prototype.init`), omni. |
| shadow | Shadow | – | Classic toolbar, omni. |
| solid, dashed, dotted, sharp, rounded, toggleRounded, curved | Solid / Dashed / Dotted / Sharp / Rounded / (no key) / Curved | – | Omni only. These are legacy style toggles; the Format panel writes the same style keys directly. |
| clearAnchors | (no dia.txt key) | – | Format > Arrange > "Reset" dropdown > Connection Points (`Format.js#L2516`). |
| clearDefaultStyle | Clear Default Style | Ctrl/Cmd+Shift+R | Context menu on the blank canvas (classic themes), Format > Diagram button (`Format.js#L9280`), keyboard. |
| setAsDefaultStyle | Set as Default Style | Ctrl/Cmd+Shift+D | Context menu with one cell selected (classic themes), Format Style tab (`StyleFormatPanel.addStyleOps`), keyboard. |
| setAsDefaultForNewConnections / clearDefaultForNewConnections | Set New Connection Default / Clear New Connection Default | – | Context menu and Format Style tab (`Menus.prototype.getNewEdgeStyleActions`). |
| copyAsText | Copy as Text | – | Format Style "Edit" dropdown (`StyleFormatPanel.addEditOps`, `Format.js#L6732`). |
| copyData / pasteData | Copy Data / Paste Data | Alt+Shift+B / Alt+Shift+E | Keyboard (`EditorUi.altShiftActions`), `editCell` submenu, Format "Edit" dropdown. pasteData also appears as a Format button (`diagramly/Editor.js#L7875`). |
| copySize / pasteSize | Copy Size / Paste Size | Alt+Shift+F / Alt+Shift+V | Keyboard, Format Arrange buttons (`Format.js#L2506`). |
| copyStyle / pasteStyle (`diagramly/Menus.js#L1028/1049`) | Copy Style / Paste Style | Labeled Alt+C / Alt+V | Alt+C/Alt+V with any one cell selected (`diagramly/Trees.js#L1448`). Also Alt+Shift+Q/Alt+Shift+W (`diagramly/EditorUi.js#L19756`), Format Style buttons (`diagramly/Editor.js#L7871`), and the context menu in passiveScroll mode only. |
| copyTextStyle / pasteTextStyle (`diagramly/Menus.js#L1068/1092`) | Copy Text Style / Paste Text Style | Labeled Alt+Shift+C / Alt+Shift+V | Format Text tab buttons (`Format.js#L4462`), and the context menu in passiveScroll mode. The advertised keys collide: Alt+Shift+C runs selectChildren (Trees.js) and Alt+Shift+V runs pasteSize (unconfirmed: no binding to these actions found). |
| createRevision (`diagramly/Menus.js#L806`) | Create Revision | Labeled Ctrl+S | Omni only. Its function calls `save`; Ctrl+S is bound to `save`. |
| crop | Crop | – | Context menu on image vertices (classic), `editCell` submenu, Format panel (`Format.js` uses `actions.get('crop')`). |
| image | Image | – | Context menu "Edit Image..." on image vertices (classic, `Menus.prototype.addPopupMenuCellEditItems`). Also the text-toolbar "Insert Image" item (`Toolbar.js#L311`). |
| editImage, editShape | Edit Image / Edit Shape | – | Format "Edit" dropdown, `editCell` submenu (min/sketch/simple context menu). |
| link | Link | – | Text-editing toolbar > Insert Link (`Toolbar.js#L307`). Inserts a hyperlink into the selected label text. |
| customZoom | Custom | Ctrl/Cmd+0 | Zoom dropdown (`viewZoom`), Alt+click on the zoom label (`grapheditor/EditorUi.js#L8884`), Alt+click on the min-theme Fit button, keyboard. |
| fitWindow, fitPage, fitTwoPages, fitPageWidth | Fit Window / Fit Page / Two Pages / Fit Page Width | Ctrl/Cmd+Shift+H, Ctrl/Cmd+J, Ctrl/Cmd+Shift+J, – | Zoom dropdown (`grapheditor/Menus.js#L444 viewZoom`), keyboard. |
| smartFit (`Actions.js#L37`) | "Fit Window / Reset View" (getTitle) | Enter | Enter with an empty selection (through keyPressEnter), Shift+click on the zoom label, min-theme Fit button (`Minimal.js#L648`), lightbox toolbar Fit (`grapheditor/EditorUi.js#L4165`). |
| keyPressEnter | (no key) | Enter | Keyboard only. Runs smartFit when nothing is selected, otherwise starts label editing. |
| decreaseFontSize / increaseFontSize | (no key) | Ctrl+Shift+Numpad− / Numpad+, Ctrl+{ / Ctrl+} | Keyboard only (`grapheditor/EditorUi.js#L8605-8608`). |
| deleteAll | Delete All | Ctrl/Cmd+Delete, Ctrl/Cmd+Backspace | Keyboard only. Deletes cells together with their connections (hidden from omni). |
| deleteLabels | (no key) | Shift+Delete, Shift+Backspace | Keyboard only. Clears the labels of the selected cells. |
| subscript / superscript | Subscript / Superscript | Ctrl/Cmd+, / Ctrl/Cmd+. | Keyboard while editing a label. The Format Text buttons call `execCommand` directly. |
| formattedText | Formatted Text | – | Format Text tab "Formatted Text" checkbox (`Format.js#L5137`). |
| wordWrap | Word Wrap | – | Omni only. The Format "Word Wrap" checkbox writes the style key directly (`Format.js#L5126`). |
| removeFormat | Clear Formatting | – | Format Text tab button (`Format.js#L4483`). |
| duplicatePage (`diagramly/Menus.js#L286`) | Duplicate {Page} | – | Page tab menu (`EditorUi.prototype.createPageMenu`), and the `currentPage` submenu of the Pages dropdown. |
| removePage, renamePage | Remove {Page} / Rename {Page} | – | Page tab menu, Pages dropdown. renamePage also runs on double-click of a tab (`Pages.js#L2737`). |
| insertPage | Insert Page | – | "+" tab (`EditorUi.prototype.createPageInsertTab`), Pages dropdown. |
| sortPages | Sort Pages | – | Pages dropdown (`diagramly/Menus.js#L5282 pages`). |
| previousPage / nextPage (`Pages.js#L903`) | Previous Page / Next Page | Ctrl/Cmd+Shift+PgUp / PgDn | Keyboard (`Pages.js#L915`), lightbox/chromeless toolbar arrows. |
| pasteHere | Paste Here | – | Context menu on the blank canvas. Pastes at the click point. |
| mergeCells / unmergeCells (`Actions.js#L438/456`) | Merge / Unmerge | – | Format Arrange table section (`Format.js#L2365`), and the context menu in the min/sketch/simple themes. |
| swap | Swap | – | Format Arrange button. Enabled when exactly 2 vertices are selected (`grapheditor/EditorUi.js#L6728`). Swaps their shapes. |
| explore | Explore | – | Format Arrange button for a single vertex that has neighbors (`Format.js#L2560`). Opens the neighborhood explorer (`Graph.exploreFromCell`). |
| rotateEdge (`Actions.js#L506`) | (no key) | – | Format Arrange "Turn" button for unconnected edges only (`Format.js#L2842`). |
| selectConnections (`Actions.js#L508`) | Select Edges | – | Context menu on a non-tree vertex that has edges (`diagramly/Trees.js#L357`). |
| selectChildren, selectDescendants, selectParent, selectSiblings (`diagramly/Trees.js#L363-449`) | Select Children / Descendants / Parent / Siblings | Alt+Shift+C / X / P / S | Context menu on tree vertices. Keyboard works with any one cell selected (`Trees.js#L1442`). |
| extractText (`diagramly/Menus.js#L757`) | Extract Text | – | Extras > Edit Diagram dialog, "Extract Text" option (`grapheditor/Dialogs.js#L3029`). |
| shapes (`diagramly/Menus.js#L2924`) | More Shapes | – | "+ More Shapes" button at the bottom of the sidebar (`grapheditor/Sidebar.js#L476`). Opens `MoreShapesDialog`. |
| shadowVisible (`diagramly/Menus.js#L1202`) | Shadow | – | Omni only. Format > Diagram calls `graph.setShadowVisible` directly (`Format.js#L8311`). |
| preview (`Actions.js#L144`) | Preview | – | Omni only (legacy `mxUtils.show`). |

Plugin actions (`plugins/*.js`), for completeness. Most add themselves to menus. Context-menu only: `exploreFromHere` [plugin:explore] and `toggleFlow` [plugin:flow] (`createPopupMenu` override). In menus: `anonymizeCurrentPage`, `extractData`, `page`/`place`, `record`/`replay`, `hiddenTags` (all under Extras), `fromSql` (Insert), `number` (View, or Extras in sketch), `randomLabel`/`swapChildren`/`placeChildren`/`reorderChildren`, and `importFreemind` (adds its own "Import" menubar menu).

Dev-only ids [flag:test] (`diagramly/Menus.js#L2133` `urlParams['test']=='1'`), shown in the `testDevelop` menu: `createSidebarEntry`, `showBoundingBox`, `testCheckFile`, `testDiff`, `testChecksum`, `testCheckPages`, `testFixPages`, `testOptimize`, `testInspect`, `testXmlImageExport`, `testShowConsole`, `testPerformance`.

### Toolbars and other non-menu surfaces

| Surface | Contents | Source / gating |
|---|---|---|
| Classic toolbar | Panels dropdown (`viewPanels`: Shapes, Format, Ruler, Find/Replace, Layers, Tags, Outline, Comments, collaboration items, Fullscreen), zoom input + `viewZoom` dropdown, zoomIn/Out, undo/redo, delete, toFront/toBack, fillColor, strokeColor, shadow, `edgeShape` ("Connection") and `edgeStyle` ("Waypoints") dropdowns, Insert (+) menu, shape picker, table grid picker, insertFreehand, generate, layout dropdown | `Toolbar.prototype.init`. Themes other than min, sketch and simple. Items hide progressively as the window narrows (`data-min-width`). |
| Zoom label | Click opens the zoom levels (25–400%, Fit Window, Fit Page Width, Fit Page, Two Pages, Custom). Shift+click runs smartFit; Alt+click runs customZoom | `grapheditor/EditorUi.js#L8825-8894` |
| Text-editing toolbar (replaces the toolbar while an HTML label is edited) | formatBlock (paragraph/heading), fontFamily, fontSize, undo/redo, bold/italic/underline, alignment (left/center/right/justify, numbered and bulleted lists, indent/outdent), subscript, superscript, fontColor, backgroundColor, removeFormat, HTML source toggle, Insert (Link, Image, Horizontal Rule), table editing (insert column before/after, delete column, insert row before/after, delete row) | `Toolbar.prototype.createTextToolbar`, activated from `grapheditor/EditorUi.js#L656` |
| Min theme top bar | `diagram` menu button, Shapes, Format, Insert, Delete, undo/redo, Fit (smartFit; Alt+click = customZoom), zoom in/out | `diagramly/Minimal.js#L690-727` [theme:min]. The Fit tooltip says "Ctrl+H", but the only fit binding is Ctrl+Shift+H (inconsistency). |
| Sketch/simple floating picker | Text (A), Note (S), Rectangle (D), Ellipse (F), Line (C), Freehand (X), Shapes, Insert, collapse toggle. The simple theme shows a subset: Text, Rectangle, Shapes, Freehand, Insert | `diagramly/Simple.js#L380-460` [theme:sketch] [theme:simple] |
| Simple theme header | Main menu (`diagram`), Format, Share, Comments, Pages, undo/redo, delete, fullscreen, exit, overflow (`dynamicAppearance`: zoom, pages, insert and share when the window is narrow) | `diagramly/Simple.js#L60-131,585-680,760` [theme:simple] |
| Inline edge toolbar (floating, appears for exactly one unlocked edge) | Line: dash patterns solid/dashed 1–4/dotted 1–3, stroke width, stroke color, plus fill and gradient for arrow-shaped edges. Line End: start and end markers. Connection: straight, orthogonal, "Auto-route around shapes" (libavoid), horizontal, vertical, isometric (2 variants), curved, entity relation, sequence diagram; edge shape (line, link, arrow, simple arrow, tapered arrow, filled edge, pipe, wire); sharp, rounded, curved | `js/grapheditor/InlineToolbar.js` (`updateSelection`, `showLineStyleMenu`, `showLineEndMenu`, `showConnStyleMenu`). On by default; turn off with `Editor.enableInlineToolbar` / config `enableInlineToolbar` |
| Lightbox / chromeless toolbar | Back, previous/next page, page counter, Layers popup [flag:layers], zoom in/out, Fit (smartFit), Edit, plus any custom `lightboxToolbarActions`, fullscreen, close | `grapheditor/EditorUi.js#L4040-4360` (viewer mode) |
| Omni search box ("Type / to search", `/` focuses it) | Search Shapes, Search Shapes in Open Libraries, Search Images, Search Templates, Find in Diagram, Generate (AI) [web] [flag:enableAi], Help search [web], best-matching action plus the 5 most recent actions, matching pages, Open Library for matching libraries. Enter runs the best match | `Sidebar.prototype.addSearchPalette` (`grapheditor/Sidebar.js#L1878-2300`) |
| Sidebar footer | "+ More Shapes" (action `shapes`) | `grapheditor/Sidebar.js#L476` |
| Page tab bar | "+" insertPage, Pages dropdown (all pages, `currentPage` submenu, Sort Pages, Delete All), per-tab chevron or right-click menu, double-click to rename, drag to reorder | `diagramly/Pages.js` (`createPageInsertTab`, `createPageMenuTab`, `createPageMenu`, tab `dragstart` `#L2190`) |
| Ruler | Right-click opens the units menu (points, inches, millimeters, meters; centimeters is missing here even though the action exists) | `diagramly/mxRuler.js#L606-640` |
| Link hint (below a selected cell that has a link) | Opens the link, plus edit-link and remove-link buttons | `mxVertexHandler.prototype.updateLinkHint` (`Graph.js#L36323`), `Graph.prototype.createLinkForHint` |
| Cell overlay icons | Note icon (bottom-left, on by default) opens a note box with an Edit button. Comment icon (bottom-right) opens the Comments window at that cell. Link and tooltip icons are off by default (config `showLinkIcons` / `showTooltipIcons`) | `Graph.prototype.createNoteOverlay` (`Graph.js#L26043`), `createLinkOverlay`, `createTooltipOverlay`, `diagramly/EditorUi.js updateCommentOverlays#L32874` |
| Format "Edit" dropdown (one cell selected) | edit, copyAsText, editLink, editShape, editImage, editData, copyData, pasteData, editConnectionPoints, editGeometry, editPolygon, editTooltip, editNote, editStyle, plus an "Open Library" pseudo-op that opens the sidebar library containing the shape | `StyleFormatPanel.prototype.addEditOps` (`Format.js#L6720`) |
| Configurable shortcuts | Config `keyboardShortcuts` (rebinds any action id or removes a binding). Config `passThroughKeys` forwards chords to the embedding host as `{event:'shortcut'}` [embed] | `diagramly/EditorUi.js installKeyboardShortcuts#L27289`, `installPassThroughKeys#L27219`, `diagramly/Editor.js#L2969-2987` |

### Context menu structure

Source: `Menus.prototype.createPopupMenu` → `addPopupMenuItems` → History, Edit, Style, Arrange, Cell, and Selection items (`js/grapheditor/Menus.js#L1475-1813`). Overrides: `diagramly/EditorUi.js#L19334-19516` (`addPopupMenuItems`, `addPopupMenuEditItems`, `isShow*Items`), `diagramly/Trees.js#L325`. Classic means `isShowStyleItems()` is true, that is, every theme except simple, sketch and min. The menu uses `smartSeparators` and hides shortcuts.

| Variant | Items (in order) |
|---|---|
| Blank canvas, classic | undo, redo, pasteHere, copyAsImage, copyAsSvg, clearDefaultStyle, selectAll, selectVertices, selectEdges |
| Blank canvas, sketch/min | undo, redo, pasteHere, copyAsImage, copyAsSvg, selectAll, selectVertices, selectEdges, exitGroup, home |
| Blank canvas, simple | zoomIn, zoomOut, then as sketch without undo/redo (`isShowHistoryItems` is false for simple) |
| Blank canvas, passiveScroll [flag:passiveScroll] [embed] | The Insert submenu (inserts at the right-click point) is prepended |
| One vertex, classic | Delete (red), cut, copy, copyAsImage, copyAsSvg, duplicate, lockUnlock, setAsDefaultStyle (+ clearDefaultForNewConnections if the cell has `newEdgeStyle`), group/ungroup (if the vertex has children and is not a swimlane), toFront, toBack, bringForward, sendBackward, clearWaypoints (if it has edges), editStyle, editData, editLink, (addConnectionPoint if at a point) editConnectionPoints, editPolygon (`mxgraph.basic.polygon` only), addToScratchpad, Comment... (when comments allow anchors), tree items (selectChildren/selectDescendants/selectSiblings/selectParent) or selectConnections |
| One edge, classic | Delete, cut, copy, copyAsImage, copyAsSvg, duplicate, lockUnlock, setAsDefaultStyle, setAsDefaultForNewConnections, toFront…sendBackward, Line submenu (`line` = the `edgeStyle` + `edgeShape` menus), Reverse (`turn`; hidden for entityRelation and arrow shapes), addWaypoint or removeWaypoint (depends on the click point), clearWaypoints, editStyle, editData, editLink, addToScratchpad |
| Image vertex, classic | One-vertex items plus "Edit Image..." (`image`) and crop |
| Multiple selection, classic | Delete (n), cut, copy, copyAsImage, copyAsSvg, duplicate, lockUnlock, group, ungroup, Align submenu, Distribute submenu (if more than one editable), toFront, toBack, (Line submenu, Reverse and clearWaypoints if edges only), addToScratchpad, Comment... |
| Group / container | group and ungroup are shown when the vertex has children and is not a swimlane. Otherwise as one vertex |
| Locked cell | Cell-edit items are omitted (they require `isCellEditable`). Delete is disabled because `deletable=0`. lockUnlock toggles the lock (`Actions.js#L521`: sets movable, resizable, rotatable, deletable, editable, connectable, locked) |
| Any selection, sketch/min/simple | Group/align/distribute/order items first (the arrange items move up), cut, copy, copyAsImage, copyAsSvg, duplicate, Delete, lockUnlock. Then, for one editable cell, the Edit submenu (`editCell`: editLink, editShape, editImage, crop, editData, copyData, pasteData, editPolygon, addConnectionPoint, editConnectionPoints, editGeometry, editTooltip, editNote, editStyle, edit). For an edge, the Line submenu and clearWaypoints. For one cell, enterGroup. For table cells, mergeCells or unmergeCells (`diagramly/EditorUi.js#L19461-19497`) |
| Table / row / cell, classic | No table-specific context items (unconfirmed absence is deliberate). Table editing lives in the Format Arrange table section and in the table dropdown of the toolbar and Insert menu (`Menus.prototype.addInsertTableCellItem`, which shows row/column insert and delete when a table or stack is selected) |
| Cell with link | No context items. Shows the link hint instead (see above) |
| Page tab menu | Open in New Window [web] (draw.io service only), duplicatePage, Move submenu (`movePage`, current page only, more than one page), removePage, renamePage (`EditorUi.prototype.createPageMenu`, `Pages.js#L2806`) |
| Pages dropdown (page bar) | insertPage, list of pages (the current page gets the `currentPage` submenu: rename, remove, Move, duplicatePage, Open in New Window), sortPages, Delete All (`diagramly/Menus.js#L5252-5348`) |
| Ruler | points, inches, millimeters, meters (`mxRuler.js#L627`) |
| Sidebar search result | Open Library (`diagramly/sidebar/Sidebar.js#L1383 showPopupMenuForEntry`) |
| Plugin additions | exploreFromHere [plugin:explore], toggleFlow [plugin:flow] |

### Keyboard-only and keyboard bindings

Source: `EditorUi.prototype.createKeyHandler` (`grapheditor/EditorUi.js#L8161-8615`), `altShiftActions`, `ctrlAltShiftActions` and `ctrlAltActions` (`#L8129-8156`), `EditorUi.prototype.onKeyDown` and `onKeyPress` (`#L2897-2990`), the diagramly overrides (`diagramly/EditorUi.js#L1830-1945`, `#L19743-19759`), `diagramly/Trees.js#L1436-1530`, `diagramly/Pages.js#L915`, `diagramly/ElectronApp.js#L697`. On macOS Ctrl means Cmd and Alt means Option.

| Keys | Effect | Notes |
|---|---|---|
| Arrow keys | Nudge the selection 1 unit (`Editor.getCursorMoveStep(unit)`) | The move commits after 400 ms and is one undo step. With one vertex inside a stackLayout parent, the arrows reorder it within the stack instead |
| Shift+Arrow | Nudge by the grid size | With nothing selected and several pages: Shift+Left/Right moves the current page one place; Shift+Up/Down moves it to the first or last position |
| Ctrl+Arrow | Resize the selected vertices by 1 unit | With nothing selected: Ctrl+Left/Right goes to the previous or next page; Ctrl+Up/Down to the first or last page |
| Ctrl+Shift+Arrow | Resize by the grid size | |
| Alt+Shift+Arrow | Clone the selected vertex and connect it in that direction (`graph.connectVertex`) | Tree vertices add a child or parent instead (Trees.js `connectVertex` override) |
| Tab / Shift+Tab | Select the next or previous cell | While editing: inserts a tab, or indents/outdents inside lists or a selection. Shift+Tab stops editing |
| Alt+Tab | Select the parent | While editing: stop editing |
| Tab / Shift+Tab on a tree vertex | Add a child / add a parent | `Trees.js#L1475`, for tree vertices that have an incoming tree edge |
| Enter / Shift+Enter on a tree vertex | Add a sibling after / before | Same |
| Arrow on a tree vertex | Move the selection to the neighbor in that direction (`selectCell`) | Same |
| Enter | keyPressEnter: smartFit when nothing is selected, otherwise start editing | |
| F2 | Start editing; stop editing while editing | `mxCellEditor.isStopEditingEvent` |
| Any printable key | Start editing the selected cell (typing shim, IME-safe) | `EditorUi.prototype.onKeyPress`. With a selection, single-letter shortcuts are ignored (`diagramly/EditorUi.js#L1934`) |
| Ctrl+Enter / Cmd+Enter | Duplicate the selection when not editing (`ui.ctrlEnter`; table cells duplicate their row). Stop editing when editing (Shift+Enter in Safari) | |
| Escape | Close the dialog or template-preview tooltip, cancel the drag, reset the hover icons. While editing it applies the text (`escapeCancelsEditing=false`); Ctrl/Shift/Cmd+Esc cancels | `Graph.js#L30388`, `mxCellEditor.isCancelEditingKeyEvent`. Exits in `embedInline` mode [embed] |
| Delete / Backspace | delete | |
| Ctrl+Delete / Ctrl+Backspace | deleteAll (with connections) | |
| Shift+Delete / Shift+Backspace | deleteLabels | |
| Home / Shift+Home / End | resetView / home (go to the home cell or root) / refresh | |
| Ctrl+Home / Ctrl+End | collapse / expand containers | |
| Ctrl+Shift+Home / Ctrl+Shift+End | exitGroup / enterGroup | |
| Ctrl+Shift+PgUp / PgDn | previousPage / nextPage | `Pages.js#L915` |
| A, S, D, F, R, C, L, X (nothing selected) | insertText, insertNote, insertRectangle, insertEllipse, insertRhombus, insertEdge, insertLink, insertFreehand | `diagramly/EditorUi.js#L19746-19753` |
| / | Focus the omni search box | `grapheditor/EditorUi.js#L8418` |
| Ctrl+Shift+V | Paste as unformatted text | `diagramly/EditorUi.js#L20817` (`plainPaste`) |
| Ctrl+Alt+X / Ctrl+Alt+Shift+X | copyAsImage / copyAsSvg | `ctrlAltActions`, `ctrlAltShiftActions` |
| Ctrl+Alt+Shift+F / B | bringForward / sendBackward | |
| Ctrl+Alt+T | runLastLayout | `diagramly/EditorUi.js#L19759` |
| Alt+Shift+A / O | Toggle connectionArrows / connectionPoints | |
| Alt+Shift+R / L / T / N | clearWaypoints / editLink / editTooltip / editNote | |
| Alt+Shift+F / V / B / E | copySize / pasteSize / copyData / pasteData | |
| Alt+Shift+Q / W | copyStyle / pasteStyle | Overrides the grapheditor mapping of Alt+Shift+Q to editConnectionPoints, so the "Alt+Shift+Q" label on editConnectionPoints (`diagramly/Menus.js#L1026`) is stale |
| Alt+C / Alt+V | copyStyle / pasteStyle (one cell selected) | `Trees.js#L1448` |
| Alt+Shift+C / X / P / S | selectChildren / selectDescendants / selectParent / selectSiblings (one cell selected) | With nothing selected, Alt+Shift+S runs synchronize (`altShiftActions[83]`) |
| Ctrl+F, Ctrl+K, Ctrl+Shift+K, Ctrl+Shift+M, Ctrl+Shift+6 | findReplace, tags, toggleShapes, editGeometry, adaptiveColors | diagramly |
| Ctrl+Shift+O / L / P | outline / layers / format panels | |
| Ctrl+{ / Ctrl+}, Ctrl+Shift+Numpad −/+ | decrease / increase font size | |
| Ctrl+, / Ctrl+. | subscript / superscript | Ctrl+, is ignored outside label editing so the browser can use it (`keyHandler.isEventIgnored`) |
| Ctrl+N / Ctrl+O | new / open | [desktop] `ElectronApp.js#L697` |
| Ctrl+S (embed with saveAndExit) | saveAndExit; then Ctrl+Shift+S runs save | [embed] `diagramly/EditorUi.js#L28278` |
| Space (held) | Pan with drag. Space+wheel zooms. Hover icons are suppressed | `grapheditor/EditorUi.js#L497`, `isZoomWheelEvent` override `#L594` |

The usual bindings, which also appear in menus: Ctrl+Z/Y/Shift+Z, X/C/V, D, G, Shift+U, L, M, E, R, A, Shift+A, Shift+I, Shift+E, B/I/U, S/Shift+S, P, Shift+F/B, Shift+D/R/Y/G/H/J, J, 0, numpad and keyboard +/− zoom.

Cross-check against `shortcuts.svg`:
- In the svg but not matched in code:
  - "Alt+Cursor: Scroll page". With a selection, Alt+Arrow nudges like a plain Arrow. Without one it falls through to browser scrolling (unconfirmed as a deliberate binding).
  - "Ctrl / Shift+Drag: Clone / Swap / Constrain". Clone (Ctrl/Cmd) and Constrain (Shift) are confirmed. No drag-to-swap was found; swap exists only as the Format button.
  - "Alt+Shift+Q" is not listed in the svg.
- In code but not in the svg: Ctrl+Shift+6 (adaptiveColors), Alt+Shift+Q/W (copy/paste style), Alt+Shift+S (synchronize), Ctrl+Alt+T (run last layout), Ctrl+Alt+Shift+X (copy as SVG), `/` (omni search), R and L single-key inserts, Ctrl+{ and Ctrl+} font size, tree Tab/Enter editing, Ctrl+N/O [desktop], and the configurable `keyboardShortcuts`.
- Label conflicts: copyTextStyle and pasteTextStyle advertise Alt+Shift+C/V, which are bound to selectChildren and pasteSize. editConnectionPoints advertises Alt+Shift+Q, which is bound to copyStyle. The min-theme Fit tooltip says Ctrl+H, but there is no Ctrl+H binding.

### Canvas, hover and pointer affordances

Source files: `js/grapheditor/Graph.js` (handler overrides from `#L31000` on), `js/grapheditor/EditorUi.js#L2015-2345` (double-click and shape picker), `js/grapheditor/Sidebar.js` (`itemClicked#L5788`, `createDropHandler#L4003`, `createDragSource#L4951`), `js/diagramly/EditorUi.js` (drop and paste), and the mxGraph core handlers (`mxgraph/src/handler/*`). Status: C = confirmed in code, P = partially confirmed.

| Affordance | Behavior | Source | Status |
|---|---|---|---|
| Hover arrows (quick connect) | 4 blue arrows appear around the hovered or selected vertex. Tooltip `plusTooltip`. Toggle with View > Connection Arrows (Alt+Shift+A) | `HoverIcons` (`Graph.js#L17568-18460`) | C |
| Click on a hover arrow | Plain click: if no cell lies in that direction, the shape picker opens to choose the new shape. Otherwise `connectVertex` runs. Ctrl/Cmd+click: clone the source and connect it. Shift+click: connect without duplicating (`duplicate = !shift \|\| ctrl`). Clicking an arrow that sits on an existing connected edge selects that edge | `EditorUi.hoverIcons.execute` override `#L2113`, `Graph.prototype.connectVertex#L15062` | C |
| Hover over an arrow for 300 ms | A translucent shape picker appears next to the arrow. Picking a shape inserts and connects it | `hoverIcons 'focus'` listener, `Editor.shapePickerHoverDelay=300` | C |
| Drag a hover arrow | Creates a connection. Drop it on a shape to connect, on blank canvas to make a dangling edge. Ctrl+drag clones the source at the drop point (`connectionHandler.createTarget` XOR clone event, `Graph.js#L22584`) | `mxConnectionHandler` | C |
| Hover-icon reset | Alt, Shift (without an active arrow), right-click, or Space hides the arrows | `HoverIcons.prototype.isResetEvent#L17833` | C |
| Connect handle (optional) | Extra handle at the bottom-right of the selection. Drag to connect; click to open the shape picker. Off by default; turned on per cell with `connectIcon=1` or with config `showConnectHandle` | `mxVertexHandler.isConnectHandleVisible#L31827`, `Editor.showConnectHandle=false` | C |
| Double-click blank canvas | Opens the shape picker at that point. Shift+double-click inserts a text label instead | `graph.dblClick` override `grapheditor/EditorUi.js#L2034`, `Graph.prototype.insertTextForEvent#L26411` | C |
| Double-click an edge | Adds a label (a text child) at that point | `insertTextForEvent` | C |
| Double-click an unconnected edge end | Shape picker; the picked shape is connected to that end | `showShapePickerForEdgeTerminal#L2344`, `doubleClickEdgeTerminal` event | C |
| Double-click a vertex | Edits the label. Mermaid and PlantUML cells (`mermaidData` / `plantUmlData`) open their editor dialog. Inside a locked group (`lockedGroup=1`), the whole group is edited | `diagramly/EditorUi.js#L19056` `cellEditor.startEditing` override | C |
| Double-click a waypoint | Removes the waypoint (`mxEdgeHandler.dblClickRemoveEnabled`) | `Graph.js#L33679` | C |
| Double-click an elbow edge | Toggles the elbow direction (`alternateEdgeStyle='vertical'`) | `Graph.js#L1041` | C |
| Drag to clone | Ctrl/Cmd+drag on a cell copies it (`Graph.prototype.isCloneEvent#L27773`) | | C |
| Shift+drag | Constrains the move to an axis (`mxGraph.isConstrainedEvent`) | core | C |
| Alt while moving or resizing | Ignores the grid (`isGridEnabledEvent`) and disables the guides (`mxGuide.isEnabledForEvent#L22558`) | | C |
| Resize handles | 8 sizers. Shift+resize keeps proportions; Ctrl/Cmd+resize resizes around the center (`isCenteredEvent#L31803`). Size guides snap to the size of other cells (Alt disables) | `Graph.js#L35205` | C |
| Rotation handle | Top-right handle. Drag to rotate, with rasterized steps unless Alt is held. Click to turn 90° (`rotateTooltip`). Hidden for tables, rows, cells, transparentBounds cells and `labelAutoRotate=1` | `mxVertexHandler.isRotationHandleVisible#L31813`, `#L36580` | C |
| Custom shape handles (yellow diamonds) | Adjust shape parameters such as corner size, arrow width or callout pointer. Core shapes in `Shapes.js handleFactory` (48): taperedArrow, link, pipe, flexArrow, swimlane, label, ext, rectangle (and any roundable shape), triangle, rhombus, umlLifeline, umlFrame, process, cross, note, note2, manualInput, dataStorage, callout, wedgeCallout, internalStorage, module, corner, tee, singleArrow, doubleArrow, mxgraph.arrows2.wedgeArrow(+Dashed, Dashed2), folder, document, tape, isoCube2, cylinder2, cylinder3, offPageConnector, mxgraph.basic.rect, curvedText, step, hexagon, curlyBracket, display, cube, card, loopLimit, trapezoid, parallelogram, zigzag. About 97 more `Graph.handleFactory[...]` registrations in `shapes/*.js` (Android, Arrows2, Basic, Bootstrap, Infographic and others) | `js/grapheditor/Shapes.js#L9597-10302`, `createCustomHandles` | C |
| Table handles | Drag row and column borders to resize, even when the table is not selected. Row and column move handles appear when a table is selected (drag to reorder or select rows and columns) | `Graph.js#L506-600` mouse listener, `mxVertexHandler.createMoveHandles#L32855`, `createCustomHandles` (row and column handles `#L32040-32190`) | C |
| Lock, edit and move icon handles | Lock or unlock icon on `lockedGroup` cells (`lockedGroupIcon`). Pen icon when `editIcon=1`. Move icon on `transparentBounds` cells or when `moveIcon=1` | `Graph.js#L32282-32440`, `isLockedGroupIconVisible#L14309`, `isMoveIconVisible#L15889` | C |
| Edge handles | Terminal handles show different images for floating, fixed-point and unconnected ends. Virtual bends (drag a segment midpoint to add a waypoint) via `virtualBendsEnabled`. Segment handles for orthogonal and segment edges (`mxEdgeSegmentHandler`), elbow handle for elbow edges (`mxElbowEdgeHandler`). Self-loops use the segment handler | `Graph.js#L33681`, `Graph.prototype.createEdgeHandler#L23857`, `mxGraph.createEdgeHandler` | C |
| Edge label handle | Drag the label of a selected edge to move it (`manageLabelHandle`). Vertex labels can be moved only with `labelMovable=1` | `Graph.js#L33683`, `Graph.prototype.isLabelMovable#L13778` | C |
| Direct edge drag (unselected edge) | Dragging near an end moves that end. Dragging a segment moves the segment. Dragging the middle creates and moves a new waypoint. Dragging the label moves the label. Alt or Ctrl suppresses this | `Graph.js#L605-830` (`CONSUME_MOUSE_EVENT` and mouse listener) | C |
| Connection points | Hovering a connectable shape while connecting shows its constraint points (blue ×). Dropping on a point creates a fixed connection; dropping on the shape creates a floating (perimeter) one. Shift keeps focus on fixed points (`mxConstraintHandler.isKeepFocusEvent`). View > Connection Points (Alt+Shift+O) toggles this | core + `Graph.js` | C |
| Outline connect | Holding over a shape for more than 2 s (or with Alt) connects to inner strokes. Shift+Alt disables. Style `outlineConnect` 0/1/2/3 | `Graph.js#L1347-1380`, `#L34538` | C |
| Ignore terminal | Alt while moving an edge end: no connect and no grid. Alt+Ctrl/Cmd: no connect but snap to the grid | `isIgnoreTerminalEvent#L13630`, `isGridIgnoreTerminalEvent#L13641` | C |
| Angle guides | Waypoints and ends of unstyled edges snap to 45° with guide lines (Alt disables) | `Graph.js#L35905` | C |
| Folding icon | +/- icon on containers and swimlanes, or tree folding (`treeFolding`). Hidden with Extras > Collapse/Expand | `Actions.js collapseExpand`, `Trees.js foldCells` | C |
| Rubberband | Drag on blank canvas. Alt+drag starts a rubberband inside a shape (`mxRubberband.isForceRubberbandEvent`). Alt+rubberband selects intersecting cells, as does config `intersectionSelect`. Locked cells are skipped | `Graph.js#L1525`, core | C |
| Create or remove space | Ctrl/Cmd+Shift+Alt+drag on the canvas inserts or removes space (the "scissors" tool) | `mxRubberband.prototype.isSpaceEvent#L34183` | C |
| Toggle selection | Shift+click and Ctrl/Cmd+click toggle the selection (`isToggleEvent` adds Shift) | `Graph.js#L1382` | C |
| Select behind | Alt+click selects the cell under the topmost one (Shift+click on ChromeOS) | `Graph.prototype.isTransparentClickEvent#L13622` | C |
| Hold Alt to ignore handles | Alt skips table-border, edge and handle hit-testing on mouse down | `Graph.js#L506`, `#L656` | P |
| Panning | Right-drag or middle-drag, Space+drag, scrollbars. A tooltip on the scrollbars says "Space+drag to pan". On touch, one-finger drag on blank canvas pans | `isForcePanningEvent` override `grapheditor/EditorUi.js#L556`, `Graph.js#L34156` | C |
| Wheel | Ctrl/Cmd+wheel always zooms; trackpad pinch zooms too. With `Graph.zoomWheel` (View > "Zoom with mouse wheel", default on when a trackpad is detected) a plain wheel zooms and Alt+wheel and Shift+wheel scroll. Otherwise the wheel scrolls and Alt+wheel zooms. Shift+wheel scrolls horizontally. Trackpad two-finger gestures scroll | `Graph.prototype.isZoomWheelEvent#L13571`, `Graph.trackpadDetection#L1893` | C |
| Touch | Tap and hold opens the context menu or rubberband. Pinch zooms. Tapping a selected cell opens the context menu (shortcuts.svg). Hover icons stay visible after a tap | `Graph.js#L34148-34160`, `HoverIcons.init` | P |
| Drop on an edge | Dropping a shape (from canvas or sidebar) on an edge splits it (`setDropEnabled(true)`, `Graph.prototype.isSplitTarget#L13752`). Dropping a text shape on an edge makes it the edge label | `Sidebar.createDropHandler#L4054` | C |
| Drop into a container | Dropping into a group, swimlane or container reparents the cell; the parent is highlighted (`parentHighlightEnabled`). `dropTarget=0` opts a cell out | `Graph.js#L1131`, `#L24176` | C |
| Sidebar click | Inserts at the viewport center (pop animation, `Editor.insertAnimations`). Alt+click without a single selection inserts at a free spot below the diagram | `Sidebar.prototype.itemClicked` | C |
| Sidebar Alt+click with one cell selected | Inserts and connects to the selection: south; Shift → east; Ctrl/Cmd → north; Ctrl+Shift → west | same | C |
| Sidebar Shift+click with a selection | Replaces the shape of the selected cells (`graph.updateShapes`) | same | C |
| Sidebar click on an edge template with 2 vertices selected | Connects them in selection order | `isConnectSelectedVertices` | C |
| Sidebar drag | Drag onto a hover arrow of a cell to drop and connect. Drag onto a shape (after `dropTargetDelay`) to replace its style. Drag onto an edge to split it. Drag onto an edge label to replace the label shape. Alt ignores all drop targets; Shift disables style replacement | `Sidebar.createDragSource#L5100-5570` | C |
| Sidebar hover | Large preview tooltip of the shape | `Sidebar.showTooltip` | C (not detailed) |
| Shape picker | Grid of recent and basic shapes. Opened by double-click on the canvas, hover arrows, the connect handle, the Insert > Shapes action (`showShapePicker`, `diagramly/Menus.js#L4507`) and the toolbar shapes button | `EditorUi.prototype.showShapePicker#L2445` | C |
| Table insert grid | Choose rows × columns. Ctrl/Cmd+click inserts a cross-functional swimlane (pool) instead of a table. Shift adds a title row. Alt inserts at a free spot | `Menus.prototype.addInsertTableCellItem#L589` | C |
| File drop on canvas | A .drawio, .xml or Visio file on an empty unmodified diagram opens it (Shift forces opening). Otherwise files are imported at the drop point. Ctrl asks before resizing large images; Alt inserts at the origin; Shift inserts PNG/SVG as an image and ignores embedded diagram XML. Matches the shortcuts.svg legend "Ctrl: Ask Alt: Origin Shift: As Image" | `diagramly/EditorUi.js#L19973-20035`, `importFiles#L16016` | C |
| HTML, URL or text drop | `text/uri-list`: image URLs become image cells and links become link text. HTML: a single image, a single link, or preformatted text is extracted; otherwise it is inserted as a formatted label. Ctrl affects image resizing | `diagramly/EditorUi.js#L20030-20110`, `insertTextAt#L15372` | C |
| Paste | draw.io XML (including from Miro and other apps), images, HTML and text. Plain text pasted with one cell selected replaces its label (a URL also sets the link; an image URL on an image shape replaces the image). Pastes land at the mouse pointer (`Editor.pasteAtMousePointer`); repeated pastes are offset. Ctrl+Shift+V pastes plain text. Formats are covered in section 8 | `EditorUi.prototype.pasteCells#L24117`, `pasteXml#L23973`, `installImagePasteHandler#L24550` | C |
| Page tabs | Click to switch, double-click to rename, drag to reorder, chevron or right-click for the page menu | `Pages.js#L2181-2800` | C |
| Ruler | Shows a moving guide while cells are dragged. Right-click opens the units menu | `mxRuler.js#L419-640` | C |
| Link hint | The link of the selected cell is shown below it with edit and remove buttons | `updateLinkHint#L36323` | C |

Counts: defined_actions_total=281, non_menu_actions=90, context_menu_variants=16, keyboard_bindings=127 (approximate), canvas_affordances=52

How each count was taken:
- defined_actions_total: 270 unique ids extracted from `addAction` / `actions.put` / `this.put(…Action)` in `grapheditor/Actions.js`, `diagramly/Menus.js`, `ElectronApp.js`, `Pages.js` and `Trees.js`, plus 11 actions created in loops by `addInsertAction` and `addInsertLayoutAction` (`diagramly/Menus.js#L4300-4319`). This includes 12 test/dev ids and excludes 17 plugin actions.
- non_menu_actions: ids not referenced, directly or through a submenu, from `file`, `edit`, `view`, `arrange`, `extras`, `help` or `diagram`.
- context_menu_variants: rows in the context-menu table, minus "Cell with link" (no menu) and "Plugin additions".
- keyboard_bindings: distinct chords bound in code, with each context counted separately (for example Shift+Arrow for cells and Shift+Arrow for pages). The several key codes for numpad and keyboard +/− zoom count once. Configurable shortcuts are excluded.
- canvas_affordances: rows in the canvas table.

## 3. Format panel

Source root: `src/main/webapp/`. Core: `js/grapheditor/Format.js` (draw.io 32.4.1). App-level overrides: `js/diagramly/Editor.js` (`if (window.StyleFormatPanel != null)` block, #L7355-#L9000). Selection model: `js/grapheditor/EditorUi.js` `createSelectionState` / `updateSelectionStateForCell` / `findCommonProperties` (#L1371-#L1600).

### Panel host and theme placement

| Item | Behavior | Source |
|---|---|---|
| Toggle | Action `format` (View > Format), shortcut Ctrl+Shift+P, toggle state | `js/grapheditor/Actions.js` `addAction('format')` #L2181 |
| Default/kennedy/atlas themes | Docked right sidebar (`formatWidth`, resizable, collapsible sections remembered via `editorUi.getCollapsedSections()`) | `Format` ctor #L4; `createCollapsibleSection` #L799 |
| `[theme:min]` (and `windowed`) | Floating "Format" `WrapperWindow` 240px wide; auto-hidden when window < 1000px; `[flag:windows=0]` docks it as a right panel instead | `js/diagramly/Minimal.js` `toggleFormat` #L41, `EditorUi.windowed` #L13 |
| `[theme:simple]` / `[theme:sketch]` | "Format" toggle button in the top toolbar (`formatElt`), panel docked right | `js/diagramly/Simple.js` #L711 |
| No file open | Panel cleared unless `[embed]` or chromeless | `js/diagramly/Editor.js` `Format.prototype.refresh` #L7370 |
| Refresh triggers | selection, model change, editing start/stop, unit change, autosave change, root change, `styleChanged`, `lockedChanged`, language, panel width, `fileLoaded` | `Format.prototype.init` #L227; diagramly #L7361 |
| Tab memory | Separate remembered tab index for: empty selection (`diagramIndex`), label-only selection (`labelIndex`), other (`currentIndex`) | `Format.prototype.immediateRefresh` #L292 |
| Focus restore | Focused input restored after rebuild (tabbing through inputs) | `captureFocus`/`restoreFocus` #L495 |

### Tabs per selection case

`Format.prototype.immediateRefresh` #L292; `ArrangePanel.prototype.init` #L2013; `StyleFormatPanel.prototype.init` #L6359 (+ diagramly override #L7840).

| Selection | Tabs | Notes |
|---|---|---|
| Nothing selected | Diagram (`DiagramFormatPanel`), Style (`DiagramStylePanel`) | Diagram is the default tab |
| Text being edited (in-place editor open) | Text only | Rich-text (HTML) toolbar variant of `TextFormatPanel` |
| Single vertex | Style, Text, Arrange | |
| Single edge | Style, Text, Arrange | Style shows edge-only rows (waypoints, markers, sizes, spacing, line jumps, flow animation) |
| Edge label / zero-size label (`containsLabel`) | Style, Text, Arrange | Style tab shows no fill/line/effects (only edit/style ops); Arrange shows relative position + Move... |
| Image (`shape=image`) | Style, Text, Arrange | Fill -> `imageBackground`, Line -> "Border" `imageBorder`; Edit Image + Crop...; SVG recolor rows |
| Multiple vertices | Style, Text, Arrange | Adds Align buttons + Distribute section |
| Mixed vertices + edges | Style, Text, Arrange | Line row without edge style/markers; no size/position (edges are not movable/resizable in selection state) |
| Group / container / swimlane | Style, Text, Arrange | Group Padding section, "Automatic" (transparentBounds); swimlane adds Lane Color + Divider |
| Table / row / cell | Style, Text, Arrange | Arrange gets Table section; no rotation; cell width edits column width |
| Locked (`editable=0`) cells | Arrange only (group ops incl. Lock/Unlock) | Non-editable cells are skipped by `createSelectionState`, so `ss.cells` is empty |
| View-only (graph disabled) | Diagram: View section only (grid, page view) | `DiagramFormatPanel.prototype.init` #L8879 |

### Shared control primitives

| Primitive | What it renders | Source |
|---|---|---|
| `createOption` | checkbox + label bound to getter/setter | `BaseFormatPanel.prototype.createOption` #L1046 |
| `createCellOption` | checkbox toggling one style key on selected cells | #L1134 |
| `createColorOption` / `createCellColorOption` | checkbox (none vs color) + color swatch button -> ColorDialog; light/dark aware | #L1202, #L1614 |
| `createRelativeOption` | percent spinner (e.g. opacity) | #L1846 |
| `addUnitInput` / `createStepper` | numeric input with unit suffix (pt, ", mm, cm, m) + up/down stepper | #L1778, #L923 |
| `addAction(s)` | buttons bound to action ids (label/shortcut from action) | #L858, #L890 |

### Diagram tab (nothing selected)

`DiagramFormatPanel` #L8858; diagramly `addOptions` override `js/diagramly/Editor.js` #L7398; Electron override `js/diagramly/ElectronApp.js` #L1937; paper panel `js/grapheditor/Editor.js` `PageSetupDialog.addPageFormatPanel` #L3350, `getFormats` #L3647.

| Section | Control | Type | Keys / model | Shown when |
|---|---|---|---|---|
| View | Grid | checkbox + color swatch | `gridEnabled`, `gridColor` (light-dark) | always |
| View | Grid Size | spinner (unit) | `gridSize` | always |
| View | Page View | checkbox | `pageVisible` (action `pageView`) | `DiagramFormatPanel.showPageView` |
| View | Background | checkbox | `background` color / `backgroundImage` (ChangePageSetup) | graph enabled |
| View | Change... | button -> BackgroundImageDialog | `background`, `backgroundImage` | graph enabled |
| Options | Connection Arrows | checkbox | action `connectionArrows` | enabled |
| Options | Connection Points | checkbox | action `connectionPoints` | enabled |
| Options | Guides | checkbox | action `guides` | enabled |
| Options | Autosave | checkbox | `editor.autosave` | file `isAutosaveOptional()`: `[drive]` `[onedrive]` `[dropbox]` `[browser]` `[device]` (LocalFile with fileHandle), `[desktop]` non-PDF |
| Options | Autosave (PDF files) | checkbox | desktop PDF autosave flag | `[desktop]` current file is PDF |
| Options | Mathematical Typesetting (+ help link) | checkbox | `math` (action `mathematicalTypesetting`) | `[theme:simple]` `[theme:sketch]` `[theme:min]` only, and DrawioMathJax loaded (other themes: Extras menu) |
| Paper Size | paper size | select | `pageFormat` | enabled; options: US-Letter, US-Legal, US-Tabloid, US-Executive, A0-A7, B4, B5, 16:9, 16:10, 4:3, Custom (18) |
| Paper Size | Portrait / Landscape | radio x2 | `pageFormat` w/h swap | enabled |
| Paper Size | Width / Height | number x2 | `pageFormat` | Custom |
| Paper Size | unit | select | Points, Inches (default), Millimeters, Centimeters, Meters; converts the inputs and sets `Editor.pageSizeUnit` only (not the view unit) | Custom |
| (actions) | Edit Data... | button | root cell attributes (action `editData`, Ctrl+M) | enabled |
| (actions) | Clear Default Style | button | `graph.currentVertexStyle/currentEdgeStyle` (Ctrl+Shift+R) | enabled |

### Style tab (nothing selected): diagram style

`DiagramStylePanel` #L8108 (`getGlobalStyleButtons` #L8127, `addView` #L8252, `addGraphStyles` #L8383); presets `js/diagramly/Editor.js` `Editor.styles` #L62.

| Control | Type | Keys / model | Notes |
|---|---|---|---|
| Sketch | checkbox | `sketch`, `curveFitting`, `jiggle` on all cells + `ui.setSketchMode` | |
| Rounded | checkbox | `rounded` on all cells, `roundedPerimeter` on vertices, and default styles | |
| Shadow | checkbox | page `shadowVisible` (ChangePageSetup) | disabled when `!Editor.enableShadowOption` (Safari) |
| Light/Dark | icon button | `ui.setDarkMode` | when `light-dark()` CSS supported |
| Style presets | swatch grid, 10 per page, dots + chevrons pager | `fillColor`, `strokeColor`, `fontColor`, `gradientColor`, `labelBackgroundColor`; page `background`, `gridColor`; sets `currentVertexStyle`/`currentEdgeStyle` | 20 default presets (2 pages); hover previews on canvas (non-touch); `[flag:config.styles]` replaces list |

### Style tab (cells selected)

Order: color schemes, SVG rows, Fill, Line, Line Jumps, Opacity, Effects, edit ops, style ops, Property table. `StyleFormatPanel.prototype.init` #L6359; diagramly override #L7840.

#### Color schemes (quick styles)

`js/diagramly/Editor.js` `StyleFormatPanel.prototype.addStyles` #L8729, `defaultColorSchemes` #L7800.

| Control | Type | Keys | Notes |
|---|---|---|---|
| Scheme swatches | 8 swatches x 6 pages + pager dots | `fillColor` (or `swimlaneFillColor`/`labelBackgroundColor` for labels), `strokeColor` (or `labelBorderColor`), `fontColor`, `gradientColor` | Shift-click: stroke only; Ctrl/Cmd-click: keep font color; Alt-click: keep stroke. `[flag:config.defaultColorSchemes / customColorSchemes]` |

#### SVG image recolor (image cells only)

`addSvgStyles` #L6442, `addSvgRule` #L6505, `addSvgVars` #L6594.

| Control | Type | Keys | Shown when |
|---|---|---|---|
| Fill / Line / Gradient per CSS rule | color options | rewrites embedded SVG `<style>` (`fill`, `stroke`, `stop-color`) in `image` data URI | `shape=image`, SVG data URI, `editableCssRules` regex set |
| One color per CSS variable | color options | `--<name>` style keys (light-dark); linked image converted to data URI, original kept in `imageUrl` | `cssVars` style lists variable names |

#### Fill section

`StyleFormatPanel.prototype.addFill` #L6861, `getCustomColors` #L7119; fill styles `js/grapheditor/Editor.js` `Editor.fillStyles` / `Editor.roughFillStyles` #L242-#L253.

| Control | Type | Keys | Shown when |
|---|---|---|---|
| Fill | color option | `fillColor` (`swimlaneFillColor` for untitled tables/rows via `getFillColorKey`; `imageBackground` for images) | `ss.fill` |
| Fill style | select | `fillStyle`: normal = auto, hatch, solid, dots, cross-hatch, dashed, zigzag-line; sketch = auto, hachure, solid, zigzag, cross-hatch, dashed, zigzag-line | fill set and (sketch or no gradient) |
| Gradient | color option | `gradientColor` | fill set, `ss.gradient`, not image, not sketch-with-pattern |
| Gradient direction | select | `gradientDirection`: north, east, south, west, radial | gradient set |
| Lane Color | color option | `swimlaneFillColor` | swimlane |
| Primary custom colors | color option(s) | shape `customProperties` with `primary` + type color (e.g. `footerColor`, `centerColor`) | per shape, `isVisible` |
| Stencil colors | color option(s) | stencil `fillcolor`/`strokecolor`/`fontcolor` names, or `fillColorStyles`/`strokeColorStyles` lists | stencil/shape declares them |

#### Line section

`StyleFormatPanel.prototype.addStroke` #L7193; marker list `Format.addLineMarkerItems` #L102; edge-style menu entries #L7470-#L7530; `Menus.prototype.addSequenceEdgeStyleItem` (`js/grapheditor/Menus.js` #L1146).

| Control | Type | Keys | Shown when |
|---|---|---|---|
| Line (Border for images) | color option | `strokeColor` (`imageBorder` for images); none on table cells/rows writes `inherit` | `ss.stroke` |
| Line style | select: Sharp / Rounded / Curved | `rounded`, `curved` | edges whose shape supports curved (`Graph.edgeSupportsCurved`) |
| Connection (edge shape) | icon menu: Line, Link, Arrow, Simple Arrow, Tapered Arrow, Filled Edge, Pipe, Wire | `shape` = (none)/`link`/`flexArrow`/`arrow`/`taperedArrow`/`filledEdge`/`pipe`/`wire`; clears `startSize`,`endSize`,`dashed`,`width`,`startWidth`,`endWidth`,`defaultFillColor`,`defaultGradientColor` | edges only |
| Pattern | menu: Solid, Dashed (1-4), Dotted (1-3), Custom... (prompt) | `dashed`, `dashPattern` (`8 8`, `12 12`, `8 4 1 4`, `1 1`, `1 2`, `1 4`) | always (separate copy for edges-only vs mixed) |
| Line width | spinner (unit) | `strokeWidth` (0-999) | always |
| Waypoints (edge style) | icon menu: Straight, Orthogonal, Auto-route around shapes, Horizontal, Vertical, Isometric (h), Isometric (v), Curved, Entity Relation, Sequence | `edgeStyle` (none/`orthogonalEdgeStyle`/`elbowEdgeStyle`/`isometricEdgeStyle`/`entityRelationEdgeStyle`/`sequenceEdgeStyle`), `elbow`, `curved`, `noEdgeStyle`, `libavoidRouting` | edges only; disabled (30% opacity) for `shape=arrow`; Auto-route `[flag:LibavoidRouting loaded]`; Curved if shape supports curved; Sequence if `isSequenceMessageCandidate` |
| Line Start | icon menu | `startArrow`, `startFill`, `startSize` (copy item copies other end) | edges (and `mxgraph.basic.arc`) |
| Line End | icon menu | `endArrow`, `endFill`, `endSize` | same |
| Size: Line Start / Line End | spinner x2 | `startSize`, `endSize` | edges only |
| Spacing: Line Start / Line End | spinner x2 (unit) | `sourcePerimeterSpacing`, `targetPerimeterSpacing` | edges only (hidden for arc vertex) |
| Perimeter | spinner (unit) | `perimeterSpacing` | vertices only |

Marker menu values (`Format.addLineMarkerItems`): none; filled: classic, classicThin, open, openThin, openAsync, block, blockThin, async, oval, diamond, diamondThin, doubleBlock; unfilled: classic, classicThin, block, blockThin, async, oval, diamond, diamondThin, box, halfCircle, dash, cross, circlePlus, circle (filled at start), baseDash, ERone, ERmandOne, ERmany, ERoneToMany, ERzeroToOne, ERzeroToMany, doubleBlock = 34 variants + none. For `flexArrow`: none + block only.

#### Line Jumps, Opacity, Effects

`addLineJumps` #L7835; opacity in `init` #L6397; `addEffects` #L7939.

| Section | Control | Type | Keys | Shown when |
|---|---|---|---|---|
| Line Jumps | jump style | select: None, Arc, Gap, Sharp, Line | `jumpStyle` | edges only, shape connector/filledEdge/wire, not curved (`Graph.isLineJumpState`), `Graph.lineJumpsEnabled` |
| Line Jumps | Size | spinner (unit) | `jumpSize` (default 6) | same |
| Opacity | Opacity | % spinner | `opacity` | always |
| Effects | Rounded | checkbox | `rounded` (+ `roundedPerimeter` on vertices) | `ss.rounded` |
| Effects | Divider | checkbox | `swimlaneLine` | swimlane |
| Effects | Sketch | checkbox | `sketch`, `curveFitting`, `jiggle` | always |
| Effects | Glass | checkbox | `glass` | `ss.glass` |
| Effects | Shadow | checkbox | `shadow` | always (disabled on Safari) |
| Effects | Flow Animation | checkbox | `flowAnimation` | edges only |
| Effects | Orthogonal Ends | checkbox | `orthogonal` | edges only, edge style not already orthogonal |
| Effects | Follow Terminals | checkbox | `followTerminals` | edges only, not libavoid-routed |
| Effects | Primary bool shape options | checkbox(es) | shape `customProperties` with `primary` + bool | per shape |

#### Edit ops and style ops

`addEditOps` #L6721; `StyleFormatPanel.prototype.addStyleOps` #L8086 + diagramly override #L7865; `Menus.prototype.getNewEdgeStyleActions` (`js/grapheditor/Menus.js` #L1578).

| Control | Type | Action ids | Shown when |
|---|---|---|---|
| Edit... | select (runs action) | `edit` (F2/Enter), `copyAsText`, `editLink` (Alt+Shift+L), `editShape`, `editImage`, `editData` (Ctrl+M), `copyData` (Alt+Shift+B), `pasteData` (Alt+Shift+E), `editConnectionPoints`, `editGeometry` (Ctrl+Shift+M), `editPolygon`, `editTooltip` (Alt+Shift+T), `editNote` (Alt+Shift+N), `editStyle` (Ctrl+E), `openLibrary` | single cell; each entry only if action enabled; Open Library when shape maps to sidebar libraries |
| Crop... | button | `crop` | single image cell with `image` style |
| Copy Style / Paste Style | buttons | `copyStyle` (Alt+C), `pasteStyle` (Alt+V) | single cell |
| Paste Style / Paste Data | buttons | `pasteStyle`, `pasteData` | multiple cells |
| Set as Default Style | button | `setAsDefaultStyle` (Ctrl+Shift+D) | single cell |
| Set as Default for New Connections / Clear Default for New Connections | button | `setAsDefaultForNewConnections` / `clearDefaultForNewConnections` (`newEdgeStyle`) | single edge source / vertex with `newEdgeStyle` |

#### Property table (generated)

`js/diagramly/Editor.js` `BaseFormatPanel.prototype.addProperties` #L7891; collection `js/grapheditor/EditorUi.js` `findCommonProperties` #L1446.

| Control | Type | Notes |
|---|---|---|
| Property / Value table | collapsible table (collapsed by default, `propertiesCollapsed`) | rows = intersection of `customProperties` across selection (same name+type) |
| Search filter | text input | filters rows |
| id, shape | read-only rows | cell id, `shape` |
| Value editors | checkbox (bool), color picker (color), select (enum), text input (int/float/string/numbers, with min/max), dynamic/static array lists, read-only | per property `type` |

Sources of rows: shape-class `customProperties` (below), stencil `<fillcolor|strokecolor|fontcolor color="...">` and `labelBounds if=` attributes, then `Editor.commonVertexProperties` or `Editor.commonEdgeProperties` (both include `Editor.commonProperties`), plus per-cell `customProperties` JSON attribute. `[flag:Editor.enableCustomProperties]` (default true, `js/diagramly/Editor.js` #L185).

### Text tab

`TextFormatPanel` #L4439 (`addFont` #L4497, `addFontOps` #L4460); actions `js/grapheditor/Actions.js` `toggleFontStyle` #L1448, `vertical` #L1584, `formattedText` #L1086, `removeFormat` #L1564; `js/diagramly/Menus.js` `copyTextStyle`/`pasteTextStyle` #L1068-#L1092.

#### Text tab, cell selected (not editing)

| Section | Control | Type | Keys | Shown when |
|---|---|---|---|---|
| Font | Font Family | menu | `fontFamily` (also adds `fontSource` for web fonts) | hidden if `fontFamily=inherit` |
| Font | Bold / Italic / Underline | toggle buttons | `fontStyle` bits 1/2/4 (Ctrl+B/I/U) | always |
| Font | Vertical | toggle button | `horizontal=0` | not editing |
| Font | Font Size | spinner | `fontSize` | hidden if `inherit` |
| Font | Align Left / Center / Right | buttons | `align` | always |
| Font | Top / Middle / Bottom | buttons | `verticalAlign` | not editing |
| Font | Position | select: Top Left, Top, Top Right, Left, Center, Right, Bottom Left, Bottom, Bottom Right | `labelPosition`, `verticalLabelPosition`, `align`, `verticalAlign` | not editing |
| Font | Writing Direction | select: Automatic, Left to Right, Right to Left, Vertical (LTR), Vertical (RTL) | `textDirection` (vertical-lr / vertical-rl only when `html=1`) | not editing |
| Colors | Font Color | color option | `fontColor`; none sets `noLabel=1` | hidden if `inherit` |
| Colors | Background Color | color option | `labelBackgroundColor` | not `curvedText` |
| Colors | Page Background | checkbox | `defaultLabelBackgroundColor=page` | background = default |
| Colors | Border Color | color option | `labelBorderColor` | not `curvedText` |
| Colors | Shadow | checkbox | `textShadow` | disabled on Safari |
| Advanced | Word Wrap | checkbox | `whiteSpace=wrap` (or `svgWhiteSpace` when SVG-converted) | autosize-capable cells/edges |
| Advanced | Formatted Text | checkbox | `html` (action converts newlines) | always |
| Advanced | Convert Labels to SVG (+ help link) | checkbox | `convertToSvg` | disabled when label not HTML or has unsupported markup |
| Advanced | Rotate with Edge | checkbox | `labelAutoRotate` | single edge or edge label; `Editor.enableAutoRotateLabels` |
| Advanced | Automatic Font Size | checkbox | `autosizeText` | vertices, resizable |
| Advanced | Fit Text to Shape | checkbox | `shapeInside` (needs word wrap) | shape has inside outline (`Graph.getShapeInsideOutline`) |
| Advanced | Label Width | input | `labelWidth` | always |
| Advanced | Label Padding | input (1-4 values) + stepper | `labelPadding` | label background or border set |
| Opacity | Opacity | % spinner | `textOpacity` | not editing |
| Spacing | Top / Left / Bottom / Right / Global | spinner x5 | `spacingTop`, `spacingLeft`, `spacingBottom`, `spacingRight`, `spacing` | not editing |
| Ops | Copy Text Style / Paste Text Style | buttons | `copyTextStyle` (Alt+Shift+C), `pasteTextStyle` (Alt+Shift+V) | action enabled |
| Ops | Clear Formatting | button | `removeFormat` | action enabled |

#### Text tab, while editing rich text (`cellEditor.isContentEditing()`)

| Section | Control | Type | Effect | Notes |
|---|---|---|---|---|
| Font | Style | menu: Normal, Heading 1-6, Formatted (pre), Blockquote | `execCommand('formatBlock')` | `js/grapheditor/Menus.js` `formatBlock` #L200 |
| Font | Font Family / Size | menu / spinner | inline `<font>`/CSS | same controls as above |
| Font | Bold / Italic / Underline | toggles | execCommand | |
| Font | Strikethrough | button | execCommand `strikeThrough` | edit mode only |
| Font | Left / Center / Right / Justify | buttons | execCommand | Justify edit mode only |
| Font | Subscript (Ctrl+,) / Superscript (Ctrl+.) | buttons | execCommand | |
| Font | Numbered List / Bulleted List / Increase Indent / Decrease Indent / Clear Formatting | buttons | execCommand | |
| Font | HTML | button | toggles source view (`cellEditor.toggleViewMode`) | |
| Colors | Font Color / Background Color | color options | selection text color / highlight | |
| Line Height | Line Height | % spinner | CSS `line-height` on selected blocks | |
| Insert | Link / Image / Insert Horizontal Rule / Table | buttons + table-size picker | `link`, `image` actions; `<hr>`; `<table>` | `Menus.prototype.addInsertTableItem` #L805 |
| Table | Insert Column Left / Right, Delete Column, Insert Row Above / Below, Delete Row | buttons | DOM table edit | caret inside HTML table |
| Table | Border Color / Background Color / Spacing / Left / Center / Right | buttons | table `border`, `style.borderColor`, `backgroundColor`, `cellPadding`, `align` | caret inside HTML table |

### Arrange tab

`ArrangePanel` #L2002; geometry #L3082; group padding #L3663; arrow geometry #L3972/#L4043; edge geometry #L4128; waypoints #L4278; table #L2162.

| Section | Control | Type | Keys / action | Shown when |
|---|---|---|---|---|
| Order | To Front / To Back | buttons | `toFront` (Ctrl+Shift+F), `toBack` (Ctrl+Shift+B) | cells selected |
| Order | Bring Forward / Send Backward | buttons | `bringForward` (Ctrl+Alt+Shift+F), `sendBackward` (Ctrl+Alt+Shift+B) | single cell |
| Size / Position | Width / Height | spinners (unit) | geometry; table cell width -> column width; row hides width | resizable, row, cell, or transparentBounds (read-only) |
| Size / Position | Autosize | icon button | `autosize` (Ctrl+Shift+Y) | not table cell/row |
| Size / Position | Constrain Proportions | checkbox | `aspect=fixed` | not table cell/row |
| Size / Position | Left / Top | spinners (unit) | geometry x/y (offset for relative) | movable |
| Size / Position | Relative x / y (%) | inputs | relative geometry x/y; for edge labels: x % along line + Orthogonal offset | single vertex with relative geometry |
| Size / Position | Move... | select: Line Start, Center, Line End | edge label geometry x = -1/0/1 | single edge label |
| Size / Position | Automatic | checkbox | `transparentBounds` | single vertex with children |
| Group Padding | Left / Top / Global / Bottom / Right | spinners x5 | `groupPadding` (CSS-style 1-4 values) | transparentBounds, container, has children, or `groupPadding` set (Mermaid/PlantUML image margin) |
| Arrow | Width | spinner (pt) | `width` | edge shape `link`/`flexArrow` |
| Arrow | Width: Line Start / Line End | spinners | `startWidth`, `endWidth` | edge shape `taperedArrow` |
| Line Start / Line End | Left / Top (start), Left / Top (end) | spinners (unit) | edge source/target points | single unconnected (dangling) edge |
| Waypoints | Point N Left / Top | spinner pairs (scrollable list) | geometry `points[i]`; clears `libavoidRouting` | single edge with waypoints (collapsed by default) |
| Direction | Reverse | button | `turn` (Ctrl+R) | edges only |
| Direction | Turn (rotate 90) | button | `rotateEdge` | edges with no connected end |
| Direction | Loop direction | select: North/East/South/West (2 for lifeline/backbone) | waypoints + `edgeStyle=orthogonalEdgeStyle`, `innerLoopWaypoints=1` | single self-loop |
| Rotation | Angle | spinner (deg) | `rotation` | rotatable, not table/row/cell |
| Rotation | Rotate Shape Only by 90° (/ Reverse) | button | `turn` (Ctrl+R) | selection includes vertex |
| Flip | Horizontal / Vertical | buttons | `flipH`, `flipV` via `graph.flipCells` | not label-only |
| Align | Left / Center / Right / Top / Middle / Bottom | buttons x6 | `graph.alignCells` | >1 vertex |
| Align | Snap to Grid | button | `snapToGrid` | always |
| Distribute | Horizontal / Vertical | buttons | `graph.distributeCells` | >1 vertex, not table cell/row |
| Distribute | Spacing | checkbox | equal-spacing mode for distribute | same |
| Table | Insert Column Left / Right, Delete Column | buttons | `insertTableColumn`/`deleteTableColumn` (stack: `insertLane`/`deleteLane`) | table/row/cell, or horizontal stack |
| Table | Insert Row Above / Below, Delete Row | buttons | `insertTableRow`/`deleteTableRow` (stack lanes) | table/row/cell, or vertical stack |
| Table | Merge / Unmerge | button | `mergeCells` / `unmergeCells` (`colspan`, `rowspan`) | range selected / merged cell |
| Table | Collapsed Borders | checkbox | `tableRender=collapsed` on table | `shape=table` |
| Table | Row Stripes / Column Stripes | color options | `evenRowColor`, `evenColumnColor` on table | `shape=table` |
| Group ops | Group / Ungroup | buttons | `group` (Ctrl+G), `ungroup` (Ctrl+Shift+U) | action enabled |
| Group ops | Remove from Group | button | `removeFromGroup` | single child cell |
| Group ops | Copy Size / Paste Size / Swap | buttons | `copySize` (Alt+Shift+F), `pasteSize` (Alt+Shift+V), `swap` | not table cell/row |
| Group ops | Reset... | select: Waypoints, Connection Points | `clearWaypoints` (Alt+Shift+R), `clearAnchors` | action enabled |
| Group ops | Lock/Unlock | button | `lockUnlock` (Ctrl+L): toggles `locked`, `movable`, `resizable`, `rotatable`, `deletable`, `editable`, `connectable` | any selection |
| Group ops | Explore | button | `explore` (no shortcut) | single vertex with neighbours |

### Generated property list: common rows

`js/diagramly/Editor.js` `Editor.commonProperties` #L672, `Editor.commonEdgeProperties` #L804, `Editor.roundedPerimeterProperty` #L879, `Editor.commonVertexProperties` #L888.

`Editor.commonProperties` (23; vertices and edges):

| Key | Label | Type | Visible when |
|---|---|---|---|
| `enumerate` | Enumerate | bool | |
| `enumerateValue` | Enumerate Value | string | enumerate on |
| `comic` | Comic | bool | `sketch` off |
| `jiggle`, `curveFitting`, `simplification` | Jiggle, Curve Fitting, Simplification | float | sketch or comic |
| `fillWeight`, `hachureGap`, `hachureAngle` | Fill Weight, Hachure Gap, Hachure Angle | int | sketch |
| `disableMultiStroke`, `disableMultiStrokeFill` | Disable Multi Stroke (Fill) | bool | sketch |
| `dashOffset`, `dashGap`, `zigzagOffset` | Dash Offset, Dash Gap, Zigzag Offset | int | sketch + vertices |
| `sketchStyle` | Sketch Style (Rough, Comic) | enum | sketch |
| `shadowColor` | Shadow Color | color | `shadow` or `textShadow` |
| `shadowOpacity`, `shadowOffsetX`, `shadowOffsetY`, `shadowBlur` | Shadow Opacity / Offset X / Offset Y / Blur | int | `shadow` or `textShadow` |
| `linecap` | Line Cap (Flat, Round, Square) | enum | |
| `linejoin` | Line Join (Miter, Arcs, Bevel, Miter-Clip, Round) | enum | |
| `miterlimit` | Miter Limit | int | `linejoin` miter or miter-clip |

`Editor.commonEdgeProperties` (36 own + common):

| Key | Label | Type |
|---|---|---|
| `arcSize` | Arc Size | float |
| `bezier` | Bezier | bool |
| `sourcePortConstraint`, `targetPortConstraint` | Source / Target Constraint (none, N, E, S, W, N+S, E+W) | enum |
| `jettySize` | Jetty Size | int |
| `segment` | Segment Size | int |
| `fillOpacity`, `strokeOpacity` | Fill / Stroke Opacity | int |
| `startFill`, `endFill` | Start / End Fill | bool |
| `startFillColor`, `startStrokeColor`, `endFillColor`, `endStrokeColor` | Start/End Fill/Stroke Color | color |
| `perimeterSpacing` | Terminal Spacing | float |
| `anchorPointDirection` | Anchor Direction | bool |
| `snapToPoint` | Snap to Point | bool |
| `fixedPointSpacing` | Fixed Point Spacing | bool |
| `dashPattern` | Dash Pattern | numbers |
| `fixDash` | Fixed Dash | bool |
| `flowAnimationDuration` | Flow Duration | int |
| `flowAnimationTimingFunction` | Flow Timing (linear, ease, ease-in, ease-out, ease-in-out) | enum |
| `flowAnimationDirection` | Flow Direction (normal, reverse, alternate, alternate-reverse) | enum |
| `editable`, `metaEdit`, `backgroundOutline`, `bendable`, `collapsedPoints`, `movable`, `cloneable`, `deletable` | Editable, Edit Dialog, Background Outline, Bendable, Collapsed Waypoints, Movable, Cloneable, Deletable | bool |
| `noJump`, `jumpLayers`, `ignoreEdge`, `orthogonalLoop`, `orthogonal` | No Jumps, Jump Other Layers, Ignore Edge, Loop Routing, Orthogonal | bool |

`Editor.commonVertexProperties` (53 own + common):

| Key | Label | Type | Visible when |
|---|---|---|---|
| `colspan`, `rowspan` | Colspan, Rowspan | int | single table cell |
| `resizeLastRow`, `resizeLast` | Resize Last Row / Column | bool | single table selected |
| `fillOpacity`, `strokeOpacity` | Fill / Stroke Opacity | int | |
| `overflow` | Text Overflow (visible, hidden, block, fill, width) | enum | |
| `shapeInsideShape` | Text Flow Shape (automatic, dataStorage, ellipse, hexagon, or, parallelogram, rhombus, step, trapezoid, triangle, xor) | enum | |
| `shapeInsidePadding` | Text Flow Padding | float | |
| `noLabel` | Hide Label | bool | |
| `direction` | Direction (N, E, S, W) | enum | |
| `portConstraint` | Constraint | enum | |
| `portConstraintRotation` | Rotate Constraint | bool | |
| `connectable`, `allowArrows`, `snapToPoint`, `fixDash` | Connectable, Allow Arrows, Snap to Point, Fixed Dash | bool | |
| `outlineConnect` | Outline Connect (default, delayed, always, never) | enum | |
| `perimeter` | Perimeter (none, rectangle, ellipse, rhombus, triangle, hexagon2, lifeline, orthogonal, backbone, callout, parallelogram, trapezoid, step, center) | enum | |
| `container`, `dropTarget`, `collapsible`, `recursiveResize`, `expand`, `contract`, `selectParentFirst`, `part` | Container, Drop Target, Collapsible, Resize Children, Expand, Contract, Select Parent First, Part | bool | several gated (container/children) |
| `containerType` | Container Type (default, tree) | enum | container |
| `foldingIconSize` | Folding Icon Size | int | collapsible |
| `editable`, `editIcon`, `moveIcon`, `connectIcon` | Editable, Edit Icon, Move Icon, Connect Icon | bool | |
| `lockedGroup` | Locked Group (default, unlocked, locked) | enum | group |
| `lockedGroupIcon` | Lock Icon (default, disabled, visible) | enum | group |
| `metaEdit`, `backgroundOutline`, `movable`, `movableLabel`, `autosize`, `fixedWidth`, `resizable`, `resizeWidth`, `resizeHeight`, `rotatable`, `cloneable`, `deletable` | Edit Dialog, Background Outline, Movable, Movable Label, Autosize, Fixed Width, Resizable, Resize Width, Resize Height, Rotatable, Cloneable, Deletable | bool | `movableLabel` gated |
| `autosizeGrid` | Autosize Grid (default, enabled, disabled) | enum | autosize |
| `treeFolding`, `treeMoving` | Tree Folding, Tree Moving | bool | |
| `pointerEvents`, `moveCells`, `expandToFront` | Pointer Events, Move Cells on Fold, Expand to Front | bool | gated |
| `roundedPerimeter` | Rounded Perimeter | bool | `rounded=1` (rect, label shapes) |

### Generated property list: per-shape rows

Core shapes, `js/diagramly/Editor.js` #L7481-#L7798 (118 rows, 47 shapes):

| Shape (`shape=`) | Keys |
|---|---|
| default rectangle | `arcSize`, `absoluteArcSize`, `roundedPerimeter`, `footerSize`, `footerColor` (primary color) |
| `ellipse` | `centerRadius`, `centerColor` |
| `link` | `width` |
| `zigzag` | `size` |
| `flexArrow` | `width`, `startWidth`, `endWidth` |
| `taperedArrow` | `startWidth`, `endWidth` |
| `process` | `size` (Indent) |
| `rhombus` | `arcSize`, `double` |
| `partialRectangle` | `top`, `bottom`, `left`, `right` |
| `parallelogram`, `hexagon` | `arcSize`, `size` (Slope Angle; relative or fixed by `fixedSize`) |
| `triangle` | `arcSize` |
| `document` | `size`, `boundedLbl` |
| `internalStorage` | `arcSize`, `dx`, `dy` |
| `cube` | `size`, `darkOpacity`, `darkOpacity2`, `boundedLbl` |
| `cylinder`, `cylinder3`, `umlState`, `note2` | `boundedLbl` |
| `step` | `arcSize`, `size`, `fixedSize` |
| `trapezoid` | `arcSize`, `size` |
| `tape` | `size`, `boundedLbl` |
| `note` | `size` (Fold), `darkOpacity` |
| `card` | `arcSize`, `size` (Cutoff) |
| `callout` | `arcSize`, `base`, `size`, `position`, `position2` |
| `wedgeCallout` | `arcSize`, `tipX`, `tipY`, `base` |
| `folder` | `tabWidth`, `tabHeight`, `tabPosition`, `boundedLbl` |
| `swimlane` | `arcSize`, `absoluteArcSize`, `startSize` (Header), `footerSize`, `swimlaneHead`, `swimlaneBody`, `horizontal`, `separatorColor`, `fixedHeader` |
| `table` | `rowLines`, `columnLines`, `fixedRows`, `resizeLast`, `resizeLastRow`, `tableRender` + swimlane + partialRectangle keys |
| `tableRow` | swimlane + partialRectangle keys |
| `doubleEllipse` | `margin` |
| `ext` | `arcSize`, `double`, `margin` |
| `curlyBracket` | `rounded`, `size` |
| `image` | `imageAspect` |
| `label` | `imageAspect`, `imageAlign`, `imageVerticalAlign`, `imageWidth`, `imageHeight`, `arcSize`, `absoluteArcSize`, `roundedPerimeter`, `footerSize`, `footerColor` |
| `dataStorage`, `display`, `cross` | `size` |
| `manualInput` | `size`, `arcSize`, `boundedLbl` |
| `loopLimit`, `offPageConnector` | `size`, `arcSize` |
| `singleArrow`, `doubleArrow` | `arrowWidth`, `arrowSize` |
| `corner`, `tee` | `dx`, `dy` |
| `umlLifeline` | `participant` (default, actor, boundary, entity, control), `size`, `lifelineMirror` |
| `umlFrame` | `width`, `height` (title box) |

Other shape classes with `customProperties` (rows approximate, counted as `{name:` occurrences; not all are guaranteed property rows): `js/grapheditor/Shapes.js` `mxShapeBasicRect2` (16: `rectStyle`, `size`, `absoluteCornerSize`, `indent`, `rectOutline`, `fillColor2`, `gradientColor2`, `gradientDirection2`, `top`/`right`/`bottom`/`left`, 4 corner styles); 40 files under `shapes/` (largest: `mockup/mxMockupiOS.js` ~150, `mxArrows.js` ~80, `mxElectrical.js` ~64, `mxBasic.js` ~57, `mxAWS3D.js` ~48, `mxInfographic.js` ~36, `ios7/mxIOS7Ui.js` ~33, `mxGmdl.js` ~30, `bpmn/mxBpmnShape2.js` ~29, `rack/mxRack.js` ~26, `mxBootstrap.js` ~26); total ~790 `{name:` entries across `shapes/` (approx).

### Color picker

`js/grapheditor/Dialogs.js` `ColorDialog` #L331-#L1890; `EditorUi.prototype.pickColor` (`js/grapheditor/EditorUi.js` #L7488); config `js/diagramly/Editor.js` #L3049-#L3061.

| Control | Notes |
|---|---|
| Light color input + Dark color input | colors stored as `light-dark(a,b)`; dark: Automatic or User-defined (collapsed "Advanced" area) |
| Swap / Copy buttons | swap light/dark, copy light to dark |
| Opacity button | prompt 0-100, writes alpha into color |
| Native color input (`type=color`) | system picker |
| Default palette (`defaultColors`, includes `none`) | `[flag:config.defaultColors]` |
| Preset row (`presetColors`) | `[flag:config.presetColors]`; `colorNames` for tooltips `[flag:config.colorNames]` |
| Recent colors (up to 12, 11 per row) + Reset | persisted via `mxSettings.getRecentColors` (`js/diagramly/EditorUi.js` #L23571) |
| Default / None / Inherit / "Use Black and White" | Inherit only for inheritable keys (table cells/rows) |
| Apply / Cancel, live apply | |

### Font picker

`js/grapheditor/Menus.js` `fontFamily` #L137, `defaultFonts` #L39; `js/diagramly/Menus.js` `fontFamily` #L6090; `js/diagramly/Dialogs.js` `FontDialog` #L19766.

- Default list: Helvetica, Verdana, Times New Roman, Garamond, Comic Sans MS, Courier New, Georgia, Lucida Console, Tahoma; sketch mode adds `Editor.sketchFonts` (Architects Daughter). `[flag:config.defaultFonts]`, `[flag:config.customFonts]`.
- Custom fonts list (local storage, deletable per entry), Reset, "Custom..." -> FontDialog: System Fonts, Google Fonts (name), Web Fonts (name + URL). Writes `fontFamily` + `fontSource` (URL-encoded) for web/Google fonts.
- Desktop replaces the default list with locally installed fonts unless `config.defaultFonts`/`customFonts` set `[desktop]` (`js/diagramly/ElectronApp.js` #L326-#L335).

### Not in the Format panel (handled elsewhere)

- Links and placeholders: no dedicated Format controls; reached via Style tab "Edit..." select (Edit Link, Edit Data). Placeholders checkbox lives in EditDataDialog (`js/grapheditor/Dialogs.js` #L4171).
- Math labels: only the page-level Mathematical Typesetting option (see Diagram tab gating); no per-label control.
- `clipPath`: set by Crop dialog, not edited directly.
- Tags, layers, tooltips (Edit Tooltip via Edit... select), animations: separate windows/dialogs.

Counts: format_tabs=5 (panels: Diagram, Style[diagram], Style, Text, Arrange; 4 distinct tab labels), format_sections=37 (Diagram 4, Diagram style 2, Style 9, Text 9 incl. 3 edit-mode-only, Arrange 13; counted from the section groupings above), format_controls=138 (rows in the panel control tables above, excluding the 6 shared-primitive rows and the 9 color-picker dialog rows; a row is one control or one tightly coupled group such as Left/Top or the 6 align buttons, so the number of individual widgets is higher), property_rows=246 (23 common + 36 edge-own + 53 vertex-own + 118 core per-shape in `js/diagramly/Editor.js` + 16 `mxShapeBasicRect2`; excludes ~790 approximate `{name:` entries in `shapes/*.js` and stencil-derived color/labelBounds rows), style_keys_touched=~237 (distinct style keys named in the Keys columns and per-shape lists, after dropping action ids, page/view attributes and stencil node names; approximate).

## 4. Shape libraries

Source: draw.io 32.4.1 (commit `9034053f`). Paths are relative to `src/main/webapp/`. Shape counts are approximate: they count `createVertexTemplateEntry` / `createEdgeTemplateEntry` / `addEntry` / `addDataEntry` calls (plus `fns`-filling helper calls) per palette, or `<shape>` nodes in bundled stencil files for whole-file stencil palettes. Libraries overlap (for example AWS17/AWS18/AWS current share stencils), so totals double-count.

Definition-kind legend: **S** stencil XML (`shape=mxgraph.*`, bundled in `js/stencils.min.js`); **J** JS shape class registered with `mxCellRenderer.registerShape` (`shapes/*.js`); **C** core/built-in grapheditor shapes and plain styles (`js/grapheditor/Shapes.js`, mxGraph core); **I** image library (`image=img/lib/...` SVG/PNG files); **D** inline `data:image/svg+xml` images in the style; **X** XML templates (`addDataEntry` compressed `mxGraphModel`, or composite cells via `createVertexTemplateFromCells`).

### How libraries are wired

- Palette framework: `js/grapheditor/Sidebar.js` (`addPaletteFunctions`, `addPalette`, `addStencilPalette`, `addImagePalette`, `createVertexTemplateEntry`, `createEdgeTemplateEntry`, `addDataEntry`, `addEntry` with search tags). The grapheditor `Sidebar.prototype.init` (search, general, misc, advanced, basic, arrows, uml, bpmn, flowchart, clipart) is replaced in the app.
- App palette list: `js/diagramly/sidebar/Sidebar.js` `Sidebar.prototype.init` → `initPalettes` (calls every `add*Palette`; order there is the sidebar order).
- Library sets: `Sidebar.prototype.configuration` (73 set ids; each set = `prefix` + `libs[]` palette ids). Visibility: `showEntries` merges the `libs` URL parameter, `mxSettings.getLibraries()`, or `defaultEntries`, then resolves `libAliases` (`aws2`→`aws3`, `gcp`→`gcp2`).
- Default sets: `Sidebar.prototype.defaultEntries = 'general;uml;er;bpmn;flowchart;basic;arrows2'`. (Ambiguous: `bpmn` matches no configuration id. BPMN 2.0 uses `bpmn2`, so BPMN appears to be off by default.) The search palette has its own setting, `mxSettings.settings.search`, default `true` (`js/diagramly/Settings.js` `getDefaults`).
- More Shapes dialog groups: `Sidebar.prototype.updateEntries` (`this.entries`). `search` and `.scratchpad` are prepended to Standard only when `Editor.currentTheme` is `simple`, `sketch` or `min`. The AWS current-year entry title is computed (`'AWS ' + new Date().getFullYear()`).
- Unreachable code: `Sidebar-AWS.js` (`addAWSPalette`, 17 `aws2*` palettes) and `Sidebar-GCP.js` (`addGoogleCloudPlatformCardsPalette`) are defined but never called from `initPalettes`. The `aws2`/`gcp` ids are aliased to `aws3`/`gcp2`.
- Config keys (`js/diagramly/Editor.js` `Editor.configure`): `libraries` (custom sections → `Sidebar.prototype.customEntries`), `enabledLibraries` (whitelist of set ids for More Shapes and search), `defaultLibraries`, `defaultCustomLibraries`, `appendCustomLibraries`, `expandLibraries`, `enableCustomLibraries`, `sidebarTitles`, `sidebarTitleSize`, `sidebarWidth`, `thumbWidth`, `thumbHeight`, `shapePicker`, `emptyLibraryXml`, `presetColors`, `customPresetColors`.

### Library sets (More Shapes dialog entries)

`js/diagramly/sidebar/Sidebar.js` `updateEntries` + `configuration`. "Default" = in `defaultEntries`. Palette and shape counts come from the per-palette table below.

| Set id | Display name | More Shapes group | Default | Palettes | ~Shapes | Kind | Source |
|---|---|---|---|---|---|---|---|
| `general` | General (+ Misc, Advanced) | Standard | yes | 3 | 140 | C, X (tables, lists, containers, pools, ELK layout containers) | `js/grapheditor/Sidebar.js` `addGeneralPalette`/`addMiscPalette`/`addAdvancedPalette`; `Sidebar-Advanced.js` `createAdvancedShapes` |
| `basic` | Basic | Standard | yes | 1 | 76 | S (basic.xml) + J (mxBasic.js) | `Sidebar-Basic.js` `addBasicPalette` |
| `arrows2` | Arrows | Standard | yes | 1 | 31 | J (mxArrows.js) | `Sidebar-Arrows2.js` `addArrows2Palette` |
| `clipart` | Clipart | Standard | no | 6 | 157 | I (img/lib/clip_art PNG) | `sidebar/Sidebar.js` `initPalettes` (`addImagePalette`) |
| `flowchart` | Flowchart | Standard | yes | 1 | 34 | S (flowchart.xml) + J (`mxgraph.flowchart.document2`) | `Sidebar-Flowchart.js` `addFlowchartPalette` |
| `search` | Search Shapes | Standard [theme:simple\|sketch\|min] | yes (setting `search`) | 1 | – | search UI | `js/grapheditor/Sidebar.js` `addSearchPalette` |
| `.scratchpad` | Scratchpad | Standard [theme:simple\|sketch\|min] | – | dynamic | user | custom library (browser storage) | `js/diagramly/EditorUi.js` `toggleScratchpad`; `Menus.js` action `scratchpad` |
| `active_directory` | Active Directory | Software | no | 1 | 69 | I (img/lib/active_directory SVG) | `Sidebar-ActiveDirectory.js` |
| `android` | Android | Software | no | 1 | 107 | S + J (mxAndroid.js) + X | `Sidebar-Android.js` |
| `atlassian2` | Atlassian | Software | no | 3 | 110 | S (atlassian2.xml) + J (`mxgraph.atlassian2.icon`) | `Sidebar-Atlassian2.js` |
| `atlassian` | Atlassian (legacy) | Software | no | 1 | 137 | S + J (`mxgraph.atlassian.issue`) + I (img/lib/atlassian) + X | `Sidebar-Atlassian.js` |
| `bootstrap` | Bootstrap | Software | no | 1 | 257 | J (mxBootstrap.js) + S (bootstrap.xml) | `Sidebar-Bootstrap.js` |
| `c4` | C4 | Software | no | 1 | 20 | J (mxC4.js) + C + X | `Sidebar-C4.js` |
| `dfd` | Data Flow Diagram | Software | no | 1 | 25 | J (mxDFD.js) + S (flowchart) | `Sidebar-DFD.js` |
| `er` | Entity Relation | Software | yes | 1 | 50 | J (mxER.js) + C (table) + X | `Sidebar-ER.js` `addErPalette` |
| `ios` | iOS | Software | no | 3 | 258 | J (mxMockupiOS.js, mxIOS7Ui.js) + S (ios7/*.xml) + X | `Sidebar-Ios.js`, `Sidebar-Ios7.js` |
| `mockups` | Mockups | Software | no | 8 | 104 | J (shapes/mockup/*.js) + S (mockup/*.xml) + X | `Sidebar-Mockup.js` |
| `sitemap` | Sitemap | Software | no | 1 | 50 | S | `Sidebar-Sitemap.js` |
| `salesforce` | Salesforce | Software | no | 4 | 113 | S | `Sidebar-Salesforce.js` |
| `uml25` | UML 2.5 | Software | no | 1 | 155 | J (mxUML25.js) + C + X | `Sidebar-UML25.js` |
| `uml` | UML | Software | yes | 1 | 65 | C + X | `js/grapheditor/Sidebar.js` `addUmlPalette` |
| `alibaba_cloud` | Alibaba Cloud | Networking | no | 1 | 310 | S | `Sidebar-AlibabaCloud.js` |
| `allied_telesis` | Allied Telesis | Networking | no | 7 | 58 | I | `Sidebar-AlliedTelesis.js` |
| `aws3` | AWS17 | Networking | no | 22 | 338 | S (aws3.xml) | `Sidebar-AWS3.js` |
| `aws4b` | AWS18 | Networking | no | 27 | 366 | S (aws4.xml) + J (mxAWS4.js) | `Sidebar-AWS4b.js` |
| `aws4` | AWS <current year> | Networking | no | 30 | 969 | S (aws4.xml) + J (productIcon/resourceIcon/group) | `Sidebar-AWS4.js` `addAWS4Palette` |
| `aws4r` | AWS (retired) | Networking | no | 1 | 76 | S + J | `Sidebar-AWS4.js` `addAWS4RetiredPalette` |
| `aws3d` | AWS 3D | Networking | no | 1 | 65 | S + J (mxAWS3D.js) | `Sidebar-AWS3D.js` |
| `azure2` | Azure | Networking | no | 31 | 766 | I (img/lib/azure2 SVG) | `Sidebar-Azure2.js` |
| `mscae` | Cloud & Enterprise | Networking | no | 27 | 433 | S (mscae/*.xml) + I (img/lib/mscae) | `Sidebar-MSCAE.js` |
| `cisco` | Cisco | Networking | no | 14 | 291 | S (cisco/*.xml) | `Sidebar-Cisco.js` |
| `cisco19` | Cisco19 | Networking | no | 12 | 196 | S + J (`mxgraph.cisco19.rect`) | `Sidebar-Cisco19.js` |
| `cisco_safe` | Cisco Safe | Networking | no | 9 | 506 | S + J (`compositeIcon`) | `Sidebar-CiscoSafe.js` |
| `cumulus` | Cumulus | Networking | no | 1 | 53 | I | `Sidebar-Cumulus.js` |
| `citrix2` | Citrix | Networking | no | 8 | 128 | S | `Sidebar-Citrix2.js` |
| `citrix` | Citrix (legacy) | Networking | no | 1 | 97 | S | `Sidebar-Citrix.js` |
| `dynamics365` | Dynamics365 | Networking | no | 4 | 32 | I | `Sidebar-Dynamics365.js` |
| `gcp2` | Google Cloud Platform | Networking | no | 35 | 485 | S + J (doubleRect, hexIcon) + D + X | `Sidebar-GCP2.js` |
| `gcp3` | Google Cloud Platform 2026 | Networking | no | 2 | 45 | S | `Sidebar-GCP3.js` |
| `gcpicons` | GCP Icons | Networking | no | 16 | 139 | D (inline SVG with `editableCssRules`) | `Sidebar-GCPIcons.js` |
| `ibm` | IBM | Networking | no | 14 | 188 | I (img/lib/ibm) + J (`mxgraph.ibm.box`) + S | `Sidebar-IBM.js` |
| `ibm_cloud` | IBM Cloud | Networking | no | 12 | 151 | S | `Sidebar-IBMCloud.js` |
| `kubernetes` | Kubernetes | Networking | no | 1 | 78 | S (kubernetes/kubernetes2.xml) + J (icon, icon2) | `Sidebar-Kubernetes.js` |
| `network2` | Network 2025 | Networking | no | 1 | 57 | S + J (`mxgraph.networks2.icon`) | `Sidebar-Network2.js` |
| `network` | Network 2018 | Networking | no | 1 | 61 | S + J (bus, comm_link_edge) + X | `Sidebar-Network.js` |
| `office` | Office | Networking | no | 10 | 558 | S | `Sidebar-Office.js` |
| `openstack` | OpenStack | Networking | no | 4 | 72 | S (one function × 4 colours) | `Sidebar-OpenStack.js` |
| `rack` | Rack | Networking | no | 11 | 480 | J (mxRack.js) + S (rack/*.xml) | `Sidebar-Rack.js` |
| `sap` | SAP | Networking | no | 20 | 545 | J (`mxgraph.sap.icon`) + I (img/lib/sap) + D + X | `Sidebar-SAP.js` |
| `veeam2` | Veeam | Networking | no | 9 | 343 | S (veeam2.xml, veeam/2d,3d) | `Sidebar-Veeam2.js` |
| `vvd` | VMware | Networking | no | 1 | 97 | S | `Sidebar-VVD.js` |
| `archimate4` | ArchiMate 4 | Business | no | 8 | 135 | J (mxArchiMate4.js + mxArchiMate3.js) | `Sidebar-ArchiMate4.js` |
| `archimate3` | ArchiMate 3.2 | Business | no | 8 | 155 | J (mxArchiMate3.js) | `Sidebar-ArchiMate3.js` |
| `archimate` | ArchiMate 2.1 | Business | no | 1 | 60 | J (mxArchiMate.js) | `Sidebar-ArchiMate.js` |
| `bpmn2` | BPMN 2.0 | Business | no (see note) | 5 | 267 | S (bpmn.xml) + J (mxBpmnShape2.js) + X | `Sidebar-BPMN.js` |
| `sysml` | SysML | Business | no | 12 | 249 | J (mxSysML.js) + X | `Sidebar-Sysml.js` |
| `lean_mapping` | Value Stream Mapping | Business | no | 1 | 40 | S + J (mxLeanMap.js) | `Sidebar-LeanMapping.js` |
| `cabinets` | Cabinets | Other | no | 1 | 67 | S + J | `Sidebar-Cabinet.js` |
| `infographic` | Infographic | Other | no | 1 | 80 | J (mxInfographic.js) | `Sidebar-Infographic.js` |
| `eip` | EIP | Other | no | 7 | 61 | S + J (mxEip.js) + X | `Sidebar-EIP.js` |
| `electrical` | Electrical | Other | no | 17 | 430 | S (electrical/*.xml) + J (mxElectrical.js) | `Sidebar-Electrical.js` |
| `floorplan` | Floorplans | Other | no | 1 | 81 | S + J (mxFloorplan.js) | `Sidebar-Floorplan.js` |
| `fluid_power` | Fluid Power (ISO 1219) | Other | no | 1 | 246 | S | `Sidebar-FluidPower.js` |
| `gmdl` | Material Design | Other | no | 18 | 306 | S + J (mxGmdl.js) + X | `Sidebar-Gmdl.js` |
| `pid` | Process Engineering | Other | no | 24 | 465 | S (pid/*.xml) + J (pid2/*.js) | `Sidebar-PID.js` |
| `threatModeling` | Threat Modeling | Other | no | 1 | 19 | X only | `Sidebar-ThreatModeling.js` |
| `webicons` | Web Icons | Other | no | 2 | 366 | S (webicons.xml, weblogos.xml) | `Sidebar-WebIcons.js` |
| `signs` | Signs | Other | no | 11 | 369 | S (whole signs/*.xml files) | `Sidebar-Signs.js` |

Sets in `configuration` but not in the More Shapes dialog. They can be reached only through the `libs` URL parameter or saved settings.

| Set id | Palettes | ~Shapes | Notes |
|---|---|---|---|
| `arrows` | 1 | 34 | Legacy stencil `arrows.xml` palette (`initPalettes`); More Shapes "Arrows" maps to `arrows2` |
| `azure` | 1 | 86 | Legacy Azure stencils (`Sidebar-Azure.js`) |
| `veeam` | 10 | 297 | Legacy Veeam (`Sidebar-Veeam.js`); config lists `veeam2D`, but no such palette exists |
| `aws2`, `gcp` | 0 | – | Aliases (`libAliases`); palette code is unreachable (see above) |
| `pid2` | 0 | – | Config entry with 24 libs and no palette (unconfirmed: probably legacy) |

Other config gaps: `electrical` lists `Abstract` but no `electricalAbstract` palette exists (abstract shapes sit in other electrical palettes).

### Palette ids (every built-in palette created by `initPalettes`)

504 palettes plus the `search` palette. The id is the `id` argument to `addPaletteFunctions`/`addPalette`/`addStencilPalette`/`addImagePalette`, which is also the key used by `libs`, `setCurrentSearchEntryLibrary` and the expand/collapse settings. Files are `js/diagramly/sidebar/Sidebar-*.js` unless noted. Rows marked "(stencil file)" load every shape in the stencil XML file.

| Set | Palette id | Title | ~Shapes | Function |
|---|---|---|---|---|
| search | `search` | Search Shapes | – | grapheditor/Sidebar.js addSearchPalette |
| general | `general` | General | 45 | addGeneralPalette |
| general | `misc` | Misc | 54 | addMiscPalette |
| general | `advanced` | Advanced | 41 | addAdvancedPalette+createAdvancedShapes |
| uml | `uml` | UML | 65 | addUmlPalette |
| uml25 | `uml25` | UML 2.5 | 155 | addUml25Palette |
| er | `er` | Entity Relation | 50 | addErPalette |
| alibaba_cloud | `alibaba_cloud` | Alibaba Cloud | 310 | addAlibabaCloudGeneralPalette |
| azure2 | `azure2AI Machine Learning` | Azure / AI and Machine Learning | 44 | addAzure2AIMachineLearningPalette |
| azure2 | `azure2Analytics` | Azure / Analytics | 17 | addAzure2AnalyticsPalette |
| azure2 | `azure2App Services` | Azure / App Services | 9 | addAzure2AppServicesPalette |
| azure2 | `azure2Azure Ecosystem` | Azure / Ecosystem | 3 | addAzure2EcosystemPalette |
| azure2 | `azure2Azure Stack` | Azure / Azure Stack | 8 | addAzure2AzureStackPalette |
| azure2 | `azure2Azure VMware Solution` | Azure / VMware Solution | 1 | addAzure2AzureVMwareSolutionPalette |
| azure2 | `azure2Blockchain` | Azure / Blockchain | 6 | addAzure2BlockchainPalette |
| azure2 | `azure2Compute` | Azure / Compute | 40 | addAzure2ComputePalette |
| azure2 | `azure2Containers` | Azure / Containers | 11 | addAzure2ContainersPalette |
| azure2 | `azure2CXP` | Azure / CXP | 2 | addAzure2CXPPalette |
| azure2 | `azure2Databases` | Azure / Databases | 30 | addAzure2DatabasesPalette |
| azure2 | `azure2DevOps` | Azure / DevOps | 13 | addAzure2DevOpsPalette |
| azure2 | `azure2General` | Azure / General | 100 | addAzure2GeneralPalette |
| azure2 | `azure2Hybrid and Multicloud` | Azure / Hybrid and Multicloud | 9 | addAzure2HybridAndMulticloudPalette |
| azure2 | `azure2Identity` | Azure / Identity | 38 | addAzure2IdentityPalette |
| azure2 | `azure2Integration` | Azure / Integration | 31 | addAzure2IntegrationPalette |
| azure2 | `azure2Intune` | Azure / Intune | 18 | addAzure2IntunePalette |
| azure2 | `azure2IoT` | Azure / IoT | 30 | addAzure2IOTPalette |
| azure2 | `azure2Management Governance` | Azure / Management and Governance | 35 | addAzure2ManagementGovernancePalette |
| azure2 | `azure2Menu` | Azure / Menu | 1 | addAzure2MenuPalette |
| azure2 | `azure2Migrate` | Azure / Migrate | 7 | addAzure2MigratePalette |
| azure2 | `azure2Mixed Reality` | Azure / Mixed Reality | 2 | addAzure2MixedRealityPalette |
| azure2 | `azure2Mobile` | Azure / Mobile | 3 | addAzure2MobilePalette |
| azure2 | `azure2Monitor` | Azure / Monitor | 11 | addAzure2MonitorPalette |
| azure2 | `azure2Networking` | Azure / Networking | 60 | addAzure2NetworkingPalette |
| azure2 | `azure2Other` | Azure / Other | 162 | addAzure2OtherPalette |
| azure2 | `azure2Power Platform` | Azure / Power Platform | 9 | addAzure2PowerPlatformPalette |
| azure2 | `azure2Preview` | Azure / Preview | 9 | addAzure2PreviewPalette |
| azure2 | `azure2Security` | Azure / Security | 19 | addAzure2SecurityPalette |
| azure2 | `azure2Storage` | Azure / Storage | 19 | addAzure2StoragePalette |
| azure2 | `azure2Web` | Azure / Web | 19 | addAzure2WebPalette |
| dynamics365 | `dynamics365App` | Dynamics365 / App | 21 | addDynamics365AppPalette |
| dynamics365 | `dynamics365Mixed Reality` | Dynamics365 / Mixed Reality | 6 | addDynamics365MixedRealityPalette |
| dynamics365 | `dynamics365Product Family` | Dynamics365 / Product Family | 1 | addDynamics365ProductFamilyPalette |
| dynamics365 | `dynamics365Sub App` | Dynamics365 / Sub App | 4 | addDynamics365SubAppPalette |
| ios | `ios` | iOS6 | 62 | addIosPalette |
| ios | `ios7icons` | iOS Icons | 109 | addIos7Palette |
| ios | `ios7ui` | iOS UI | 87 | addIos7Palette |
| android | `android` | Android | 107 | addAndroidPalette |
| aws3d | `aws3d` | AWS 3D | 65 | addAWS3DPalette |
| flowchart | `flowchart` | Flowchart | 34 | addFlowchartPalette |
| basic | `basic` | Basic | 76 | addBasicPalette |
| infographic | `infographic` | Infographic | 80 | addInfographicPalette |
| arrows | `arrows` | Arrows | 34 | initPalettes (stencil arrows.xml) |
| arrows2 | `arrows2` | Arrows | 31 | addArrows2Palette |
| lean_mapping | `lean_mapping` | Value Stream Mapping | 40 | addLeanMappingPalette |
| citrix | `citrix` | Citrix (legacy) | 97 | addCitrixPalette |
| azure | `azure` | Azure | 86 | addAzurePalette |
| network | `network` | Network 2018 | 61 | addNetworkPalette |
| network2 | `network2` | Network 2025 | 57 | addNetwork2Palette |
| vvd | `vvd` | VMware Validated Design | 97 | addVVDPalette |
| sitemap | `sitemap` | Sitemap | 50 | addSitemapPalette |
| c4 | `c4` | C4 | 20 | addC4Palette |
| dfd | `dfd` | Data Flow Diagram | 25 | addDFDPalette |
| threatModeling | `threatModeling` | Threat Modeling | 19 | addThreatModelingPalette |
| kubernetes | `kubernetes` | Kubernetes | 78 | addKubernetesPalette |
| cisco19 | `cisco19LAN Switching` | Cisco 19 / LAN Switching | 20 | addCisco19LANSwitchingPalette |
| cisco19 | `cisco19Routing WAN` | Cisco 19 / Routing WAN | 19 | addCisco19RoutingWANPalette |
| cisco19 | `cisco19Network Management` | Cisco 19 / Network Management | 2 | addCisco19NetworkManagementPalette |
| cisco19 | `cisco19Data Center` | Cisco 19 / Data Center | 33 | addCisco19DataCenterPalette |
| cisco19 | `cisco19Wireless LAN` | Cisco 19 / Wireless LAN | 8 | addCisco19WirelessLANPalette |
| cisco19 | `cisco19Collaboration` | Cisco 19 / Collaboration | 45 | addCisco19CollaborationPalette |
| cisco19 | `cisco19Security Clouds Connectors` | Cisco 19 / Security, Clouds and Connectors | 23 | addCisco19SecurityCloudsAndConnectorsPalette |
| cisco19 | `cisco19Endpoint Client Device Icons` | Cisco 19 / Endpoint Client and Device Icons | 13 | addCisco19EndpointClientDeviceIconsPalette |
| cisco19 | `cisco19DNA SD Access` | Cisco 19 / DNA/SD-Access | 2 | addCisco19DNASDAccessPalette |
| cisco19 | `cisco19SD WAN Viptela` | Cisco 19 / SD-WAN and Viptela | 3 | addCisco19SDWANViptelaPalette |
| cisco19 | `cisco19ETA Stealthwatch` | Cisco 19 / ETA/Stealthwatch | 3 | addCisco19StealthwatchPalette |
| cisco19 | `cisco19SAFE` | Cisco 19 / SAFE | 25 | addCisco19SafePalette |
| citrix2 | `citrix2Locations` | Citrix / Locations | 10 | addCitrix2LocationsPalette |
| citrix2 | `citrix2Users and Devices` | Citrix / Users and Devices | 12 | addCitrix2UsersAndDevicesPalette |
| citrix2 | `citrix2Cloud Services` | Citrix / Cloud Services | 21 | addCitrix2CloudServicesPalette |
| citrix2 | `citrix2Components` | Citrix / Components | 29 | addCitrix2ComponentsPalette |
| citrix2 | `citrix2Resources` | Citrix / Resources | 17 | addCitrix2ResourcesPalette |
| citrix2 | `citrix2NetScaler` | Citrix / NetScaler | 13 | addCitrix2NetScalerPalette |
| citrix2 | `citrix2Networking` | Citrix / Networking | 10 | addCitrix2NetworkingPalette |
| citrix2 | `citrix2Authentication` | Citrix / Authentication | 16 | addCitrix2AuthenticationPalette |
| mscae | `mscaeCompanies` | CAE / Companies | 13 | addMSCAECompaniesPalette |
| mscae | `mscaeEnterpriseFlat` | CAE / Enterprise (flat) | 97 | addMSCAEEnterpriseFlatPalette |
| mscae | `mscaeIntuneFlat` | CAE / Intune (flat) | 45 | addMSCAEIntuneFlatPalette |
| mscae | `mscaeOMSFlat` | CAE / OMS (flat) | 20 | addMSCAEOMSFlatPalette |
| mscae | `mscaeSystem CenterFlat` | CAE / System Center (flat) | 10 | addMSCAESystemCenterFlatPalette |
| mscae | `mscaeAI and ML Service` | CAE / AI and ML Service | 8 | addMSCAEAIandMLServicePalette |
| mscae | `mscaeAnalytics Service` | CAE / Analytics Service | 11 | addMSCAEAnalyticsServicePalette |
| mscae | `mscaeCompute Service` | CAE / Compute Service | 11 | addMSCAEComputeServicePalette |
| mscae | `mscaeCompute Service VM` | CAE / Compute Service VM | 10 | addMSCAEComputeServiceVMPalette |
| mscae | `mscaeContainer Service` | CAE / Container Service | 3 | addMSCAEContainerServiceVMPalette |
| mscae | `mscaeDatabases Service` | CAE / Databases Service | 19 | addMSCAEDatabasesServicePalette |
| mscae | `mscaeDevOps Service` | CAE / DevOps Service | 8 | addMSCAEDevOpsServicePalette |
| mscae | `mscaeGeneral Service` | CAE / General Service | 25 | addMSCAEGeneralServicePalette |
| mscae | `mscaeIdentity Service` | CAE / Identity Service | 13 | addMSCAEIdentityServicePalette |
| mscae | `mscaeIntegration Service` | CAE / Integration Service | 18 | addMSCAEIntegrationServicePalette |
| mscae | `mscaeInternet of Things Service` | CAE / Internet of Things Service | 10 | addMSCAEInternetOfThingsServicePalette |
| mscae | `mscaeIntune Service` | CAE / Intune Service | 13 | addMSCAEIntuneServicePalette |
| mscae | `mscaeManagement and Governance Service` | CAE / Management and Governance Service | 18 | addMSCAEManagementGovernanceServicePalette |
| mscae | `mscaeManagement and Governance Service Media` | CAE / Management and Governance Service - Media | 4 | addMSCAEManagementGovernanceMediaServicePalette |
| mscae | `mscaeMigrate Service` | CAE / Migrate Service | 3 | addMSCAEMigrateServicePalette |
| mscae | `mscaeMixed Reality Service` | CAE / Mixed Reality Service | 1 | addMSCAEMixedRealityServicePalette |
| mscae | `mscaeMobile Service` | CAE / Mobile Service | 3 | addMSCAEMobileServicePalette |
| mscae | `mscaeNetworking Service` | CAE / Networking Service | 27 | addMSCAENetworkingServicePalette |
| mscae | `mscaeOther Category Service` | CAE / Other Category Service | 12 | addMSCAEOtherCategoryServicePalette |
| mscae | `mscaeSecurity Service` | CAE / Security Service | 3 | addMSCAESecurityServicePalette |
| mscae | `mscaeStorage Service` | CAE / Storage Service | 18 | addMSCAEStorageServicePalette |
| mscae | `mscaeWeb Service` | CAE / Web Service | 10 | addMSCAEWebServicePalette |
| active_directory | `active_directory` | Active Directory | 69 | addActiveDirectoryPalette |
| bpmn2 | `bpmn2General` | BPMN 2.0 General | 39 | addBPMN2GeneralPalette |
| bpmn2 | `bpmn2Tasks` | BPMN 2.0 Tasks | 47 | addBPMN2TasksPalette |
| bpmn2 | `bpmn2Choreographies` | BPMN 2.0 Choreographies | 55 | addBPMN2ChoreographiesPalette |
| bpmn2 | `bpmn2Events` | BPMN 2.0 Events | 57 | addBPMN2EventsPalette |
| bpmn2 | `bpmn2Gateways` | BPMN 2.0 Gateways | 69 | addBPMN2GatewaysPalette |
| clipart | `computer` | Clipart / Computer | 37 | initPalettes (addImagePalette) |
| clipart | `finance` | Clipart / Finance | 12 | initPalettes (addImagePalette) |
| clipart | `clipart` | Clipart / Various | 17 | initPalettes (addImagePalette) |
| clipart | `networking` | Clipart / Networking | 28 | initPalettes (addImagePalette) |
| clipart | `people` | Clipart / People | 56 | initPalettes (addImagePalette) |
| clipart | `telco` | Clipart / Telecommunication | 7 | initPalettes (addImagePalette) |
| ibm | `ibmAnalytics` | IBM / Analytics | 5 | addIBMAnalyticsPalette |
| ibm | `ibmApplications` | IBM / Applications | 20 | addIBMApplicationsPalette |
| ibm | `ibmBlockchain` | IBM / Blockchain | 22 | addIBMBlockchainPalette |
| ibm | `ibmData` | IBM / Data | 13 | addIBMDataPalette |
| ibm | `ibmDevOps` | IBM / DevOps | 10 | addIBMDevOpsPalette |
| ibm | `ibmInfrastructure` | IBM / Infrastructure | 18 | addIBMInfrastructurePalette |
| ibm | `ibmManagement` | IBM / Management | 15 | addIBMManagementPalette |
| ibm | `ibmMiscellaneous` | IBM / Miscellaneous | 14 | addIBMMiscPalette |
| ibm | `ibmSecurity` | IBM / Security | 14 | addIBMSecurityPalette |
| ibm | `ibmSocial` | IBM / Social | 5 | addIBMSocialPalette |
| ibm | `ibmUsers` | IBM / Users | 6 | addIBMUsersPalette |
| ibm | `ibmVPC` | IBM / VPC | 25 | addIBMVPCPalette |
| ibm | `ibmBoxes` | IBM / Boxes | 12 | addIBMBoxesPalette |
| ibm | `ibmConnectors` | IBM / Connectors | 9 | addIBMConnectorsPalette |
| ibm_cloud | `ibm_cloudGroups` | IBM / Groups | 39 | addIBMCloudGroupsPalette |
| ibm_cloud | `ibm_cloudActors` | IBM / Actors | 6 | addIBMCloudActorsPalette |
| ibm_cloud | `ibm_cloudAI` | IBM / AI | 12 | addIBMCloudAIPalette |
| ibm_cloud | `ibm_cloudCompute` | IBM / Compute | 8 | addIBMCloudComputePalette |
| ibm_cloud | `ibm_cloudContainers` | IBM / Containers | 4 | addIBMCloudContainersPalette |
| ibm_cloud | `ibm_cloudData` | IBM / Data | 15 | addIBMCloudDataPalette |
| ibm_cloud | `ibm_cloudDevOps` | IBM / DevOps | 8 | addIBMCloudDevOpsPalette |
| ibm_cloud | `ibm_cloudNetwork` | IBM / Network | 22 | addIBMCloudNetworkPalette |
| ibm_cloud | `ibm_cloudObservability` | IBM / Observability | 3 | addIBMCloudObservabilityPalette |
| ibm_cloud | `ibm_cloudSecurity` | IBM / Security | 10 | addIBMCloudSecurityPalette |
| ibm_cloud | `ibm_cloudStorage` | IBM / Storage | 2 | addIBMCloudStoragePalette |
| ibm_cloud | `ibm_cloudConnectors` | IBM / Connectors | 22 | addIBMCloudConnectorsPalette |
| allied_telesis | `allied_telesisBuildings` | Allied Telesis / Buildings | 7 | addAlliedTelesisBuildingsPalette |
| allied_telesis | `allied_telesisComputer and Terminals` | Allied Telesis / Computer and Terminals | 14 | addAlliedTelesisComputerTerminalsPalette |
| allied_telesis | `allied_telesisMedia Converters` | Allied Telesis / Media Converters | 5 | addAlliedTelesisMediaConvertersPalette |
| allied_telesis | `allied_telesisSecurity` | Allied Telesis / Security | 7 | addAlliedTelesisSecurityPalette |
| allied_telesis | `allied_telesisStorage` | Allied Telesis / Storage | 6 | addAlliedTelesisStoragePalette |
| allied_telesis | `allied_telesisSwitch` | Allied Telesis / Switch | 16 | addAlliedTelesisSwitchPalette |
| allied_telesis | `allied_telesisWireless` | Allied Telesis / Wireless | 3 | addAlliedTelesisWirelessPalette |
| cumulus | `cumulus` | Cumulus | 53 | addCumulusPalette |
| eip | `eipMessage Construction` | EIP / Message Construction | 9 | addEipMessageConstructionPalette |
| eip | `eipMessage Routing` | EIP / Message Routing | 11 | addEipMessageRoutingPalette |
| eip | `eipMessage Transformation` | EIP / Message Transformation | 5 | addEipMessageTransformationPalette |
| eip | `eipMessaging Channels` | EIP / Messaging Channels | 9 | addEipMessagingChannelsPalette |
| eip | `eipMessaging Endpoints` | EIP / Messaging Endpoints | 9 | addEipMessagingEndpointsPalette |
| eip | `eipMessaging Systems` | EIP / Messaging Systems | 11 | addEipMessagingSystemsPalette |
| eip | `eipSystem Management` | EIP / System Management | 7 | addEipSystemManagementPalette |
| mockups | `mockupButtons` | Mockup Buttons | 5 | addMockupButtonsPalette |
| mockups | `mockupContainers` | Mockup Containers | 11 | addMockupContainersPalette |
| mockups | `mockupForms` | Mockup Forms | 22 | addMockupFormsPalette |
| mockups | `mockupGraphics` | Mockup Graphics | 11 | addMockupGraphicsPalette |
| mockups | `mockupMarkup` | Mockup Markup | 6 | addMockupMarkupPalette |
| mockups | `mockupMisc` | Mockup Misc | 25 | addMockupMiscPalette |
| mockups | `mockupNavigation` | Mockup Navigation | 11 | addMockupNavigationPalette |
| mockups | `mockupText` | Mockup Text | 13 | addMockupTextPalette |
| salesforce | `salesforceComponents` | Salesforce / Components | 17 | addSalesforceComponentsPalette |
| salesforce | `salesforceProduct` | Salesforce / Product | 40 | addSalesforceProductPalette |
| salesforce | `salesforcePlatform` | Salesforce / Platform | 24 | addSalesforcePlatformPalette |
| salesforce | `salesforceIndustry` | Salesforce / Industry | 32 | addSalesforceIndustryPalette |
| signs | `signsAnimals` | Signs / Animals | 15 | addSignsPalette (stencil file) |
| signs | `signsFood` | Signs / Food | 10 | addSignsPalette (stencil file) |
| signs | `signsHealthcare` | Signs / Healthcare | 50 | addSignsPalette (stencil file) |
| signs | `signsNature` | Signs / Nature | 17 | addSignsPalette (stencil file) |
| signs | `signsPeople` | Signs / People | 19 | addSignsPalette (stencil file) |
| signs | `signsSafety` | Signs / Safety | 20 | addSignsPalette (stencil file) |
| signs | `signsScience` | Signs / Science | 6 | addSignsPalette (stencil file) |
| signs | `signsSports` | Signs / Sports | 80 | addSignsPalette (stencil file) |
| signs | `signsTech` | Signs / Tech | 28 | addSignsPalette (stencil file) |
| signs | `signsTransportation` | Signs / Transportation | 75 | addSignsPalette (stencil file) |
| signs | `signsTravel` | Signs / Travel | 49 | addSignsPalette (stencil file) |
| gcp2 | `gcp2Paths` | GCP / Paths | 6 | addGCP2PathsPalette |
| gcp2 | `gcp2Zones` | GCP / Zones | 14 | addGCP2ZonesPalette |
| gcp2 | `gcp2General Icons` | GCP / General Icons | 114 | addGCP2GeneralIconsPalette |
| gcp2 | `gcp2Service Cards` | GCP / Service Cards | 30 | addGCP2ServiceCardsPalette |
| gcp2 | `gcp2Compute` | GCP / Compute | 8 | addGCP2ComputePalette |
| gcp2 | `gcp2API Management` | GCP / API Management | 6 | addGCP2APIManagementPalette |
| gcp2 | `gcp2Security` | GCP / Security | 9 | addGCP2SecurityPalette |
| gcp2 | `gcp2Data Analytics` | GCP / Data Analytics | 11 | addGCP2DataAnalyticsPalette |
| gcp2 | `gcp2Data Transfer` | GCP / Data Transfer | 1 | addGCP2DataTransferPalette |
| gcp2 | `gcp2Cloud AI` | GCP / AI and Machine Learning | 10 | addGCP2CloudAIPalette |
| gcp2 | `gcp2Internet of Things` | GCP / Internet of Things | 1 | addGCP2InternetOfThingsPalette |
| gcp2 | `gcp2Databases` | GCP / Databases | 7 | addGCP2DatabasesPalette |
| gcp2 | `gcp2Storage` | GCP / Storage | 3 | addGCP2StoragePalette |
| gcp2 | `gcp2Management Tools` | GCP / Operations | 13 | addGCP2ManagementToolsPalette |
| gcp2 | `gcp2Networking` | GCP / Networking | 15 | addGCP2NetworkingPalette |
| gcp2 | `gcp2Developer Tools` | GCP / CI - CD | 12 | addGCP2DeveloperToolsPalette |
| gcp2 | `gcp2Expanded Product Cards` | GCP / Expanded Product Cards | 23 | addGCP2ExpandedProductCardsPalette |
| gcp2 | `gcp2User Device Cards` | GCP / User and Device Cards | 24 | addGCP2UserDeviceCardsPalette |
| gcp2 | `gcp2Product Cards` | GCP / Product Cards | 14 | addGCP2ProductCardsPalette |
| gcp2 | `gcp2Icons AI and Machine Learning` | GCP Icons / AI and Machine Learning | 29 | addGCP2IconsAIAndMachineLearningPalette |
| gcp2 | `gcp2Icons Compute` | GCP Icons / Compute | 11 | addGCP2IconsComputePalette |
| gcp2 | `gcp2Icons Data Analytics` | GCP Icons / Analytics | 16 | addGCP2IconsDataAnalyticsPalette |
| gcp2 | `gcp2Icons Operations` | GCP Icons / Operations | 17 | addGCP2IconsOperationsPalette |
| gcp2 | `gcp2Icons Networking` | GCP Icons / Networking | 19 | addGCP2IconsNetworkingPalette |
| gcp2 | `gcp2Icons CI CD` | GCP Icons / CI/CD | 15 | addGCP2IconsCICDPalette |
| gcp2 | `gcp2Icons Integration Services` | GCP Icons / Integration Services | 7 | addGCP2IconsIntegrationServicesPalette |
| gcp2 | `gcp2Icons API Management` | GCP Icons / API Management | 5 | addGCP2IconsAPIManagementPalette |
| gcp2 | `gcp2Icons Internet of Things` | GCP Icons / Internet of Things | 1 | addGCP2IconsInternetOfThingsPalette |
| gcp2 | `gcp2Icons Databases` | GCP Icons / Databases | 9 | addGCP2IconsDatabasesPalette |
| gcp2 | `gcp2Icons Storage` | GCP Icons / Storage | 4 | addGCP2IconsStoragePalette |
| gcp2 | `gcp2Icons Security` | GCP Icons / Security | 10 | addGCP2IconsSecurityPalette |
| gcp2 | `gcp2Icons Serverless` | GCP Icons / Serverless | 5 | addGCP2IconsServerlessPalette |
| gcp2 | `gcp2Icons Migration` | GCP Icons / Migration | 7 | addGCP2IconsMigrationPalette |
| gcp2 | `gcp2Icons Hybrid and Multi Cloud` | GCP Icons / Hybrid and Multi Cloud | 5 | addGCP2IconsHybridAndMultiCloudPalette |
| gcp2 | `gcp2Icons Open Source Icons` | GCP Icons / Open Source Icons | 4 | addGCP2IconsOpenSourceIconsPalette |
| gcp3 | `gcp3Categories` | GCP Categories | 26 | addGCP3CategoriesPalette |
| gcp3 | `gcp3Core Products` | GCP Core Products | 19 | addGCP3CoreProductsPalette |
| gcpicons | `gcpiconsAI and Machine Learning` | GCP Icons / AI and Machine Learning | 21 | addGCPIconsAIandMachineLearningPalette |
| gcpicons | `gcpiconsAPI Management` | GCP Icons / API Management | 6 | addGCPIconsAPIManagementPalette |
| gcpicons | `gcpiconsCompute` | GCP Icons / Compute | 8 | addGCPIconsComputePalette |
| gcpicons | `gcpiconsData Analytics` | GCP Icons / Data Analytics | 11 | addGCPIconsDataAnalyticsPalette |
| gcpicons | `gcpiconsDatabases` | GCP Icons / Databases | 6 | addGCPIconsDatabasesPalette |
| gcpicons | `gcpiconsDeveloper Tools` | GCP Icons / Developer Tools | 17 | addGCPIconsDeveloperToolsPalette |
| gcpicons | `gcpiconsExpanded Product Card Icons` | GCP Icons / Expanded Product Card Icons | 14 | addGCPIconsExpandedProductCardIconsPalette |
| gcpicons | `gcpiconsGeneric` | GCP Icons / Generic | 1 | addGCPIconsGenericPalette |
| gcpicons | `gcpiconsHybrid and Multi Cloud` | GCP Icons / Hybrid and Multi Cloud | 2 | addGCPIconsHybridAndMultiCloudPalette |
| gcpicons | `gcpiconsMigration` | GCP Icons / Migration | 1 | addGCPIconsMigrationPalette |
| gcpicons | `gcpiconsSecurity` | GCP Icons / Security | 8 | addGCPIconsSecurityPalette |
| gcpicons | `gcpiconsInternet of Things` | GCP Icons / Internet of Things | 1 | addGCPIconsInternetofThingsPalette |
| gcpicons | `gcpiconsManagement Tools` | GCP Icons / Management Tools | 15 | addGCPIconsManagementToolsPalette |
| gcpicons | `gcpiconsNetworking` | GCP Icons / Networking | 17 | addGCPIconsNetworkingPalette |
| gcpicons | `gcpiconsOpen Source Icons` | GCP Icons / Open Source Icons | 8 | addGCPIconsOpenSourceIconsPalette |
| gcpicons | `gcpiconsStorage` | GCP Icons / Storage | 3 | addGCPIconsStoragePalette |
| rack | `rackAPC` | Rack / APC | 3 | addRackPalette (stencil file) |
| rack | `rackCisco` | Rack / Cisco | 101 | addRackPalette (stencil file) |
| rack | `rackHP` | Rack / HP | 19 | addRackPalette (stencil file) |
| rack | `rackIBM` | Rack / IBM | 21 | addRackPalette (stencil file) |
| rack | `rackOracle` | Rack / Oracle | 37 | addRackPalette (stencil file) |
| rack | `rackGeneral` | Rack / General | 20 | addRackGeneralPalette |
| rack | `rackF5` | Rack / F5 | 25 | addRackF5Palette |
| rack | `rackDell` | Rack / Dell | 32 | addRackDellPalette |
| rack | `rackHPE Aruba Gateways Controllers` | Rack / HPE Aruba / Gateways and Controllers | 28 | addRackHPEArubaGatewaysControllersPalette |
| rack | `rackHPE Aruba Security` | Rack / HPE Aruba / Security | 7 | addRackHPEArubaSecurityPalette |
| rack | `rackHPE Aruba Switches` | Rack / HPE Aruba / Switches | 187 | addRackHPEArubaSwitchesPalette |
| electrical | `electricalLogicGates` | Electrical / Logic Gates | 27 | addElectricalPalette |
| electrical | `electricalResistors` | Electrical / Resistors | 21 | addElectricalPalette |
| electrical | `electricalCapacitors` | Electrical / Capacitors | 16 | addElectricalPalette |
| electrical | `electricalInductors` | Electrical / Inductors | 30 | addElectricalPalette |
| electrical | `electricalSwitchesRelays` | Electrical / Switches and Relays | 90 | addElectricalPalette |
| electrical | `electricalDiodes` | Electrical / Diodes | 13 | addElectricalPalette |
| electrical | `electricalSources` | Electrical / Sources | 23 | addElectricalPalette |
| electrical | `electricalTransistors` | Electrical / Transistors | 22 | addElectricalPalette |
| electrical | `electricalInstruments` | Electrical / Instruments | 5 | addElectricalPalette |
| electrical | `electricalMisc` | Electrical / Misc | 96 | addElectricalPalette |
| electrical | `electricalAudio` | Electrical / Audio | 9 | addElectricalPalette |
| electrical | `electricalPlcLadder` | Electrical / PLC Ladder | 6 | addElectricalPalette |
| electrical | `electricalOptical` | Electrical / Optical | 14 | addElectricalPalette |
| electrical | `electricalVacuumTubes` | Electrical / Vacuum Tubes | 7 | addElectricalPalette |
| electrical | `electricalWaveforms` | Electrical / Waveforms | 8 | addElectricalPalette |
| electrical | `electricalRotMech` | Electrical / Rotating Equipment & Mechanical Functions | 18 | addElectricalPalette |
| electrical | `electricalTransmission` | Electrical / Transmission Paths | 25 | addElectricalPalette |
| aws3 | `aws3Analytics` | AWS17 / Analytics | 22 | addAWS3AnalyticsPalette |
| aws3 | `aws3Application Services` | AWS17 / Application Services | 6 | addAWS3ApplicationServicesPalette |
| aws3 | `aws3Artificial Intelligence` | AWS17 / Artificial Intelligence | 4 | addAWS3ArtificialIntelligencePalette |
| aws3 | `aws3Business Productivity` | AWS17 / Business Productivity | 3 | addAWS3BusinessProductivityPalette |
| aws3 | `aws3Compute` | AWS17 / Compute | 42 | addAWS3ComputePalette |
| aws3 | `aws3Contact Center` | AWS17 / Contact Center | 1 | addAWS3ContactCenterPalette |
| aws3 | `aws3Database` | AWS17 / Database | 31 | addAWS3DatabasePalette |
| aws3 | `aws3Desktop and App Streaming` | AWS17 / Desktop and App Streaming | 2 | addAWS3DesktopAndAppStreamingPalette |
| aws3 | `aws3Developer Tools` | AWS17 / Developer Tools | 6 | addAWS3DeveloperToolsPalette |
| aws3 | `aws3Game Development` | AWS17 / Game Development | 1 | addAWS3GameDevelopmentPalette |
| aws3 | `aws3General` | AWS17 / General | 20 | addAWS3GeneralPalette |
| aws3 | `aws3Groups` | AWS17 / Groups | 11 | addAWS3GroupsPalette |
| aws3 | `aws3Internet of Things` | AWS17 / Internet of Things | 43 | addAWS3InternetOfThingsPalette |
| aws3 | `aws3Management Tools` | AWS17 / Management Tools | 37 | addAWS3ManagementToolsPalette |
| aws3 | `aws3Messaging` | AWS17 / Messaging | 10 | addAWS3MessagingPalette |
| aws3 | `aws3Migration` | AWS17 / Migration | 7 | addAWS3MigrationPalette |
| aws3 | `aws3Mobile Services` | AWS17 / Mobile Services | 6 | addAWS3MobileServicesPalette |
| aws3 | `aws3Networking and Content Delivery` | AWS17 / Network and Content Delivery | 24 | addAWS3NetworkAndContentDeliveryPalette |
| aws3 | `aws3On Demand Workforce` | AWS17 / On-Demand Workforce | 5 | addAWS3OnDemandWorkforcePalette |
| aws3 | `aws3SDKs` | AWS17 / SDK | 14 | addAWS3SDKPalette |
| aws3 | `aws3Security Identity and Compliance` | AWS17 / Security Identity and Compliance | 25 | addAWS3SecurityIdentityAndCompliancePalette |
| aws3 | `aws3Storage` | AWS17 / Storage | 18 | addAWS3StoragePalette |
| aws4b | `aws4bArrows` | AWS18 / Arrows | 9 | addAWS4bArrowsPalette |
| aws4b | `aws4bGeneral Resources` | AWS18 / General Resources | 19 | addAWS4bGeneralResourcesPalette |
| aws4b | `aws4bIllustrations` | AWS18 / Illustrations | 5 | addAWS4bIllustrationsPalette |
| aws4b | `aws4bGroups Light` | AWS18 / Groups (light) | 12 | addAWS4bGroupsLightPalette |
| aws4b | `aws4bGroups Dark` | AWS18 / Groups (dark) | 12 | addAWS4bGroupsDarkPalette |
| aws4b | `aws4bAnalytics` | AWS18 / Analytics | 22 | addAWS4bAnalyticsPalette |
| aws4b | `aws4bApplication Integration` | AWS18 / Application Integration | 10 | addAWS4bApplicationIntegrationPalette |
| aws4b | `aws4bAR VR` | AWS18 / AR & VR | 1 | addAWS4bARVRPalette |
| aws4b | `aws4bCost Management` | AWS18 / Cost Management | 4 | addAWS4bCostManagementPalette |
| aws4b | `aws4bBusiness Productivity` | AWS18 / Business Productivity | 1 | addAWS4bBusinessProductivityPalette |
| aws4b | `aws4bCompute` | AWS18 / Compute | 33 | addAWS4bComputePalette |
| aws4b | `aws4bCustomer Engagement` | AWS18 / Customer Engagement | 4 | addAWS4bCustomerEngagementPalette |
| aws4b | `aws4bDatabase` | AWS18 / Database | 32 | addAWS4bDatabasePalette |
| aws4b | `aws4bDesktop App Streaming` | AWS18 / Desktop & App Streaming | 1 | addAWS4bDesktopAppStreamingPalette |
| aws4b | `aws4bDeveloper Tools` | AWS18 / Developer Tools | 9 | addAWS4bDeveloperToolsPalette |
| aws4b | `aws4bGame Development` | AWS18 / Game Development | 1 | addAWS4bGameDevelopmentPalette |
| aws4b | `aws4bInternet of Things` | AWS18 / Internet of Things | 8 | addAWS4bInternetOfThingsPalette |
| aws4b | `aws4bIoT Things` | AWS18 / IoT Things | 17 | addAWS4bIOTThingsPalette |
| aws4b | `aws4bIoT Resources` | AWS18 / IoT Resources | 24 | addAWS4bIOTResourcesPalette |
| aws4b | `aws4bMachine Learning` | AWS18 / Machine Learning | 11 | addAWS4bMachineLearningPalette |
| aws4b | `aws4bManagement Tools` | AWS18 / Management Tools | 43 | addAWS4bManagementToolsPalette |
| aws4b | `aws4bMedia Services` | AWS18 / Media Services | 7 | addAWS4bMediaServicesPalette |
| aws4b | `aws4bMigration` | AWS18 / Migration | 7 | addAWS4bMigrationPalette |
| aws4b | `aws4bMobile Services` | AWS18 / Mobile Services | 5 | addAWS4bMobileServicesPalette |
| aws4b | `aws4bNetwork Content Delivery` | AWS18 / Network & Content Delivery | 23 | addAWS4bNetworkContentDeliveryPalette |
| aws4b | `aws4bSecurity Identity Compliance` | AWS18 / Security, Identity & Compliance | 27 | addAWS4bSecurityIdentityCompliancePalette |
| aws4b | `aws4bStorage` | AWS18 / Storage | 19 | addAWS4bStoragePalette |
| sap | `sapAnnotations` | SAP / Annotations and Interfaces | 8 | addSAPAnnotationsPalette |
| sap | `sapColored Connectors` | SAP / Connectors | 87 | addSAPColoredConnectorsPalette |
| sap | `sapFoundations` | SAP / Foundational | 47 | addSAPFoundationalPalette |
| sap | `sapIntegration Suite` | SAP / Integration Suite | 15 | addSAPIntegrationSuitePalette |
| sap | `sapApp Dev Automation` | SAP / App Dev Automation | 17 | addSAPAppDevAutomationPalette |
| sap | `sapData Analytics` | SAP / Data Analytics | 8 | addSAPDataAnalyticsPalette |
| sap | `sapAI` | SAP / AI | 12 | addSAPAIPalette |
| sap | `sapBTP SaaS` | SAP / BTP SaaS | 5 | addSAPBTPSaaSPalette |
| sap | `sapOther` | SAP / Other | 12 | addSAPOtherPalette |
| sap | `sapGeneric Icons` | SAP / Generic Icons | 126 | addSAPGenericIconsPalette |
| sap | `sapComponent Groups` | SAP / Essentials | 16 | addSAPEssentialsPalette |
| sap | `sapComponents` | SAP / Components | 10 | addSAPComponentsPalette |
| sap | `sapDefault Connectors` | SAP / Default Connectors | 13 | addSAPDefaultConnectorsPalette |
| sap | `sapArea Shapes` | SAP / Area Shapes | 44 | addSAPAreaShapesPalette |
| sap | `sapDefault Shapes` | SAP / Default Shapes | 20 | addSAPDefaultShapesPalette |
| sap | `sapNumbers` | SAP / Numbers | 21 | addSAPNumbersPalette |
| sap | `sapProducts` | SAP / Brand Names | 20 | addSAPProductsPalette |
| sap | `sapBuild Workzone` | SAP / Build Workzone | 7 | addSAPBuildWorkzonePalette |
| sap | `sapSemantic Accent` | SAP / Semantic Accent | 48 | addSAPSemanticAccentPalette |
| sap | `sapTexts` | SAP / Text Elements | 9 | addSAPTextElementsPalette |
| aws4 | `aws4Arrows` | AWS / Arrows | 9 | addAWS4ArrowsPalette |
| aws4 | `aws4General Resources` | AWS / General Resources | 56 | addAWS4GeneralResourcesPalette |
| aws4 | `aws4Illustrations` | AWS / Illustrations | 5 | addAWS4IllustrationsPalette |
| aws4 | `aws4Groups` | AWS / Groups | 20 | addAWS4GroupsPalette |
| aws4 | `aws4Analytics` | AWS / Analytics | 53 | addAWS4AnalyticsPalette |
| aws4 | `aws4Application Integration` | AWS / Application Integration | 28 | addAWS4ApplicationIntegrationPalette |
| aws4 | `aws4Cloud Financial Management` | AWS / Cloud Financial Management | 8 | addAWS4CloudFinancialManagementPalette |
| aws4 | `aws4Blockchain` | AWS / Blockchain | 3 | addAWS4BlockchainPalette |
| aws4 | `aws4Business Applications` | AWS / Business Applications | 17 | addAWS4BusinessApplicationsPalette |
| aws4 | `aws4Compute` | AWS / Compute | 130 | addAWS4ComputePalette |
| aws4 | `aws4Contact Center` | AWS / Customer Experience | 2 | addAWS4ContactCenterPalette |
| aws4 | `aws4Containers` | AWS / Containers | 20 | addAWS4ContainersPalette |
| aws4 | `aws4Customer Enablement` | AWS / Customer Enablement | 9 | addAWS4CustomerEnablementPalette |
| aws4 | `aws4Customer Engagement` | AWS / Customer Engagement | 4 | addAWS4CustomerEngagementPalette |
| aws4 | `aws4Database` | AWS / Databases | 54 | addAWS4DatabasePalette |
| aws4 | `aws4Developer Tools` | AWS / Developer Tools | 18 | addAWS4DeveloperToolsPalette |
| aws4 | `aws4End User Computing` | AWS / End User Computing | 5 | addAWS4EndUserComputingPalette |
| aws4 | `aws4Front End Web Mobile` | AWS / Front End Web Mobile | 10 | addAWS4FrontEndWebMobilePalette |
| aws4 | `aws4Games` | AWS / Games | 4 | addAWS4GamesPalette |
| aws4 | `aws4Internet of Things` | AWS / Internet of Things | 89 | addAWS4InternetOfThingsPalette |
| aws4 | `aws4Artificial Intelligence` | AWS / Artificial Intelligence | 52 | addAWS4ArtificialIntelligencePalette |
| aws4 | `aws4Management Governance` | AWS / Management Tools | 87 | addAWS4ManagementGovernancePalette |
| aws4 | `aws4Media Services` | AWS / Media Services | 23 | addAWS4MediaServicesPalette |
| aws4 | `aws4Migration Modernization` | AWS / Migration & Modernization | 27 | addAWS4MigrationModernizationPalette |
| aws4 | `aws4Network Content Delivery` | AWS / Network & Content Delivery | 68 | addAWS4NetworkContentDeliveryPalette |
| aws4 | `aws4Quantum Technologies` | AWS / Quantum Technologies | 15 | addAWS4QuantumTechnologiesPalette |
| aws4 | `aws4Satellite` | AWS / Satellite | 2 | addAWS4SatellitePalette |
| aws4 | `aws4Security Identity Compliance` | AWS / Security & Identity | 62 | addAWS4SecurityIdentityCompliancePalette |
| aws4 | `aws4Serverless` | AWS / Serverless | 1 | addAWS4ServerlessPalette |
| aws4 | `aws4Storage` | AWS / Storage | 88 | addAWS4StoragePalette |
| aws4r | `aws4r` | AWS (retired) | 76 | addAWS4RetiredPalette |
| pid | `pidAgitators` | Process Engineering / Agitators | 10 | addPidPalette (stencil file) |
| pid | `pidApparatus Elements` | Process Engineering / Apparatus Elements | 6 | addPidPalette (stencil file) |
| pid | `pidCentrifuges` | Process Engineering / Centrifuges | 8 | addPidPalette (stencil file) |
| pid | `pidCompressors ISO` | Process Engineering / Compressors ISO | 11 | addPidPalette (stencil file) |
| pid | `pidDriers` | Process Engineering / Driers | 8 | addPidPalette (stencil file) |
| pid | `pidFeeders` | Process Engineering / Feeders | 5 | addPidPalette (stencil file) |
| pid | `pidHeat Exchangers` | Process Engineering / Heat Exchangers | 23 | addPidPalette (stencil file) |
| pid | `pidMixers` | Process Engineering / Mixers | 4 | addPidPalette (stencil file) |
| pid | `pidPumps` | Process Engineering / Pumps | 18 | addPidPalette (stencil file) |
| pid | `pidPumps DIN` | Process Engineering / Pumps DIN | 10 | addPidPalette (stencil file) |
| pid | `pidPumps ISO` | Process Engineering / Pumps ISO | 9 | addPidPalette (stencil file) |
| pid | `pidShaping Machines` | Process Engineering / Shaping Machines | 7 | addPidPalette (stencil file) |
| pid | `pidVessels` | Process Engineering / Vessels | 63 | addPidPalette (stencil file) |
| pid | `pidInstruments` | Process Engineering / Instruments | 24 | addPidInstrumentsPalette |
| pid | `pidValves` | Process Engineering / Valves | 35 | addPidValvesPalette |
| pid | `pidCompressors` | Process Engineering / Compressors | 9 | addPidCompressorsPalette |
| pid | `pidEngines` | Process Engineering / Engines | 8 | addPidEnginesPalette |
| pid | `pidFilters` | Process Engineering / Filters | 16 | addPidFiltersPalette |
| pid | `pidFlow Sensors` | Process Engineering / Flow Sensors | 16 | addPidFlowSensorsPalette |
| pid | `pidPiping` | Process Engineering / Piping | 37 | addPidPipingPalette |
| pid | `pidCrushers Grinding` | Process Engineering / Crushers Grinding | 12 | addPidCrushersGrindingPalette |
| pid | `pidFittings` | Process Engineering / Fittings | 29 | addPidFittingsPalette |
| pid | `pidSeparators` | Process Engineering / Separators | 13 | addPidSeparatorsPalette |
| pid | `pidMisc` | Process Engineering / Misc | 84 | addPidMiscPalette |
| cisco | `ciscoBuildings` | Cisco / Buildings | 9 | addCiscoBuildingsPalette |
| cisco | `ciscoComputers and Peripherals` | Cisco / Computers and Peripherals | 20 | addCiscoComputersAndPeripheralsPalette |
| cisco | `ciscoControllers and Modules` | Cisco / Controllers and Modules | 8 | addCiscoControllersAndModulesPalette |
| cisco | `ciscoDirectors` | Cisco / Directors | 5 | addCiscoDirectorsPalette |
| cisco | `ciscoHubs and Gateways` | Cisco / Hubs and Gateways | 8 | addCiscoHubsAndGatewaysPalette |
| cisco | `ciscoMisc` | Cisco / Misc | 128 | addCiscoMiscPalette |
| cisco | `ciscoModems and Phones` | Cisco / Modems and Phones | 11 | addCiscoModemsAndPhonesPalette |
| cisco | `ciscoPeople` | Cisco / People | 8 | addCiscoPeoplePalette |
| cisco | `ciscoRouters` | Cisco / Routers | 23 | addCiscoRoutersPalette |
| cisco | `ciscoSecurity` | Cisco / Security | 10 | addCiscoSecurityPalette |
| cisco | `ciscoServers` | Cisco / Servers | 17 | addCiscoServersPalette |
| cisco | `ciscoStorage` | Cisco / Storage | 9 | addCiscoStoragePalette |
| cisco | `ciscoSwitches` | Cisco / Switches | 24 | addCiscoSwitchesPalette |
| cisco | `ciscoWireless` | Cisco / Wireless | 11 | addCiscoWirelessPalette |
| cisco_safe | `cisco_safeArchitecture` | Cisco Safe / Architecture | 71 | addCiscoSafeArchitecturePalette |
| cisco_safe | `cisco_safeBusiness Icons` | Cisco Safe / Business Icons | 30 | addCiscoSafeBusinessIconsPalette |
| cisco_safe | `cisco_safeCapability` | Cisco Safe / Capability | 88 | addCiscoSafeCapabilityPalette |
| cisco_safe | `cisco_safeDesign` | Cisco Safe / Design | 117 | addCiscoSafeDesignPalette |
| cisco_safe | `cisco_safeIoT Things Icons` | Cisco Safe / IoT Things Icons | 48 | addCiscoSafeIoTThingsIconsPalette |
| cisco_safe | `cisco_safePeople Places Things Icons` | Cisco Safe / People, Places, Things Icons | 11 | addCiscoSafePeoplePlacesThingsIconsPalette |
| cisco_safe | `cisco_safeSecurity Icons` | Cisco Safe / Security Icons | 72 | addCiscoSafeSecurityIconsPalette |
| cisco_safe | `cisco_safeTechnology Icons` | Cisco Safe / Technology Icons | 29 | addCiscoSafeTechnologyIconsPalette |
| cisco_safe | `cisco_safeThreat` | Cisco Safe / Threat | 40 | addCiscoSafeThreatPalette |
| office | `officeClouds` | Office / Clouds | 13 | addOfficeCloudsPalette |
| office | `officeCommunications` | Office / Communications | 70 | addOfficeCommunicationsPalette |
| office | `officeConcepts` | Office / Concepts | 140 | addOfficeConceptsPalette |
| office | `officeDatabases` | Office / Databases | 45 | addOfficeDatabasesPalette |
| office | `officeDevices` | Office / Devices | 50 | addOfficeDevicesPalette |
| office | `officeSecurity` | Office / Security | 52 | addOfficeSecurityPalette |
| office | `officeServers` | Office / Servers | 97 | addOfficeServersPalette |
| office | `officeServices` | Office / Services | 26 | addOfficeServicesPalette |
| office | `officeSites` | Office / Sites | 22 | addOfficeSitesPalette |
| office | `officeUsers` | Office / Users | 43 | addOfficeUsersPalette |
| openstack | `openstackBlue` | OpenStack / Blue | 18 | addOpenStackGenericPalette |
| openstack | `openstackGrey` | OpenStack / Grey | 18 | addOpenStackGenericPalette |
| openstack | `openstackGreen` | OpenStack / Green | 18 | addOpenStackGenericPalette |
| openstack | `openstackRed` | OpenStack / Red | 18 | addOpenStackGenericPalette |
| veeam | `veeamData Center` | Veeam / Data Center | 30 | addVeeamDataCenterPalette |
| veeam | `veeamMisc` | Veeam / Miscellaneous | 28 | addVeeamMiscPalette |
| veeam | `veeamSoftware` | Veeam / Software | 30 | addVeeamSoftwarePalette |
| veeam | `veeamStorage` | Veeam / Storage | 26 | addVeeamStoragePalette |
| veeam | `veeamUsersStatus` | Veeam / Users and Status | 21 | addVeeamUsersStatusPalette |
| veeam | `veeamVASComponents` | Veeam / Availability Suite components | 25 | addVeeamVASComponentsPalette |
| veeam | `veeamBackup Replication` | Veeam / Backup and Replication | 35 | addVeeamBackupReplicationPalette |
| veeam | `veeamProducts` | Veeam / Products | 14 | addVeeamProductsPalette |
| veeam | `veeamVMs and Tape` | Veeam / VMs and Tape | 22 | addVeeamVMsTapePalette |
| veeam | `veeam3D` | Veeam / 3D | 66 | addVeeam3DPalette |
| veeam2 | `veeam2Auxiliary` | Veeam / Auxiliary | 25 | addVeeam2AuxiliaryPalette |
| veeam2 | `veeam2Data Center` | Veeam / Data Center | 40 | addVeeam2DataCenterPalette |
| veeam2 | `veeam2Features` | Veeam / Features | 20 | addVeeam2FeaturesPalette |
| veeam2 | `veeam2General` | Veeam / General | 45 | addVeeam2GeneralPalette |
| veeam2 | `veeam2Products and Components` | Veeam / Products and Components | 55 | addVeeam2ProductsComponentsPalette |
| veeam2 | `veeam2Software` | Veeam / Software | 38 | addVeeam2SoftwarePalette |
| veeam2 | `veeam2States` | Veeam / States | 16 | addVeeam2StatesPalette |
| veeam2 | `veeam2Storage` | Veeam / Storage | 38 | addVeeam2StoragePalette |
| veeam2 | `veeam23D` | Veeam / 3D | 66 | addVeeam23DPalette |
| cabinets | `cabinets` | Cabinets | 67 | addCabinetsPalette |
| floorplan | `floorplan` | Floorplans | 81 | addFloorplanPalette |
| bootstrap | `bootstrap` | Bootstrap | 257 | addBootstrapPalette |
| atlassian | `atlassian` | Atlassian | 137 | addAtlassianPalette |
| atlassian2 | `atlassian2Apps` | Atlassian / Apps | 45 | addAtlassian2AppsPalette |
| atlassian2 | `atlassian2Work Types` | Atlassian / Work Types | 23 | addAtlassian2WorkTypesPalette |
| atlassian2 | `atlassian2Logos` | Atlassian / Logos | 42 | addAtlassian2LogosPalette |
| fluid_power | `fluid_power` | Fluid Power (ISO 1219) | 246 | addFluidPowerPalette |
| gmdl | `gmdlBottom Navigation` | GMDL / Bottom Navigation | 2 | addGMDLBottomNavigationPalette |
| gmdl | `gmdlBottom Sheets` | GMDL / Bottom Sheets | 7 | addGMDLBottomSheetsPalette |
| gmdl | `gmdlButtons` | GMDL / Buttons | 62 | addGMDLButtonsPalette |
| gmdl | `gmdlCards` | GMDL / Cards | 26 | addGMDLCardsPalette |
| gmdl | `gmdlChips` | GMDL / Chips | 4 | addGMDLChipsPalette |
| gmdl | `gmdlDialogs` | GMDL / Dialogs | 9 | addGMDLDialogsPalette |
| gmdl | `gmdlDividers` | GMDL / Dividers | 5 | addGMDLDividersPalette |
| gmdl | `gmdlGrid Lists` | GMDL / Grid Lists | 5 | addGMDLGridListsPalette |
| gmdl | `gmdlIcons` | GMDL / Icons | 29 | addGMDLIconsPalette |
| gmdl | `gmdlLists` | GMDL / Lists | 21 | addGMDLListsPalette |
| gmdl | `gmdlMenus` | GMDL / Menus | 12 | addGMDLMenusPalette |
| gmdl | `gmdlMisc` | GMDL / Misc | 4 | addGMDLMiscPalette |
| gmdl | `gmdlPickers` | GMDL / Pickers | 12 | addGMDLPickersPalette |
| gmdl | `gmdlSelection Controls` | GMDL / Selection Controls | 31 | addGMDLSelectionControlsPalette |
| gmdl | `gmdlSliders` | GMDL / Sliders | 28 | addGMDLSlidersPalette |
| gmdl | `gmdlSteppers` | GMDL / Steppers | 11 | addGMDLSteppersPalette |
| gmdl | `gmdlTabs` | GMDL / Tabs | 11 | addGMDLTabsPalette |
| gmdl | `gmdlText Fields` | GMDL / Text Fields | 27 | addGMDLTextFieldsPalette |
| archimate4 | `archimate4Common` | ArchiMate 4 / Common | 18 | addArchimate4CommonPalette |
| archimate4 | `archimate4Relationships and Junctions` | ArchiMate 4 / Relationships and Junctions | 17 | addArchimate4RelationshipsAndJunctionsPalette |
| archimate4 | `archimate4Motivation` | ArchiMate 4 / Motivation | 18 | addArchimate4MotivationPalette |
| archimate4 | `archimate4Strategy` | ArchiMate 4 / Strategy | 8 | addArchimate4StrategyPalette |
| archimate4 | `archimate4Business` | ArchiMate 4 / Business | 20 | addArchimate4BusinessPalette |
| archimate4 | `archimate4Application` | ArchiMate 4 / Application | 16 | addArchimate4ApplicationPalette |
| archimate4 | `archimate4Technology` | ArchiMate 4 / Technology | 32 | addArchimate4TechnologyPalette |
| archimate4 | `archimate4Implementation and Migration` | ArchiMate 4 / Implementation and Migration | 6 | addArchimate4ImplementationAndMigrationPalette |
| archimate3 | `archimate3Generic` | Archimate 3.2 / Generic | 23 | addArchimate3GenericPalette |
| archimate3 | `archimate3Application` | Archimate 3.2 / Application | 18 | addArchimate3ApplicationPalette |
| archimate3 | `archimate3Business` | Archimate 3.2 / Business | 26 | addArchimate3BusinessPalette |
| archimate3 | `archimate3Implementation and Migration` | Archimate 3.2 / Implementation and Migration | 10 | addArchimate3ImplementationAndMigrationPalette |
| archimate3 | `archimate3Motivation` | Archimate 3.2 / Motivation | 20 | addArchimate3MotivationPalette |
| archimate3 | `archimate3Relationships` | Archimate 3.2 / Relationships | 16 | addArchimate3RelationshipsPalette |
| archimate3 | `archimate3Strategy` | Archimate 3.2 / Strategy | 8 | addArchimate3StrategyPalette |
| archimate3 | `archimate3Technology` | Archimate 3.2 / Technology | 34 | addArchimate3TechnologyPalette |
| archimate | `archimate` | ArchiMate 2.1 | 60 | addArchiMatePalette |
| webicons | `webicons` | Web Icons | 175 | addWebIconsPalette |
| webicons | `weblogos` | Web Logos | 191 | addWebLogosPalette |
| sysml | `sysmlModel Elements` | SysML / Model Elements | 22 | addSysMLModelElementsPalette |
| sysml | `sysmlBlocks` | SysML / Blocks | 60 | addSysMLBlocksPalette |
| sysml | `sysmlPorts and Flows` | SysML / Ports and Flows | 23 | addSysMLPortsAndFlowsPalette |
| sysml | `sysmlConstraint Blocks` | SysML / Constraint Blocks | 4 | addSysMLConstraintBlocksPalette |
| sysml | `sysmlActivities` | SysML / Activities | 51 | addSysMLActivitiesPalette |
| sysml | `sysmlInteractions` | SysML / Interactions | 15 | addSysMLInteractionsPalette |
| sysml | `sysmlState Machines` | SysML / State Machines | 21 | addSysMLStateMachinesPalette |
| sysml | `sysmlUse Cases` | SysML / UseCases | 10 | addSysMLUseCasesPalette |
| sysml | `sysmlAllocations` | SysML / Allocations | 7 | addSysMLAllocationsPalette |
| sysml | `sysmlRequirements` | SysML / Requirements | 21 | addSysMLRequirementsPalette |
| sysml | `sysmlProfiles` | SysML / Profiles | 9 | addSysMLProfilesPalette |
| sysml | `sysmlStereotypes` | SysML / Stereotypes | 6 | addSysMLStereotypesPalette |

### Registered shape types (`shape=` style values backed by code)

`mxCellRenderer.registerShape(name, ctor)`. Names that use `X.prototype.cst.*`, `mxIOS7C.*` or `mxMockupC.*` constants were resolved from the same files. There are 830 unique names in total. `hexagon` is registered by core and overridden by `Shapes.js`; `mxgraph.ios.rrect` is registered twice. `js/grapheditor/Graph.js` and `js/diagramly/*.js` register none.

| File | # | Registered shape names (style `shape=` value) |
|---|---|---|
| `mxgraph/src/view/mxCellRenderer.js` (core defaults) | 16 | rectangle, ellipse, doubleEllipse, rhombus, line, image, arrow, arrowConnector, label, cylinder, swimlane, connector, actor, cloud, triangle, hexagon |
| `js/grapheditor/Shapes.js` | 99 | tableLine, table, tableRow, cube, isoRectangle, wire, waypoint, isoCube, datastore, note, note2, isoCube2, cylinder2, cylinder3, switch, folder, umlState, smileyFace, card, tape, document, parallelogram, trapezoid, curlyBracket, parallelMarker, process, process2, transparent, callout, wedgeCallout, step, hexagon, plus, ext, message, umlActor, umlBoundary, umlEntity, umlDestroy, umlControl, seqBoundary, seqControl, seqEntity, seqQueue, seqCollections, seqDatabase, seqActorStick, umlLifeline, umlFrame, lollipop, requires, requiredInterface, providedRequiredInterface, module, component, associativeEntity, endState, startState, link, flexArrow, manualInput, internalStorage, corner, crossbar, tee, singleArrow, doubleArrow, dataStorage, or, xor, loopLimit, offPageConnector, tapeData, orEllipse, sumEllipse, sortShape, collate, dimension, partialRectangle, lineEllipse, delay, cross, display, mxgraph.basic.rect, filledEdge, taperedArrow, pipe, zigzag, curvedText, gitTag, gitMergeCommit, gitCherryPick, mindmapBang, ishikawaHead, mermaidOdd, mermaidPerson, mermaidUsecaseActor, mermaidBlockArrow, mermaidSankeyLink |
| `shapes/bpmn/mxBpmnShape2.js` | 11 | `mxgraph.bpmn.`{shape, sendMarker, event, gateway2, task, task2, data, data2, swimlane, conversation, conversation2} |
| `shapes/emoji/mxEmoji.js` | 1 | mxgraph.emoji |
| `shapes/er/mxER.js` | 12 | `mxgraph.er.`{entity, entityExt, attribute, has, cloud, hierarchy, note, chens, bachmans, ie, rrect, anchor} |
| `shapes/ios7/mxIOS7Ui.js` | 22 | `mxgraph.ios7ui.`{appBar, onOffButton, slider, downloadBar, icon, horButtonBar, pageControl, iconGrid, phone, searchBox, url, actionDialog, anchor, rrect, leftButton, rightButton, topButton, bottomButton, horLines, marginRect, callout, selectBar} |
| `shapes/mockup/mxMockupButtons.js` | 11 | `mxgraph.`{mockup.buttons.multiButton, mockup.buttons.button, mockup.buttons.horButtonBar, mockup.buttons.verButtonBar, mockup.buttons.onOffButton, ios.rrect, mockup.anchor, mockup.topButton, mockup.bottomButton, mockup.rightButton, mockup.leftButton} |
| `shapes/mockup/mxMockupContainers.js` | 16 | `mxgraph.mockup.containers.`{videoPlayer, accordion, browserWindow, userMale, userFemale, group, window, horTabBar, verTabBar, alertBox, rrect, anchor, topButton, leftButton, marginRect, marginRect2} |
| `shapes/mockup/mxMockupForms.js` | 19 | `mxgraph.mockup.forms.`{checkboxGroup, radioGroup, colorPicker, comboBox, spinner, menuBar, horSlider, listBox, pwField, splitter, wedgeBar, searchBox, signIn, calendar, emailForm, rrect, anchor, checkbox, uRect} |
| `shapes/mockup/mxMockupGraphics.js` | 12 | `mxgraph.mockup.graphics.`{barChart, columnChart, lineChart, pieChart, iconGrid, bubbleChart, gauge, plotChart, ganttChart, simpleIcon, anchor, rrect} |
| `shapes/mockup/mxMockupMarkup.js` | 4 | `mxgraph.mockup.markup.`{curlyBrace, line, scratchOut, redX} |
| `shapes/mockup/mxMockupMisc.js` | 20 | `mxgraph.mockup.misc.`{playbackControls, progressBar, shoppingCart, rating, mail2, volumeSlider, editIcon, printIcon, shareIcon, trashcanIcon, copyrightIcon, registeredIcon, volumeIcon, ruler, ruler2, revisionTable, statusBar, pin, rrect, anchor} |
| `shapes/mockup/mxMockupNavigation.js` | 8 | `mxgraph.mockup.navigation.`{breadcrumb, stepBar, coverFlow, scrollBar, pagination, pageControl, mapNavigator, anchor} |
| `shapes/mockup/mxMockupText.js` | 10 | `mxgraph.mockup.text.`{link, linkBar, callout, stickyNote, stickyNote2, bulletedList, textBox, captcha, alphanumeric, rrect} |
| `shapes/mockup/mxMockupiOS.js` | 58 | `mxgraph.ios.`{iPhone, iBgFlat, iBgStriped, iBgMap, iButtonBar, iAppBar, iTopBar, iTopBar2, iTopBarLocked, iButton, iButtonBack, iButtonFw, iPrevNext, iTextInput, iRadioGroup, iCheckboxGroup, iComboBox, iOnOffButton, iAlertBox, iDialogBox, iLockButton, iArrowIcon, iDeleteIcon, iAddIcon, iInfoIcon, iSortFindIcon, iCheckIcon, iKeybLett, iKeybNumb, iKeybSymb, iDeleteApp, iDir, iLocBar, iCallDialog, iCallButtons, iOption, iAlphaList, iHorButtonBar, iPin, iVideoControls, iURLBar, iSlider, iProgressBar, iCloudProgressBar, iDownloadBar, iScreenNameBar, iIconGrid, iCopy, iCopyArea, iHomePageControl, iPageControl, iPad, rrect, topButton, bottomButton, anchor, checkbox, fancyRRect} |
| `shapes/mxAWS3D.js` | 57 | `mxgraph.aws3d.`{arrowNE, arrowSE, arrowSW, arrowNW, arrowlessNE, dashedEdgeDouble, dashedEdgeDouble2, dashedArrowlessEdge, dashedArrowlessEdge2, dashedEdge, dashedEdge2, flatEdge, flatEdge2, flatDoubleEdge, flatDoubleEdge2, ami, snapshot, application, application_server, cloudfront, dataCenter, dataServer, elasticLoadBalancing, instance, internetGateway, oracleDataCenter, oracleDbServer, rdsMaster, rds, route53, s3Bucket, s3, simpleDb, sqs, vpcGateway, webServer, dynamoDb, elasticMapReduce, rdsSlave, ami2, ebs, oracleServer, secureConnection, email_service, worker, application2, elasticBeanstalk, simpleDb2, workflowService, decider, searchEngine, securityTokenService, glacier, customerGateway, redshift, lambda, ebs2} |
| `shapes/mxAWS4.js` | 5 | `mxgraph.aws4.`{productIcon, resourceIcon, group, groupCenter, group2} |
| `shapes/mxAndroid.js` | 19 | `mxgraph.android.`{tabBar, phone, statusBar, checkboxGroup, radioGroup, menuBar, textSelHandles, indeterminateSpinner, anchor, rrect, checkbox, progressBar, progressScrubberDisabled, progressScrubberFocused, progressScrubberPressed, quickscroll2, quickscroll3, scrollbars2, spinner2} |
| `shapes/mxArchiMate.js` | 9 | `mxgraph.archimate.`{location, business, businessObject, representation, product, application, tech, motiv, gap} |
| `shapes/mxArchiMate3.js` | 51 | `mxgraph.archimate3.`{application, component, collaboration, interface, contractSmall, representationSmall, passive, plateau, productSmall, process, driver, assess, goal, outcome, principle, facility, function, grouping, interaction, material, locationIcon, service, requirement, constraint, equipment, event, event2, actor, role, businessObject, contract, product, representation, deliverable, location, gap, gapIcon, tech, distribution, resource, capability, course, node, network, device, sysSw, artifact, commNetw, path, valueStream, workPackage} |
| `shapes/mxArchiMate4.js` | 36 | `mxgraph.archimate4.`{element, role, collaboration, path, service, process, function, event, grouping, locationIcon, driver, assess, goal, outcome, principle, requirement, resource, capability, valueStream, course, actor, interface, businessObject, product, component, node, device, sysSw, network, equipment, facility, distribution, material, workPackage, deliverable, plateau} |
| `shapes/mxArrows.js` | 21 | `mxgraph.arrows2.`{arrow, twoWayArrow, stylisedArrow, sharpArrow, sharpArrow2, calloutArrow, bendArrow, bendDoubleArrow, calloutDoubleArrow, calloutQuadArrow, calloutDouble90Arrow, quadArrow, triadArrow, tailedArrow, tailedNotchedArrow, stripedArrow, jumpInArrow, uTurnArrow, wedgeArrow, wedgeArrowDashed, wedgeArrowDashed2} |
| `shapes/mxAtlassian.js` | 1 | mxgraph.atlassian.issue |
| `shapes/mxAtlassian2.js` | 1 | mxgraph.atlassian2.icon |
| `shapes/mxBasic.js` | 33 | `mxgraph.basic.`{cross2, rectCallout, roundRectCallout, wave2, octagon2, isocube, acute_triangle, obtuse_triangle, drop, cone2, pyramid, 4_point_star_2, diag_snip_rect, diag_round_rect, corner_round_rect, plaque, frame, plaque_frame, rounded_frame, frame_corner, diag_stripe, donut, layered_rect, button, shaded_button, pie, arc, partConcEllipse, numberedEntryVert, bendingArch, three_corner_round_rect, polygon, patternFillRect} |
| `shapes/mxBootstrap.js` | 22 | `mxgraph.bootstrap.`{rrect, topButton, bottomButton, rightButton, leftButton, leftButtonStriped, roundedButton, arrow, tabTop, image, checkbox, checkbox2, radioButton, radioButton2, horLines, user2, rating, anchor, rangeInput, switch, x, popover} |
| `shapes/mxC4.js` | 5 | `mxgraph.c4.`{person, person2, webBrowserContainer, webBrowserContainer2, mobileDeviceContainer} |
| `shapes/mxCabinets.js` | 4 | `mxgraph.cabinets.`{cabinet, coverPlate, dimension, dimensionBottom} |
| `shapes/mxCisco19.js` | 1 | mxgraph.cisco19.rect |
| `shapes/mxCiscoSafe.js` | 1 | mxgraph.cisco_safe.compositeIcon |
| `shapes/mxDFD.js` | 6 | `mxgraph.dfd.`{start, archive, check2, dataStoreID, externalEntity, loop} |
| `shapes/mxEip.js` | 7 | `mxgraph.eip.`{messExp, retAddr, anchor, messageChannel, dataChannel, deadLetterChannel, invalidMessageChannel} |
| `shapes/mxElectrical.js` | 54 | `mxgraph.electrical.`{transmission.testPoint, transmission.straightBus, transmission.twoLineBusElbow, transmission.threeLineBusElbow, transmission.fourLineBusElbow, transmission.eightLineBusElbow, logic_gates.logic_gate, logic_gates.buffer2, logic_gates.dual_inline_ic, logic_gates.qfp_ic, abstract.mux2, miscellaneous.batteryStack, signal_sources.dc_source_3_v2, signal_sources.source, electro-mechanical.twoWaySwitch, electro-mechanical.pushbutton, electro-mechanical.singleSwitch, electro-mechanical.switchDisconnector, electro-mechanical.fuse2, electro-mechanical.liquidLevelActuatedSwitch, electro-mechanical.liquidLevelActuatedSwitch2, electro-mechanical.gasFlowActuatedSwitch, electro-mechanical.flowActuatedSwitch, electro-mechanical.pressureActuatedSwitch, electro-mechanical.temperatureActuatedSwitch, electro-mechanical.safetyInterlockSwitch, electro-mechanical.temperatureSwitch, electro-mechanical.thermostat2, electro-mechanical.limitSwitch2, electro-mechanical.circuitBreaker2, electro-mechanical.selectorSwitch3Position2, electro-mechanical.selectorSwitch4Position2, electro-mechanical.selectorSwitch6Position2, electro-mechanical.shortingSelectorSwitch2, electro-mechanical.proximityLimitSwitch2, electro-mechanical.inertiaSwitch2, electro-mechanical.pushbuttonBreak2, electro-mechanical.manualSwitch2, electro-mechanical.twoWayContact2, electro-mechanical.passingMakeContact2, electro-mechanical.dpst2, electro-mechanical.springReturn3, electro-mechanical.limitSwitch, electro-mechanical.dpdt3, electro-mechanical.twoPositionSwitch2, electro-mechanical.threePositionSwitch2, electro-mechanical.fourPositionSwitch2, electro-mechanical.pushbuttonMakeSwitch2, electro-mechanical.pushbuttonTwoCircuitSwitch2, electro-mechanical.timeDelaySwitch, electro-mechanical.timeDelaySwitch2, electro-mechanical.isolatorSwitch2, electro-mechanical.changeoverContactSwitch2, electro-mechanical.reedSwitch2} |
| `shapes/mxFloorplan.js` | 28 | `mxgraph.floorplan.`{wall, wallCorner, wallU, room, window, dimension, dimensionBottom, stairs, stairsRest, doorLeft, doorRight, doorDouble, doorUneven, doorOpposing, doorRevolving, doorPocket, doorDoublePocket, doorBypass, doorBifold, doorSlidingGlass, doorOverhead, opening, windowGlider, windowGarden, windowBow, windowBay, doorAccordion, doorDoubleAction} |
| `shapes/mxFlowchart.js` | 1 | mxgraph.flowchart.document2 |
| `shapes/mxGCP2.js` | 2 | `mxgraph.gcp2.`{doubleRect, hexIcon} |
| `shapes/mxGmdl.js` | 11 | `mxgraph.gmdl.`{player, switch, marginRect, sliderNormal, slider2, sliderFocused, sliderDisabled, sliderDisabled2, sliderDiscrete, sliderDiscreteDots, progressBar} |
| `shapes/mxIBM.js` | 1 | mxgraph.ibm.box |
| `shapes/mxInfographic.js` | 22 | `mxgraph.infographic.`{numberedEntryVert, bendingArch, parallelogram, ribbonRolled, ribbonDoubleFolded, ribbonFrontFolded, ribbonBackFolded, banner, circularCallout, shadedTriangle, shadedPyramid, pyramidStep, cylinder, circularCallout2, bannerSingleFold, shadedCube, partConcEllipse, bannerHalfFold, circularDial, ribbonSimple, barCallout, flag} |
| `shapes/mxKubernetes.js` | 2 | `mxgraph.kubernetes.`{icon, icon2} |
| `shapes/mxLeanMap.js` | 29 | `mxgraph.lean_mapping.`{boat_shipment, buffer_or_safety_stock, data_box, outside_sources, manufacturing_process, manufacturing_process_shared, work_cell, inventory_box, push_arrow, supermarket, physical_pull, fifo_lane, truck_shipment, schedule, fifo_sequence_flow, production_kanban, withdrawal_kanban, signal_kanban, sequenced_pull_ball, rail_shipment, warehouse, timeline, crossDock, orders, batched_kanban, control_center, electronic_info_flow_edge, manual_info_flow_edge, timeline2} |
| `shapes/mxNetworks.js` | 2 | `mxgraph.networks.`{bus, comm_link_edge} |
| `shapes/mxNetworks2.js` | 1 | mxgraph.networks2.icon |
| `shapes/mxSAP.js` | 1 | mxgraph.sap.icon |
| `shapes/mxSysML.js` | 44 | `mxgraph.sysml.`{composite, package, package2, none, rect, port1, port2, port3, port4, itemFlow, itemFlowLeft, itemFlowRight, nestedPort, paramDgm, consProp, callBehAct, accEvent, timeEvent, sendSigAct, actFinal, actParamNode, contOper, flowFinal, isControl, isStream, isActStream, paramSet, paramActSet, probability, actProb, objFlowR, objFlowL, actPart, cont, coregion, dimension, compState, region, simpleState, stateMachine, x, submState, useCaseExtPt, port} |
| `shapes/mxUML25.js` | 4 | `mxgraph.uml25.`{inputPin, behaviorAction, action, actionParams} |
| `shapes/pid2/mxPidInstruments.js` | 6 | `mxgraph.pid2inst.`{discInst, sharedCont, compFunc, progLogCont, indicator, logic} |
| `shapes/pid2/mxPidMisc.js` | 3 | `mxgraph.pid2misc.`{fan, column, conveyor} |
| `shapes/pid2/mxPidValves.js` | 3 | `mxgraph.pid2valves.`{valve, blockBleedValve, autoRecircValve} |
| `shapes/rack/mxRack.js` | 20 | `mxgraph.rackGeneral.`{rackCabinet3, container, rackCabinet2, horCableDuct, horRoutingBank, neatPatch, shelf, plate, rackNumbering, rackCabinet, horCableDuct1U, horCableDuct2U, horRoutingBank1U, horRoutingBank2U, neatPatch2U, shelf1U, shelf2U, shelf4U, channelBase, cabinetLeg} |

Core shape classes (`mxgraph/src/shape/`): mxActor, mxArrow, mxArrowConnector, mxCloud, mxConnector, mxCylinder, mxDoubleEllipse, mxEllipse, mxHexagon, mxImageShape, mxLabel, mxLine, mxMarker, mxPolyline, mxRectangleShape, mxRhombus, mxShape (base), mxStencil, mxStencilRegistry, mxSwimlane, mxText, mxTriangle.

Lazy loading: `js/diagramly/Editor.js` fills `mxStencilRegistry.libraries[basename]` with the JS/XML files for each package (for example `bpmn`, `mockup/*`, `electrical/*`, `aws4`, `sap`, `emoji`). `js/grapheditor/Graph.js` `mxStencilRegistry.getStencil` loads unknown `mxgraph.<pkg>.*` names on demand (`dynamicLoading`, `allowEval` for JS shape files). `mxMarker.getPackageForType` loads the ER/SysML marker packages.

### Stencils

- Format (`mxgraph/src/shape/mxStencil.js` class doc): `<shapes name="mxgraph.pkg">` contains `<shape name w h aspect="variable|fixed" strokewidth="n|inherit">`.
  - `<connections>`: `<constraint x y perimeter="0|1" name>` defines fixed connection points.
  - `<background>`: a single path, rect, roundrect or ellipse; it defines the shadow and fill outline.
  - `<foreground>`: drawing ops.
  - State: `save`/`restore`, `strokecolor`/`fillcolor`/`fontcolor`, `alpha`/`fillalpha`/`strokealpha`, `strokewidth` (`fixed`), `dashed`/`dashpattern`, `linejoin`/`linecap`/`miterlimit`, `fontsize`/`fontstyle`/`fontfamily`.
  - Paths: `move`/`line`/`quad`/`curve`/`arc`/`close`.
  - Shapes: `rect`/`roundrect`/`ellipse`, then `fill`/`stroke`/`fillstroke`.
  - Other: `text` (`str`, `align`, `valign`, `localized`, `vertical`, `rotation`), `image` (`src`, `flipH`/`flipV`), `include-shape`.
- Bundle: `js/stencils.min.js` maps file name to a base64 string (`f['aws4.xml'] = '...'`). The payload is raw deflate of five streams (ops, x/y/number varints, string table). It is decoded into light `StencilNode` objects by `decode()` and served through an `mxStencilRegistry.loadStencil` override. Unknown files fall back to HTTP `stencils/<file>`. There are 204 bundled files with 9,090 `<shape>` definitions. These counts come from reading the bundle data; no draw.io code was run.
- Inline stencils: style `shape=stencil(<compressed XML>)` (`js/grapheditor/Graph.js` ~L22190). The Edit Shape dialog (`EditShapeDialog`, actions `editShape...` and `createShape` "Shape..."), freehand (`mxFreehand.js`) and Lucidchart import (`Extensions.js`) create them.
- SVG recolouring: image shapes with `editableCssRules` expose SVG CSS rules as colour controls (`Graph.js` ~L291, `Format.js` ~L6453). The GCP Icons set uses this.

Bundled stencil namespaces. The format is "namespace: XML files / `<shape>` count". There are 51 top-level namespaces.

| Namespace | Files / shapes | Namespace | Files / shapes | Namespace | Files / shapes |
|---|---|---|---|---|---|
| mxgraph.alibaba_cloud | 1 / 310 | mxgraph.cisco_safe | 9 / 485 | mxgraph.kubernetes2 | 1 / 39 |
| mxgraph.android | 1 / 49 | mxgraph.citrix | 1 / 97 | mxgraph.lean_mapping | 1 / 13 |
| mxgraph.arrows | 1 / 34 | mxgraph.citrix2 | 1 / 126 | mxgraph.mockup | 9 / 104 |
| mxgraph.atlassian | 1 / 26 | mxgraph.eip | 1 / 36 | mxgraph.mscae | 11 / 368 |
| mxgraph.atlassian2 | 1 / 109 | mxgraph.electrical | 24 / 529 | mxgraph.networks | 1 / 57 |
| mxgraph.aws | 11 / 99 | mxgraph.floorplan | 1 / 46 | mxgraph.networks2 | 1 / 115 |
| mxgraph.aws2 | 18 / 250 | mxgraph.flowchart | 1 / 36 | mxgraph.office | 10 / 449 |
| mxgraph.aws3 | 1 / 293 | mxgraph.fluid_power | 1 / 246 | mxgraph.openstack | 1 / 18 |
| mxgraph.aws3d | 1 / 16 | mxgraph.gcp | 10 / 66 | mxgraph.pid | 24 / 478 |
| mxgraph.aws4 | 1 / 1050 | mxgraph.gcp2 | 1 / 297 | mxgraph.rack | 11 / 487 |
| mxgraph.azure | 1 / 90 | mxgraph.gcp3 | 1 / 45 | mxgraph.salesforce | 1 / 96 |
| mxgraph.basic | 1 / 30 | mxgraph.gmdl | 1 / 104 | mxgraph.signs | 11 / 369 |
| mxgraph.bootstrap | 1 / 4 | mxgraph.ibm | 1 / 8 | mxgraph.sitemap | 1 / 50 |
| mxgraph.bpmn | 1 / 39 | mxgraph.ibm_cloud | 1 / 110 | mxgraph.veeam | 3 / 333 |
| mxgraph.cabinets | 1 / 53 | mxgraph.ios7 | 2 / 168 | mxgraph.veeam2 | 1 / 247 |
| mxgraph.cisco | 14 / 296 | mxgraph.kubernetes | 1 / 40 | mxgraph.vvd | 1 / 94 |
| mxgraph.cisco19 | 1 / 232 | | | mxgraph.webicons / weblogos | 1 / 176, 1 / 178 |

`mxgraph.sap` (`stencils/sap.xml`) is listed in `mxStencilRegistry.libraries['sap']` but is not in the bundle. SAP uses the `mxgraph.sap.icon` JS shape plus images. (Unconfirmed: whether `sap.xml` exists on the server.)

### Image libraries (file counts from `git ls-tree`)

| Directory | Files | Used by |
|---|---|---|
| `img/lib/azure2/<31 subdirs>` | 704 SVG | `azure2` |
| `img/lib/mscae` | 489 SVG | `mscae` |
| `img/lib/ibm/<12 subdirs>` | 188 | `ibm` |
| `img/lib/sap` | 165 | `sap` |
| `img/lib/clip_art/{computers,finance,general,networking,people,telecommunication}` | 164 PNG | `clipart` |
| `img/lib/active_directory` | 69 SVG | `active_directory` |
| `img/lib/allied_telesis/<7 subdirs>` | 59 | `allied_telesis` |
| `img/lib/dynamics365` | 33 SVG | `dynamics365` |
| `img/lib/cumulus` | 22 SVG | `cumulus` |
| `img/lib/atlassian` | 17 SVG | `atlassian` (legacy logos) |
| `img/{clipart,computers,finance,google-app,networking,people,telecommunication}` | 17/37/12/5/39/62/12 | Unconfirmed: legacy image dirs; the sidebar uses `img/lib/clip_art` |
| `stencils/clipart/Gear_128x128.png` | 1 | `Sidebar.prototype.gearImage` (grapheditor) |

JS shape files in `shapes/`: `bpmn/mxBpmnShape2.js`, `emoji/mxEmoji.js`, `er/mxER.js`, `ios7/mxIOS7Ui.js`, `mockup/` (9 files), `pid2/` (3 files), `rack/mxRack.js`, plus 32 `shapes/mx*.js` files. Shape names are in the registered-shape table above.

### Sidebar features

| Feature | Details | Source |
|---|---|---|
| Search box (omnibox) | Hint text "Type / to search". The options menu offers: Search Shapes (Enter); Search Shapes in Open Libraries (Shift+Enter); Search Images (only when an icon service is configured and online); Search Templates (`isTemplateSearchSupported`); Find in Diagram (opens the Find window); Generate (AI: `Editor.enableAi`, online, draw.io service, Mermaid supported); Help (online). Results show "More Results" paging and up to 4 library "chips" that open a matching built-in library | `js/grapheditor/Sidebar.js` `addSearchPalette` |
| Search index | Local tag index: `addEntry(tags, fn)` + `searchEntries`, with partial/compound-token matching and library tie-break weights (`librarySearchWeights`, which demotes aws3/aws4b/aws4r and similar). A compressed tag index (`Sidebar.prototype.tagIndex`) and `searchIndexData` cover stencils that are not preloaded. Closed libraries are searched (`searchClosedLibraries`). `enabledLibraries` filters the index | `js/grapheditor/Sidebar.js` `searchEntries`; `sidebar/Sidebar.js` `addTagIndex`, `addSearchIndex`, `addEntry` |
| Remote icon search | `ICON_SERVICE_PATH` (`api/icons`, grouped icon sets) or `ICONSEARCH_PATH` (`iconSearch2`), both on `DRAWIO_SERVER_URL`. "Install icon set" chips (`isIconSetInstalled`, `populateIconSearchSets`). Online only [web] | `js/diagramly/Init.js`; `sidebar/Sidebar.js` `getIconSearchUrl`, `parseIconSearchResponse` |
| Search Shapes toggle | Action `search` (label "Search Shapes"), toggle; persisted in `mxSettings.settings.search` | `js/diagramly/Menus.js` |
| More Shapes dialog | Action `shapes` ("More Shapes..."); footer button "+ More Shapes" in the sidebar. Expanded mode shows group headings with preview strip images (`images/sidebar-*.png`) and checkboxes. Compact mode (offline, non-Chrome-app) has no previews. Also offers "Labels" (sidebar titles) and "Remember this setting". Custom `config.libraries` sections are listed first | `js/diagramly/Dialogs.js` `MoreShapesDialog`; `js/grapheditor/Sidebar.js` `createMoreShapes` |
| Palette title interactions | Click expands or collapses; state persists (`mxSettings` `collapsedLibraries`, `wasPaletteExpanded`). Drag a title to reorder palettes (`installPaletteDragReorder`, `savePaletteOrder`/`applyPaletteOrder`). Right-click menu: Expand/Collapse, Collapse All, Expand All, Reset (palette order) | `sidebar/Sidebar.js` `installPaletteContextMenu`, `movePalette`, `resetPaletteOrder` |
| Hover preview | Tooltip with a larger render plus title after `tooltipDelay` 300 ms (not on iOS). Pinned/closable previews (used by the templates dialog) have zoom in/out/fit buttons, wheel/pinch zoom and drag-to-pan | `js/grapheditor/Sidebar.js` `createTooltip`, `showTooltip`, `setTooltipZoom` |
| Thumbnail options | `sidebarTitles` (labels under thumbs; config + settings), `sidebarTitleSize`, `thumbWidth`/`thumbHeight`, URL `sidebar-entries=large`. Lazy thumbnail rendering via IntersectionObserver (`deferPaletteInit`, `getThumbObserver`) | `js/grapheditor/Sidebar.js`; `js/diagramly/EditorUi.js` |
| Click / drag modifiers (named only; canvas behaviour covered elsewhere) | Click inserts at the centre of the view, with a pop animation when `Editor.insertAnimations` is on. Alt+click with one cell selected inserts and connects it (south by default; Shift = east, Ctrl/Cmd = north, Ctrl/Cmd+Shift = west). Alt+click with no single selection inserts at the free insert point. Shift+click replaces the selected shapes' style (`updateShapes`). Click an edge template to connect two selected vertices. Drag shows drop-and-connect blue arrows on a hovered shape, drop-on-shape style replace, edge split, drop into containers and drop as edge label. Alt disables the drop target; Shift disables style replace | `js/grapheditor/Sidebar.js` `itemClicked`, `createDragSource`, `dropAndConnect`, `isDropStyleEnabled`, `isEdgeLabelDrop` |
| Shape picker | Popup palette at a blue hover arrow, double-click on blank canvas, or action `showShapePicker` ("Shapes..."). Contents: a clone of the source cell, Rectangle, Ellipse, Rhombus, Rounded rectangle, Parallelogram, Trapezoid, Hexagon, Step, Process, Triangle, Document, Tape, Cloud, Single arrow, Waypoint, plus 4 edges (plain, bidirectional, flexArrow, segment) when edges are requested. Configurable via config `shapePicker` (`defaultShapePickerEntries`) | `js/grapheditor/EditorUi.js` `showShapePicker`, `createShapePicker`, `getCellsForShapePicker` |
| Custom libraries | File format `<mxlibrary>[JSON]</mxlibrary>`: an array of `{xml (compressed or plain mxGraphModel) \| data (image data URI), w, h, title, aspect}` (`createLibraryDataFromImages`, `addLibraryEntries`). Library title buttons: Close, Save (when modified), Edit (opens `LibraryDialog`: add images/selection, rename entries, resize), Add (adds the selection). Empty libraries show a "Drag elements here" drop zone. Library tooltips show the storage backend | `js/diagramly/EditorUi.js` `loadLibrary`, `libraryLoaded`, `showLibraryDialog`, `closeLibrary`; `js/diagramly/Dialogs.js` `LibraryDialog`; `App.js` `getLibraryStorageHint` |
| Library storage ids (`clibs` / settings `customLibraries`) | Prefix letters in `App.loadLibraries`: `L` browser (StorageLibrary; `L.scratchpad`), `U` URL (UrlLibrary), `R` remote/inline JSON (RemoteLibrary), `S` desktop file [desktop] (`loadDesktopLib`/DesktopLibrary), `G` Google Drive, `H` GitHub, `T` Trello, `D` Dropbox, `W` OneDrive. GitLab files use the id prefix `A` (`GitLabFile.getHash`) and have a `GitLabLibrary` class, but `loadLibraries` has no `A` branch. (Unconfirmed: GitLab libraries may not restore after reload.) Menus: New Library / Open Library from (backend submenus are covered in sections 1 and 9) | `js/diagramly/App.js` `restoreLibraries`, `loadLibraries`; `*Library.js` |
| Visio stencils as libraries | A `.vss`/`.vssx` loaded as a library converts through the VSDX importer (`asLibrary` → `raw.vss`/`raw.vssx`) | `js/diagramly/App.js` `loadTemplate` |
| Scratchpad | Action `scratchpad` (toggle; needs localStorage). Browser-stored library `.scratchpad`, with a Help button. In simple/sketch/min themes it also appears as a More Shapes entry | `js/diagramly/Menus.js`; `js/diagramly/EditorUi.js` `toggleScratchpad` |
| Sidebar as window | In min/sketch themes the shapes panel is a floating window (action `toggleShapes`, Ctrl+Shift+K; `WrapperWindow`; state persists via `mxSettings.getWindowState('shapes')`) | `js/diagramly/Menus.js` `toggleShapes`; `js/diagramly/EditorUi.js` ~L22633; `js/diagramly/Minimal.js` |
| URL parameters | `libs=<id;id>` (sets visible; overrides settings on draw.io), `clibs=<ids>` (custom libraries), `search-shapes=<terms>` (pre-runs a search), `sidebar=0` (no sidebar), `sidebar-entries=large`, `libraries=1` (enables custom libraries in embed mode). On the draw.io domain, `libs=aws3` from a referrer is rewritten to `aws4`. Dev only: `createindex=1`, `savesidebar=1` | `sidebar/Sidebar.js` `showEntries`; `App.js` ~L1081, `restoreLibraries`; `Minimal.js` ~L404; `EditorUi.js` ~L1035, ~L23691 |
| Embed / desktop differences | [embed] custom libraries (New Library / Open Library from) only when `libraries=1` and `Editor.enableCustomLibraries` is on. [desktop] libraries open from and save to local files (`DesktopLibrary`). Offline or non-Chrome-app shows the compact More Shapes dialog and no image search | `js/diagramly/Menus.js` ~L5804; `js/diagramly/EditorUi.js` ~L22569; `js/diagramly/ElectronApp.js` `loadDesktopLib` |

### Counts

Counts: libraries=505, more_shapes_entries=66, more_shapes_groups=5, registered_shape_types=830, stencil_namespaces=51, approx_total_shapes≈13,750. Other figures: 2 more More Shapes entries in simple/sketch/min themes; 73 configuration set ids; 204 bundled stencil files with 9,090 stencil shapes; 1,910 image-library files under `img/lib`.

How counted:
- libraries: 504 palette ids created by `initPalettes`, through its call graph from the last-loaded definitions, plus the `search` palette. Scratchpad and user libraries are excluded.
- more_shapes_entries: `{title, id}` entries in `updateEntries`: Standard 5, Software 14, Networking 30, Business 6, Other 11.
- registered_shape_types: unique names across `mxCellRenderer.js` core (16), `Shapes.js` (99) and `shapes/**/*.js` (717), minus 2 duplicates.
- stencil_namespaces: distinct `mxgraph.<x>` roots of `<shapes name>` across the 204 decoded bundle files.
- approx_total_shapes: sum of per-palette entry-call counts (whole-file stencil palettes use stencil `<shape>` counts). Libraries overlap, so this overstates the number of distinct shapes.

## 5. Edge styles, routing, perimeters, arrowheads, line patterns, jumps

### Edge routing styles (`edgeStyle`)

Registry: `mxgraph/src/view/mxStyleRegistry.js` (core 7), `js/grapheditor/Shapes.js` (`sequenceEdgeStyle` L4003, `isometricEdgeStyle` L10580). UI menu: `Menus.prototype.init` `'edgeStyle'` (`js/grapheditor/Menus.js`), same items in `StyleFormatPanel.prototype.addStroke` "Waypoints" picker (`js/grapheditor/Format.js` ~L7470) and the floating edge toolbar (`js/grapheditor/InlineToolbar.js` routing popover). Every menu item also clears `noEdgeStyle` and `libavoidRouting`. Hidden when `shape=arrow`.

| UI label (tooltip, icon-only item) | Style written | Function | Where offered |
|---|---|---|---|
| Straight | `edgeStyle` removed (none); keeps `curved` | none (straight polyline through waypoints) | Waypoints menu, toolbar, inline toolbar |
| Orthogonal | `edgeStyle=orthogonalEdgeStyle;curved=` | `mxEdgeStyle.OrthConnector` | same |
| Auto-route around shapes | `edgeStyle=orthogonalEdgeStyle;libavoidRouting=1` then `LibavoidRouting.autoReroute` | libavoid WASM router | same, only if `typeof LibavoidRouting !== 'undefined'` (extensions bundle) |
| Horizontal | `edgeStyle=elbowEdgeStyle;elbow=vertical` | `mxEdgeStyle.ElbowConnector` | same (note: label/elbow value pairing is as written in code) |
| Vertical | `edgeStyle=elbowEdgeStyle` (elbow default horizontal) | `ElbowConnector` | same |
| Isometric (2 variants) | `edgeStyle=isometricEdgeStyle` / `+elbow=vertical` | `mxEdgeStyle.IsometricConnector` | same |
| Curved | `edgeStyle=orthogonalEdgeStyle;curved=1` | OrthConnector rendered as curve | same, only if `Graph.edgeSupportsCurved(style)` |
| Entity Relation | `edgeStyle=entityRelationEdgeStyle` | `mxEdgeStyle.EntityRelation` (uses `segment`) | same |
| Sequence Diagram | `edgeStyle=sequenceEdgeStyle` + `Graph.makeSequenceMessages` | `mxEdgeStyle.SequenceMessage` | only when an edge touches a UML lifeline/activation (`Menus.addSequenceEdgeStyleItem`, `graph.isSequenceMessageCandidate`) |
| (no UI) | `edgeStyle=segmentEdgeStyle` | `mxEdgeStyle.SegmentConnector` | shape picker "segment" edge (`EditorUi.getCellsForShapePicker` L2837); Edit Style |
| (no UI) | `edgeStyle=loopEdgeStyle` / `loopStyle=` | `mxEdgeStyle.Loop` (default loop style, `mxGraph.defaultLoopStyle`) | Edit Style only |
| (no UI) | `sideToSideEdgeStyle`, `topToBottomEdgeStyle` | `SideToSide`, `TopToBottom` | Edit Style / imported files only |

- Default for new edges: `Graph.prototype.defaultEdgeStyle = {edgeStyle: orthogonalEdgeStyle, rounded: 0, jettySize: auto, orthogonalLoop: 1}`; `createCurrentEdgeStyle` carries `shape, curved, rounded, sketch keys, jumpStyle, jumpSize, libavoidRouting, elbow` and adds `curveGeometry=1` for curved (`js/grapheditor/Graph.js` ~L22683).
- Line style select (edges): Sharp / Rounded / Curved → `rounded`, `curved` (`Format.js` addStroke `styles = ['sharp','rounded','curved']`). Actions `rounded`, `toggleRounded`, `curved` (`Actions.js`).
- Edge handler type follows style: elbow handle (Elbow/SideToSide/TopToBottom/Loop), segment handles (Orthogonal/Segment), virtual bends on straight edges (`mxEdgeHandler.prototype.virtualBendsEnabled = true`, `Graph.js` L33681); self-loops get a segment handler that converts them to orthogonal waypoints (`Graph.prototype.createEdgeHandler` L23857). (`mxgraph/src/view/mxGraph.js` `createEdgeHandler`.)
- Default toolbar: `edgeShapeMenu` (Connection) and `edgeStyleMenu` (Waypoints) (`js/grapheditor/Toolbar.js` L54-57).

### Auto/obstacle routing (libavoid)

Source: `js/diagramly/LibavoidRouting.js`, core `js/libavoid-js/libavoid-routing.js` + `libavoid.min.js` (WASM).

| Feature | Detail |
|---|---|
| Live auto-routing | Style flag `libavoidRouting=1` (+ `orthogonalEdgeStyle`); re-routes on insert, reconnect, move/resize/rotate of terminals; vertices never move; one undo step with the move. `installAutoRouting` from diagramly `EditorUi.init` |
| One-shot | Arrange > Layout > Orthogonal Routing... (prompts Spacing = `shapeBufferDistance`, default 16) → `LibavoidRouting.run` |
| Opt-out | Manual waypoint edit clears the flag (`Format.js` addEdgeWaypoints, `mxEdgeHandler.changePoints`); inert inside `childLayout` containers |
| Routing inputs | `portConstraint`, `portConstraintRotation`, `source/targetPortConstraint`, rotation/direction/flip, fixed points, `snapToPoint` |
| Layout-spec name | `orthogonalEdge`; shorthand `libavoid` (`EditorUi.resolveLayoutList`) |
| Flags | `[flag:libavoid-independent]` per-edge independent solve |
| Gating | All UI gated on `typeof LibavoidRouting !== 'undefined'` (loaded via `js/extensions.min.js`) |

### Connection semantics (style keys)

Sources: `mxgraph/src/util/mxConstants.js`, `js/grapheditor/Graph.js` (`getAllConnectionConstraints` L23647, `addConnectionConstraint` L23758, outline-connect overrides L1355/L34534), `js/diagramly/Editor.js` property lists.

| Concept | Keys / behavior | UI |
|---|---|---|
| Floating connection | no `exitX/entryX`; endpoint projected on perimeter | drop on shape outline |
| Fixed connection | `exitX, exitY, exitDx, exitDy, exitPerimeter`, `entryX, entryY, entryDx, entryDy, entryPerimeter` | drop on connection point "x"; Shift while connecting keeps fixed point focus (`mxConstraintHandler.isKeepFocusEvent`); shortcuts.svg "Alt / Shift+Connect = Ignore shape / Connect to a fixed point" |
| Outline connect (connect to inner strokes) | vertex `outlineConnect` = 1 Default / 0 Delayed / 2 Always / 3 Never; also activates after 2 s hover; Alt+Shift disables | Property table "Outline Connect" |
| Connection points | Per-shape `getConstraints`/`constraints`, stencil `<connections>`, or `points=[[x,y,perimeter,dx,dy],...]` | View > Connection Points toggle (`connectionPoints`, Alt+Shift+O); Edit Connection Points dialog (`editConnectionPoints...`, Alt+Shift+Q, `ConnectionPointsDialog` in `js/diagramly/Dialogs.js` L20759: add/delete/dx/dy/grid/zoom/reset); context `addConnectionPoint`; Reset > Connection Points (`clearAnchors`, removes exit/entry X/Y) |
| Snap to point | `snapToPoint` (vertex/edge) | Property table |
| Port constraints | vertex `portConstraint` (none/N/E/S/W/N+S/E+W), `portConstraintRotation`; edge `sourcePortConstraint`, `targetPortConstraint` | Property table |
| Anchor direction | `anchorPointDirection`, `legacyAnchorPoints` | Property table (edge) |
| Perimeter spacing | vertex `perimeterSpacing` ("Perimeter" spinner, vertices); edge `sourcePerimeterSpacing`/`targetPerimeterSpacing` ("Spacing" start/end spinners) | Format Style tab (`Format.js` L7605-7660) |
| Fixed point spacing | `fixedPointSpacing` | Property table |
| Jetty | `jettySize` (auto), `sourceJettySize`, `targetJettySize` | "Jetty Size" (orthogonal only) |
| ER segment | `segment` | "Segment Size" (ER only) |
| Elbow | `elbow=horizontal\|vertical` | via Waypoints menu |
| Loops | `orthogonalLoop` ("Loop Routing"), `loopStyle`; self-loop side select N/E/S/W (Format Arrange > Direction, `ArrangePanel.addLoopDirection`) | Format |
| Orthogonal ends | `orthogonal` ("Orthogonal Ends" checkbox, hidden when routing already orthogonal) | Format Style tab |
| Follow terminals | `followTerminals` (waypoints move with terminals; hidden for libavoid edges) | Format Style tab checkbox |
| Disable routing | `noEdgeStyle=1` | Edit Style |
| Routing center | `routingCenterX/Y` | Edit Style only |
| Other edge props | `bendable`, `collapsedPoints`, `ignoreEdge`, `editable`, `movable`, `cloneable`, `deletable`, `arcSize`, `bezier` (curved only) | Property table (`Editor.commonEdgeProperties` L804) |
| New-edge default per shape | vertex `newEdgeStyle` JSON | `setAsDefaultForNewConnections` / `clearDefaultForNewConnections` (`Actions.js` L1763-1780) |

### Edge editing actions

Source `js/grapheditor/Actions.js`, `js/grapheditor/Format.js` `ArrangePanel`.

| Action id | Label (dia.txt) | Shortcut | Notes |
|---|---|---|---|
| `clearWaypoints` | Clear Waypoints | Alt+Shift+R | also Format Arrange "Reset" dropdown → Waypoints |
| `clearAnchors` | (Format label "Connection Points") | – | removes exit/entry X/Y |
| `addWaypoint` / `removeWaypoint` | Add Waypoint / Remove Waypoint | – | context menu |
| `addConnectionPoint` | Add Connection Point | – | context menu on vertex |
| `editConnectionPoints...` | Edit Connection Points | Alt+Shift+Q | `js/diagramly/Menus.js` L1011 |
| `turn` | Rotate Shape Only by 90° / Reverse | Ctrl+R (not Safari) | reverses edges, Shift = other direction |
| `rotateEdge` | (title from `turn`) | – | rotates fully unconnected edges 90° |
| `connectionArrows` | Connection Arrows | Alt+Shift+A | hover blue arrows toggle |
| `connectionPoints` | Connection Points | Alt+Shift+O | toggles `graph.setConnectable` |
| `curved` / `rounded` / `toggleRounded` | Curved / Rounded | – | |

Format edge-only sections: "Line Start / Line End" x/y inputs for dangling ends (`addEdgeGeometry`), "Waypoints" list with per-point Left/Top (`addEdgeWaypoints`), "Arrow" width for `link`/`flexArrow` (`width`) and start/end width for `taperedArrow` (`startWidth`, `endWidth`), "Direction" (turn/reverse + loop side).

### Edge labels

- Double-click on edge inserts an edge label (child vertex with relative geometry) at the click point (`Graph.prototype.insertTextForEvent` → `addText`, `Graph.js` L26412); multiple labels per edge allowed.
- Label handle on edge moves the label (geometry `x` along edge, `offset`).
- `curveGeometry=1` places labels along curved edges (`Graph.js` L9124, L21253); set automatically for new curved edges.
- Default edge label background: `labelBackgroundColor=default` (`styles/default.xml` `defaultEdge`).

### Line jumps

Source `js/grapheditor/Graph.js` (`Graph.lineJumpsEnabled = true`, `Graph.defaultJumpSize = 6`, `mxConnector.prototype.paintLine` / `paintCurveLineJumps` ~L21580-21990); UI `StyleFormatPanel.addLineJumps` (`Format.js` L7838), edges-only selection.

| Value (`jumpStyle`) | Label | Render |
|---|---|---|
| `none` | None | default |
| `arc` | Arc | semicircle hop |
| `gap` | Gap | line interrupted (fallthrough branch) |
| `sharp` | Sharp | triangular hop |
| `line` | Line | hop drawn as line segment |

Related: `jumpSize` ("Size" spinner, default 6); per-edge `noJump` ("No Jumps"), `jumpLayers` ("Jump Other Layers") in property table.

### Line patterns

Source `StyleFormatPanel.prototype.addStroke` pattern menu (`Format.js` ~L7330). Keys `dashed`, `dashPattern`; extra `fixDash` ("Fixed Dash") and `dashPattern` ("Dash Pattern") in property table.

| UI tooltip | `dashed` | `dashPattern` |
|---|---|---|
| Solid | – | – |
| Dashed (1) | 1 | default (`3 3`, `mxAbstractCanvas2D` L154) |
| Dashed (2) | 1 | `8 8` |
| Dashed (3) | 1 | `12 12` |
| Dashed (4) | 1 | `8 4 1 4` |
| Dotted (1) | 1 | `1 1` |
| Dotted (2) | 1 | `1 2` |
| Dotted (3) | 1 | `1 4` |
| Custom | 1 | prompt (default `8 4 1 4`) |

Other stroke keys: `strokeWidth` (0-999), `strokeColor`, `strokeOpacity`; `linecap` (Flat/Round/Square), `linejoin` (Miter/Arcs/Bevel/Miter-Clip/Round), `miterlimit` (property table, `Editor.commonProperties` L786).

### Arrowheads (markers)

Registration: `mxgraph/src/shape/mxMarker.js` (core), `js/grapheditor/Shapes.js` L7752-8006, `shapes/er/mxER.js` L1247-1357, `shapes/mxSysML.js`. Picker: `Format.addLineMarkerItems` (`Format.js` L114), used by Format "Line Start"/"Line End" menus and `InlineToolbar.js` line-endings popover. Picker items are icon-only (no text labels). Keys: `startArrow`/`endArrow`, `startFill`/`endFill`, `startSize`/`endSize` (default 6), plus property-table `startFillColor`, `startStrokeColor`, `endFillColor`, `endStrokeColor`. Picker also has "None" and "Copy" (copies the other end's marker+fill+size).

| Marker id | Source | In picker | Fill variants in picker |
|---|---|---|---|
| `classic` | core | yes | filled, open |
| `classicThin` | core | yes | filled, open |
| `block` | core | yes | filled, open |
| `blockThin` | core | yes | filled, open |
| `open` | core | yes | n/a (line) |
| `openThin` | core | yes | n/a |
| `oval` | core | yes | filled, open |
| `diamond` | core | yes | filled, open |
| `diamondThin` | core | yes | filled, open |
| `baseDash` | core | yes | – |
| `doubleBlock` | core | yes | filled, open |
| `manyOptional` | core | no | – (no non-minified caller found) |
| `async` | Shapes.js | yes | filled, open |
| `openAsync` | Shapes.js | yes | – |
| `box` | Shapes.js | yes | open |
| `halfCircle` | Shapes.js | yes | – |
| `dash` | Shapes.js | yes | – |
| `cross` | Shapes.js | yes | – |
| `circlePlus` | Shapes.js | yes | open |
| `circle` | Shapes.js | yes | filled at start, open at end (code: `(start) ? 1 : 0`) |
| `mermaidExtension` | Shapes.js | no | used by Mermaid import (`js/mermaid/drawio-mermaid.min.js`) |
| `mermaidDiamond` | Shapes.js | no | Mermaid import (unconfirmed: only registration seen) |
| `ERone` | mxER.js | yes | – |
| `ERmandOne` | mxER.js | yes | – |
| `ERmany` | mxER.js | yes | – |
| `ERoneToMany` | mxER.js | yes | – |
| `ERzeroToOne` | mxER.js | yes | – |
| `ERzeroToMany` | mxER.js | yes | – |
| `sysMLPackCont`, `sysMLReqInt`, `sysMLProvInt`, `sysMLx`, `sysMLLost`, `sysMLFound` | mxSysML.js | no | used by SysML sidebar templates |

- Picker list differs by edge shape: `connector`, `filledEdge`, `wire`, `pipe`, `mxgraph.basic.arc` (vertex), `taperedArrow` get the full list (34 entries); `flexArrow` gets only None and Block; `link` and `arrow` get no marker items.

### Edge shapes (`shape` on edges)

Menu `'edgeShape'` (`Menus.js` L107) = Format "Connection" picker (`Format.js` L7355). Changing shape resets `startSize, endSize, dashed, width, startWidth, endWidth, defaultFillColor, defaultGradientColor`.

| `shape` | UI label | Class | In Connection menu |
|---|---|---|---|
| (none) `connector` | Line | `mxConnector` (core) | yes |
| `link` | Link | `LinkShape` ext. `mxArrowConnector` (Shapes.js L4699) | yes |
| `flexArrow` | Arrow | `FlexArrowShape` (L4730), keys `width`, `startWidth`, `endWidth` | yes |
| `arrow` | Simple Arrow | `mxArrow` (core) | yes |
| `taperedArrow` | Tapered Arrow | `TaperedArrowShape` (L7554) | yes |
| `filledEdge` | Filled Edge | `FilledEdge` (L7016) | yes |
| `pipe` | Pipe | `PipeShape` (L7612) | yes |
| `wire` | Wire | `WireShape` (L1109), sets `dashed=1`, alternating colors | yes |
| `arrowConnector` | – | `mxArrowConnector` (core) | no |
| `mermaidSankeyLink` | – | `MermaidSankeyLinkShape` (L9253) | no (Mermaid Sankey import) |

Curved routing supported only for shapes in `Graph.edgeSupportsCurved` (connector, filledEdge, wire, pipe, link, flexArrow, taperedArrow).

### Flow animation

- `flowAnimation=1` checkbox "Flow Animation" (edges-only selection, `Format.js` L8026); property table `flowAnimationDuration` (500 ms), `flowAnimationTimingFunction` (linear/ease/ease-in/ease-out/ease-in-out), `flowAnimationDirection` (normal/reverse/alternate/alternate-reverse) (`Editor.commonEdgeProperties`). Rendering in `Graph.js` L21006.

### Perimeters

Registry: core `mxgraph/src/view/mxStyleRegistry.js` + `mxPerimeter.js`; extras `js/grapheditor/Shapes.js` L3785-4385, L8946. Key `perimeter`. Vertex property table "Perimeter" enum lists 14 values (`js/diagramly/Editor.js` L992). Defaults from `styles/default.xml` (`defaultVertex` rectangle, `ellipse`, `rhombus`, `triangle`, `roundImage`, `rhombusImage`).

| Value | Source | Used by (examples) | In property enum |
|---|---|---|---|
| `rectanglePerimeter` | core | default vertex | yes |
| `ellipsePerimeter` | core | ellipse, round image, tape data, or/sum ellipses | yes |
| `rhombusPerimeter` | core | rhombus, sort | yes |
| `trianglePerimeter` | core | triangle | yes |
| `hexagonPerimeter` | core | legacy hexagon | no |
| `hexagonPerimeter2` | Shapes.js | hexagon (label "Hexagon") | yes |
| `parallelogramPerimeter` | Shapes.js | parallelogram | yes |
| `trapezoidPerimeter` | Shapes.js | trapezoid | yes |
| `stepPerimeter` | Shapes.js | step | yes |
| `calloutPerimeter` | Shapes.js | callout | yes |
| `backbonePerimeter` | Shapes.js | network bus / line backbone | yes |
| `lifelinePerimeter` | Shapes.js | UML lifeline | yes |
| `orthogonalPerimeter` | Shapes.js | UML activation bar | yes |
| `centerPerimeter` | Shapes.js | waypoint shape | yes |
| `mermaidPersonPerimeter` | Shapes.js | Mermaid person | no |
| `none` | – | 248 sidebar uses (connect to bounds/center) | yes ("None") |
| (implicit) `Graph.roundedRectanglePerimeter` | Graph.js L29040 | rectangle when `rounded=1` and `roundedPerimeter=1` | via "Rounded Perimeter" property |

Counts: edge_styles=10 (9 registered functions + straight/none; 10 UI entries max in Waypoints menu, 3 registered styles have no UI), perimeters=15 registered (+1 implicit rounded-rectangle, + `none`), arrowheads=34 distinct marker ids (25 distinct ids / 34 entries in the picker), line_patterns=8 presets + custom, jump_styles=5 incl. none, edge_shapes=10 (8 in Connection menu). Counted from `mxStyleRegistry.putValue`, `mxMarker.addMarker`, `mxCellRenderer.registerShape` on `mxConnector`/`mxArrowConnector` subclasses, and the Format/Menus picker code.

## 6. Layouts

### Arrange > Layout menu (one-shot layouts)

Source: `js/diagramly/Menus.js` L1716 (`this.get('layout').funct`), placeholder in `js/grapheditor/Menus.js` L384; also toolbar layout button (`js/grapheditor/Toolbar.js` L72) and Insert > Layout submenu in sketch/min/simple themes (`js/diagramly/Menus.js` L4516-4590). Target: selected group with >1 child, else default parent. If the selection is a layout container (`EditorUi.getSelectedLayoutContainers`: any `childLayout` except table/stack/rack) the layout is written as its new `childLayout` instead of running once (`applyLayoutToSelectedContainers`). Runs are animated (morph) via `EditorUi.executeLayout`.

| Item (label) | Action/id | Algorithm/class | Options in UI | Tags |
|---|---|---|---|---|
| Run Last Layout | `runLastLayout` | replays `editorUi.lastLayoutSpec` via `executeLayoutSpec` | – (disabled until a layout ran) | Ctrl/Cmd+Alt+T |
| Vertical Flow... | ELK preset `verticalFlow` | ELK `layered`, `elk.direction=DOWN` | ELK dialog (below) | requires `ElkLayout` (extensions bundle) |
| Horizontal Flow... | `horizontalFlow` | ELK `layered`, RIGHT | ELK dialog | same |
| Vertical Tree... | `verticalTree` | ELK `mrtree`, DOWN | ELK dialog | same |
| Horizontal Tree... | `horizontalTree` | ELK `mrtree`, RIGHT | ELK dialog | same |
| Radial Tree... | `radialTree` | ELK `radial` | ELK dialog | same |
| Organic... | `organic` | ELK `force`; Method select switches to ELK `stress` | ELK dialog | same |
| Org Chart... | inline | `mxOrgChartLayout` (`js/orgchart/`, lazy-loaded by `EditorUi.loadOrgChartLayouts`) | Org Chart Type (Linear, Hanger 2, Hanger 4 default, Fishbone 1, Fishbone 2, Single Column Left, Single Column Right, Smart), Parent Child Spacing (20), Sibling Spacing (20) | – |
| Circle | inline | `mxCircleLayout` (core) | none | – |
| Orthogonal Routing... | inline | `LibavoidRouting.run` (edges only, vertices fixed) | Spacing prompt (16) | requires `LibavoidRouting` |
| Parallels... | inline | `mxParallelEdgeLayout` (`checkOverlap=true`) | Spacing prompt | – |
| Custom... | `runLayout` | `EditorUi.showCustomLayoutDialog` (L29228): JSON array `[{layout, config}]` + "Add..." dropdown (the ELK presets, Org Chart, Circle, Parallels, Orthogonal Routing) | free JSON | – |
| WebCola Layout... | `webColaLayout` | `mxWebColaLayout` (`plugins/webcola/`, marked deprecated) | none | `[plugin:webcola]` |

ELK config dialog (`ElkLayout.runWithDialog`, `js/diagramly/ElkLayout.js` L187-660; values persisted in localStorage):

| Algorithm | Fields (label → ELK key, default) |
|---|---|
| layered (flows) | Node Spacing `elk.spacing.nodeNode` 30; Rank Spacing `elk.layered.spacing.nodeNodeBetweenLayers` 30; Layering Strategy (Network Simplex / Longest Path / Coffman-Graham); Connector (Orthogonal / Polyline) |
| mrtree (trees) | Node Spacing 20; Weighting (Model Order / Descendants / Constraint / Fan); Bundle Outgoing Connections (`sharedStems`, default on) |
| radial | Node Spacing 20; Optimization (None / Edge Length / Edge Length by Position / Crossing Minimization); max 1 root |
| force (organic) | Method (Force-directed / Stress); Node Spacing 10; Iterations 300; Repulsive Power 0 |
| stress | Node Spacing 80; Edge Length 100; Iterations (-1 = engine default) |
| all | Group Padding (blank = auto); Edge Style (Automatic / Keep Existing Style / Orthogonal / Straight; non-layered only); Corners (Keep Existing Style / Straight / Rounded / Curved); Resize Nodes; Preserve Origin (default on); Use Selection as Root(s) (layered/mrtree/radial) |

ELK preset table `ElkLayout.MENU_PRESETS` lives in `js/elk/drawio-elk.min.js` (verticalFlow/horizontalFlow → layered DOWN/RIGHT, vertical/horizontalTree → mrtree DOWN/RIGHT, radialTree → radial, organic → force).

### Arrange > Insert > Layout (live layout containers)

Source: `js/diagramly/Menus.js` `'insertLayout'` L4597, `addInsertLayoutAction` L4245, styles `Menus.layoutContainers` L40. Inserts a `group;transparentBounds=1;groupPadding=20` container with a seed graph; layout re-runs on every add/connect/resize inside it. Same containers in Advanced sidebar (`js/diagramly/sidebar/Sidebar-Advanced.js`, swimlane-titled variant). In min/simple theme the submenu is Insert > Insert; not present in sketch theme Insert menu.

| Action id | Label | childLayout |
|---|---|---|
| `horizontalFlow` | Horizontal Flow | `elkLayered` RIGHT, rank spacing 50, model order, orthogonal rounded, `containerType=tree` |
| `verticalFlow` | Vertical Flow | `elkLayered` DOWN, same |
| `horizontalTree` | Horizontal Tree | `elkTree` RIGHT, node 40 / edgeNode 20, `containerType=tree` |
| `verticalTree` | Vertical Tree | `elkTree` DOWN, `containerType=tree` |
| `radialTree` | Radial Tree | `elkRadial`, `containerType=tree` |
| `organic` | Organic | `elkOrganic` |
| `circle` | Circle | `circleLayout` |

### Container layouts (`childLayout` style values)

Source: `js/grapheditor/Graph.js` `initLayoutManager` (~L11440-11640), `Graph.getChildLayouts`/`getLegacyChildLayouts` (L2168), `Graph.encodeChildLayout`/`decodeChildLayout` (L12711/L12724), `Graph.prototype.createLayouts` (L12792); rack in `js/diagramly/Editor.js` L9529.

| Value | Class | Style keys | Typical use |
|---|---|---|---|
| `stackLayout` | `mxStackLayout` | `horizontalStack`, `resizeParent`, `resizeParentMax`, `resizeLast`, `stackSpacing`, `stackBorder`, `marginLeft/Right/Top/Bottom`, `allowGaps`, `fill` | lists, UML class, pools/lanes (188 sidebar uses) |
| `circleLayout` | `mxCircleLayout` | parent grows to fit, starts below title (`startSize`) | circle container |
| `tableLayout` | `TableLayout` (Graph.js) | rows/cells, `colspan`, `rowspan`, `resizeLastRow`, `resizeLast` | tables |
| `rack` | `mxStackLayout` vertical, snaps to `rackUnitSize` | `horizontalRack`, margins, `allowGaps` | rack cabinets (Sidebar-Rack.js) |
| URL-encoded JSON array | `mxCompositeLayout` of `createLayouts` entries | any spec | Insert > Layout containers, custom |
| `flowLayout` (legacy) | → `elkLayered` | `flowOrientation`, `intraCellSpacing`, `interRankCellSpacing`, `interHierarchySpacing`, `parallelEdgeSpacing`, `parentPadding`, `resizeParent` | old files |
| `treeLayout` (legacy) | → `elkTree` | `horizontalTree`, `treeLevelDistance`, `parentPadding` | old files |
| `organicLayout` (legacy) | → `elkOrganic` | `parentPadding` | old files |

JSON layout names accepted (`Graph.layoutNames` L2021 + runtime additions): `mxCircleLayout`, `mxParallelEdgeLayout`, `mxStackLayout`, `elkLayered`, `elkTree`, `elkRadial`, `elkOrganic`, `elkStress`, `elkDisco`, `elkBox`, `mxOrgChartLayout` (pushed by `loadOrgChartLayouts`), `orthogonalEdge` (libavoid). Removed mxGraph layouts are mapped (`Graph.replaceLegacyLayout` L2108): `mxHierarchicalLayout`→elkLayered, `mxCompactTreeLayout`→elkTree, `mxRadialTreeLayout`→elkRadial, `mxFastOrganicLayout`→elkOrganic; `mxPartitionLayout`, `mxEdgeLabelLayout` are skipped. `mxgraph/src/layout` now holds only circle, composite, parallel-edge, stack and the base class. `elkDisco`/`elkBox` have no menu entry (JSON only).

### Other layout entry points

- `resolveLayoutList` shorthands (`js/diagramly/EditorUi.js` L26735): JSON, `libavoid`/`orthogonalEdge`, `parallels`, the six ELK preset names. Used by embed `layout` action, `#create` hash, desktop `--layout`, CSV `# layout:` line.
- CSV import `# layout:` (`EditorUi.CSV_ELK_LAYOUTS` L94 + `doImportCsv` ~L30574; values documented in the CSV template, `js/diagramly/Editor.js` L1302): `auto`, `none`, `verticalflow`, `horizontalflow`, `verticaltree`, `horizontaltree`, `organic`, `circle`, `orgchart`, `elkRadial`, `elkOrganic`, `elkStress`, plus the shared shorthands.
- Mermaid/PlantUML/text imports use ELK internally (mermaid policy in `drawio-elk`) (see section 8).

### Tree / mindmap containers

Source: `js/diagramly/Trees.js` (`EditorUi.prototype.addTrees`), sidebar entries in `Sidebar.prototype.createAdvancedShapes` override (Trees.js L1651: tree container, mindmap, orgchart templates). Older equivalent: `plugins/trees/trees.js` `[plugin:trees]`.

| Feature | Trigger / key |
|---|---|
| Tree container | parent style `containerType=tree` (`transparentBounds=1`) |
| Subtree folding | vertex `treeFolding=1` (folding icon collapses descendants, `Graph.foldTreeCell`) |
| Subtree moving | vertex `treeMoving=1` (move handle drags whole subtree) |
| Add child / parent | Tab / Shift+Tab on selected tree vertex |
| Add sibling after / before | Enter / Shift+Enter |
| Navigate | Arrow keys move selection to neighbour in tree |
| Hover arrows | add child, sibling or parent depending on direction (`graph.connectVertex` override); flow containers always add a child |
| Selection actions | `selectChildren` Alt+Shift+C, `selectDescendants` Alt+Shift+X, `selectParent` Alt+Shift+P, `selectSiblings` Alt+Shift+S |
| Style shortcuts in trees | Alt+C copy style, Alt+V paste style |
| Delete/cut cascade | deleting a vertex removes its now-orphaned subtree and structural edges (`collectTreeRemoval`) |

Counts: layouts=10 menu-invocable algorithms in Arrange > Layout (V/H Flow, V/H Tree, Radial Tree, Organic incl. Stress, Org Chart, Circle, Orthogonal Routing, Parallels) + Run Last Layout + Custom JSON + 1 plugin (WebCola); 7 insertable layout containers; container_layouts=8 `childLayout` values (stackLayout, circleLayout, tableLayout, rack, JSON array, legacy flowLayout/treeLayout/organicLayout); 12 JSON layout names. Counted from the menu functions and the `childLayout` comparisons in `Graph.js`/`Editor.js`.

## 7. Dialogs

Source: draw.io 32.4.1, commit 9034053f. Paths are relative to `src/main/webapp/`. A row marked "(ad-hoc)" is a dialog that a function builds inline (with `CustomDialog`, `FilenameDialog`, `TextareaDialog`, `EmbedDialog`, `showError` or a raw `div`), not a named constructor. Unless a row says otherwise, dialogs are modal. Shortcuts are listed only where the dialog action declares them.

### Dialog framework and generic building blocks

| Name | What it does | Source |
|---|---|---|
| `Dialog` | Base modal: backdrop, close icon, Esc, optional resize handles, min size, background-click close (can be disabled) | `js/grapheditor/Editor.js` `Dialog`; `EditorUi.prototype.showDialog`/`hideDialog` (`js/grapheditor/EditorUi.js`) |
| `CustomDialog` | Generic OK/Cancel/help-link wrapper around arbitrary content; the base for most ad-hoc dialogs | `js/diagramly/Dialogs.js` `CustomDialog` |
| `FilenameDialog` | Single-line prompt with an optional type select and validation; the base for about 28 prompts | `js/grapheditor/Editor.js` `FilenameDialog` |
| `TextareaDialog` | Multi-line text editor with custom buttons | `js/grapheditor/Dialogs.js` `TextareaDialog` |
| `SimpleTextareaDialog` | Textarea with Apply, optional Preview and "apply keeps open" | `js/grapheditor/Dialogs.js` |
| `ErrorDialog` | Message with up to 3 buttons plus Retry; used by `showError`, `alert` and `handleError` | `js/grapheditor/Editor.js`; `EditorUi.prototype.showError`/`handleError`/`alert` |
| `ConfirmDialog` | Yes/No confirmation with an optional image; used by `EditorUi.confirm` | `js/diagramly/EditorUi.js` `ConfirmDialog` |
| `EmbedDialog` | Read-only output (code, link or text) with Copy, Download, Preview and Email; size guard `EmbedDialog.maxSize` | `js/diagramly/Dialogs.js` |
| `PopupDialog` | "Open in new window / this window" chooser, also the fallback when `window.open` is blocked | `js/diagramly/Dialogs.js`; `App` ctor, `App.prototype.loadFile`, `EditorUi.openLocalFile` |
| `BtnDialog` | Single button that opens an auth popup ("Authorized in…") | `js/diagramly/Dialogs.js`; `OneDriveClient.pickFileOD` |
| `WrapperWindow` | Generic non-modal `mxWindow` wrapper (Format and Shapes windows) | `js/grapheditor/Editor.js` |
| `EditorUi.prompt` (ad-hoc) | Prompt helper built on `FilenameDialog` | `js/grapheditor/EditorUi.js` |
| Window docking/persistence | `installDialogDocking`, `installResizeHandler`, `installWindowPersistence` (window state stored with `mxSettings.getWindowState`) | `js/diagramly/Dialogs.js`, `js/diagramly/EditorUi.js` |

### File and storage

| Dialog | What it does | Opened by | Tags | Source |
|---|---|---|---|---|
| `StorageDialog` | First-run choice of where diagrams are saved (Google Drive, OneDrive, GitHub, Browser, Device, …, "Decide later") | `App.showSplash` when no mode is set | `[web]` (skipped in Electron and Chrome app) | `js/diagramly/Dialogs.js`; `App.prototype.showSplash` |
| `SplashDialog` | Start screen: Create New / Open Existing; change storage; change user, sign out, add account | `App.showSplash` (second step) | `[web]` | `js/diagramly/Dialogs.js` |
| `HomeDialog` | Google Drive home ("My Diagrams"): recent, starred and shared lists, search, add files from Drive | `myDiagrams...`; startup | `[drive]` `[flag:home=1]` (or preprod host); not embed, Electron or `noFileMenu` | `js/diagramly/HomeDialog.js`; `App.prototype.isHomeEnabled`/`showHome` |
| `OpenDialog` | Iframe (`OPEN_FORM`/open.html) that lists browser-storage files or shows a file-upload form | `import...` (grapheditor), `EditorUi.openFile`, `App.pickLibrary`, `EditorUi.importLocalFile` (non-File-API fallback) | `[browser]` when `Editor.useLocalStorage` | `js/grapheditor/Dialogs.js` |
| `SaveDialog` | Filename, format, location (storage backend, folder picker) and "open in new window" | Save as (`App.saveFile`), `makeCopy...`, `moveToFolder...`, `EditorUi.saveLocalFile`/`saveRequest` (export target), NewDialog folder pick | `moveToFolder` `[drive]` `[onedrive]` | `js/diagramly/Dialogs.js` |
| `CreateDialog` | Name and storage choice for a diagram passed by URL | `App.start` with `?create=` or `#create=` | `[flag:create]` | `js/diagramly/Dialogs.js`; `App.prototype.start` |
| Rename file (ad-hoc) | Prompt for a new file title | `rename...` | | `js/diagramly/Menus.js` `renameAction` |
| Rename page (ad-hoc) | Prompt for a page name | `EditorUi.renamePage` (page tab menu, double-click on tab) | | `js/diagramly/Pages.js` |
| Open from URL (ad-hoc) | Prompt for a diagram URL | File > Open from > URL | | `js/diagramly/Menus.js` `openFrom` |
| Import from URL (ad-hoc) | Prompt for a URL to import | File > Import from > URL | | `js/diagramly/Menus.js` `importFrom` |
| Open library from URL (ad-hoc) | Prompt for a library URL | File > Open Library from > URL | | `js/diagramly/Menus.js` `openLibraryFrom` |
| `FilePropertiesDialog` | File > Properties: zoom and border (image files), embed fonts, compressed, locked, realtime collaboration, PDF notes, size, path, public URL; "Edit Data…" for file-level variables (opens `EditDataDialog` on a temporary graph) | `properties...` | notes `[desktop]` | `js/diagramly/Dialogs.js` |
| `DraftDialog` | Found draft(s): preview, Edit, Discard, Ignore, Delete all, pick one of several | `App.checkDrafts` (startup); embed `draft` message; unsaved desktop changes on open | `[web]` / `[embed]` / `[desktop]` per path | `js/diagramly/Dialogs.js`; `App.checkDrafts`, `installMessageHandler`, `ElectronApp readGraphFile` |
| `RecoveryDialog` | Pick a recovery candidate (prior version, backup, in-memory repair); opens as an unsaved copy | "Recover" button on a load error with more than one candidate | | `js/diagramly/Dialogs.js`; `EditorUi.showRecoveryDialog` |
| Draft save interval (ad-hoc) | Seconds between draft saves; 0 disables drafts | `drafts...` (Extras) | `[desktop]` | `js/diagramly/Menus.js` |
| `LibraryDialog` | Create or edit a custom shape library: add images, image URL, drag-and-drop, rename or delete entries, export, share, save | File > New Library > {storage}; library title "Edit" | storage tags per item | `js/diagramly/Dialogs.js`; `EditorUi.showLibraryDialog` |
| Remotely stored libraries (ad-hoc) | Pick libraries stored in Confluence Cloud | Open Library from > Confluence Cloud | `[conf]` `[flag:confLib=1]` | `js/diagramly/EditorUi.js` `showRemotelyStoredLibrary` |
| External changes: conflict (ad-hoc) | Overwrite / Merge / Cancel | Save conflict | | `js/diagramly/DrawioFile.js` `showConflictDialog` |
| External changes: copy (ad-hoc) | Make a copy / Overwrite / Cancel | Save conflict without merge | | `DrawioFile.showCopyDialog` |
| Sync warning (ad-hoc) | Checksum or sync failure: Make a copy / Merge / Cancel | Realtime sync error | | `DrawioFile.showRefreshDialog` |
| Refresh required (ad-hoc) | "Redirect to new app" / refresh prompt | Version upgrade, external change | | `App.prototype.showRefreshDialog` |
| Discard changes confirm (ad-hoc) | "All changes will be lost" before Open or Open Recent | `openRecent`, `App.pickFile` | `[desktop]` | `js/diagramly/ElectronApp.js` |
| File replaced by older (ad-hoc) | Confirm when the file on disk was replaced by an older version | `LocalFile.synchronizeFile` | `[desktop]` | `js/diagramly/ElectronApp.js` |
| Resize large images (ad-hoc) | Ask whether to downscale large pasted or dropped images (remembered choice) | Image insert, drop or paste | | `EditorUi.confirmImageResize` |
| Drive: change user (ad-hoc) | "File not found or access denied": switch Google account, add account | Load error on `#G…` files | `[drive]` | `EditorUi.handleError` |
| Drive: access (ad-hoc) | Request access or change user for a Drive file | Drive permission error | `[drive]` | `App.prototype.showDriveAccessDialog` |

### Templates and new diagrams

| Dialog | What it does | Opened by | Tags | Source |
|---|---|---|---|---|
| `NewDialog` | Template gallery: categories, search, preview, filename, recent/search docs callbacks, "From template URL" (prompt), quick "From Text" entries (Mermaid, SQL, CSV, PlantUML, Text), and a "Generate"/describe-your-diagram card when `templateType == 'generative'` (gating unconfirmed beyond that) | `new...`, `insertTemplate` (Insert > Template…), `App.openTemplateDialog`, embed `template` message | `[embed]` for message; Drive/OneDrive folder step uses `SaveDialog` | `js/diagramly/Dialogs.js`; `js/diagramly/Menus.js` `new...`/`insertTemplate` |
| Template URL (ad-hoc) | Prompt for a template file URL | NewDialog | | `js/diagramly/Dialogs.js` (`FilenameDialog` in NewDialog) |

### Import, export, publish and embed

| Dialog | What it does | Opened by | Tags | Source |
|---|---|---|---|---|
| Image export (ad-hoc) | Zoom, width/height, DPI (PNG), border, transparent, shadow, grid, selection only, crop, current page or all pages, include a copy of the diagram (editable PNG/SVG), embed images, embed fonts, embed cell metadata, link target (new or this window), appearance (light, dark, automatic), named presets | `exportPng`, `exportJpg`, `exportWebp`, `exportSvg` | | `EditorUi.showExportDialog` (`js/diagramly/EditorUi.js`) |
| Export preset name (ad-hoc) | Save or rename a named export preset (per format, max `EditorUi.maxExportPresets`) | Image export dialog | | `EditorUi.showExportDialog` `findPreset` |
| Remote export (ad-hoc) | Server-side export options (selection, editable, transparent, zoom, border) when canvas export is unavailable | `exportPng` etc. fallback | `isRemoteExportEnabled()` | `EditorUi.showRemoteExportDialog` |
| PDF / Print (`PrintDialog`) | Pages (all, current, range), fit to N sheets across/down or zoom, crop, selection only, grid, shadows, transparent, include copy, notes, page view, preview | `print...` (Ctrl+P), `exportPdf` | Electron path `PrintDialog.electronPrint` `[desktop]` | `js/grapheditor/Editor.js` `PrintDialog`; override `PrintDialog.prototype.create` in `js/diagramly/Editor.js` |
| XML export (ad-hoc) | Selection only, all pages, compressed | `exportXml` | | `js/diagramly/Menus.js` |
| JSON export (ad-hoc) | Selection only, all pages, include a copy, compressed | `exportJson` | | `js/diagramly/Menus.js` |
| VSDX export (ad-hoc) | All pages or current page (shown only for multi-page files) | `exportVsdx` ("VSDX (beta)…") | | `js/diagramly/Menus.js` `exportVsdxAction` |
| HTML (ad-hoc) | Include a copy or public URL, lightbox, edit link, layers, tags, zoom, fit, link icons, tooltip icons, appearance | `exportHtml`, `embedHtml` | | `EditorUi.showHtmlDialog` |
| Publish link / URL (ad-hoc) | Link options: lightbox, edit link, layers, tags, link and tooltip icons, appearance, transparent background, width/height (iframe), all pages; result in `EmbedDialog` | `exportUrl`, `publishLink`, `embedIframe`, `embedNotion` | iframe `[web]` online only | `EditorUi.showPublishLinkDialog` |
| Edit link URL (ad-hoc) | Custom URL for the "Edit" link in HTML or publish output | HTML/publish dialogs, "Custom…" option | | `EditorUi.addEditButton` |
| Embed image / SVG (ad-hoc) | Image or SVG embed snippet options (lightbox, shadow, appearance) | `embedImage`, `embedSvg` | | `EditorUi.showEmbedImageDialog` |
| Live image (`EmbedDialog`) | `<img>` snippet for a live PNG of the file | `liveImage` | `[drive]` `[github]`, `.png` files only | `js/diagramly/Menus.js` `embed` menu |
| Animation / GIF / MP4 export (ad-hoc) | Source (page animation or diagram), format (GIF or MP4 when `Mp4Encoder.isSupported()`), speed, loops, zoom, border, appearance | `exportAnimatedGif` (Export as > Animation…) | | `EditorUi.showAnimatedGifExportDialog` |
| Export progress (ad-hoc) | "Exporting…" with Cancel; closing it stops the export | Animation export | | `EditorUi.exportPageAnimation` |
| Advanced export (`ExportDialog`) | Server-based export: filename, format (PNG, GIF, JPEG, SVG, XML), zoom, width, height, DPI, border, transparent, grid | Export as > Advanced… (`export...`) | online only (`!isOffline()`) | `js/grapheditor/Dialogs.js` `ExportDialog`; `ExportDialog.exportFile` override in `js/diagramly/EditorUi.js` and `[desktop]` in `ElectronApp.js` |
| Data export (ad-hoc) | Shows exported data as text (`TextareaDialog`, or `EmbedDialog` in diagramly) | `showDataExport` (EditDataDialog "Export") | | `EditorUi.showDataExport` (both layers) |
| Extract text (`EmbedDialog`) | All indexable text of the diagram or selection | `extractText` | | `js/diagramly/Menus.js` |
| Inline HTML preview (`EmbedDialog`) | HTML export opened "in new window" is shown inline | `saveLocalFile` mode `_blank` | | `js/diagramly/EditorUi.js` |
| `ParseDialog` | Insert from text: List, SQL table, Mermaid (diagram or image), PlantUML (diagram or image), Diagram, Circle, Horizontal/Vertical Flow (text-to-diagram), with preview | Insert > Advanced > `fromText`, `plantUml`, `formatSql`; `mermaid` | Mermaid gated by `EditorUi.isMermaidSupported()` | `js/diagramly/Dialogs.js`; `addInsertAction` in `js/diagramly/Menus.js` |
| CSV import (ad-hoc) | Textarea prefilled with the CSV config template (`Editor.defaultCsvValue`) | `csv` (Insert > Advanced > CSV…) | | `EditorUi.showImportCsvDialog` (`SimpleTextareaDialog`) |
| Edit Mermaid / PlantUML source (ad-hoc, 2) | Edit the source of an inserted Mermaid or PlantUML cell; asks before discarding unapplied edits | Double-click or edit on such cells | | `graph.cellEditor.editMermaidData`/`editPlantUmlData`, `showGuardedTextareaDialog` (`js/diagramly/EditorUi.js`) |
| `AspectDialog` | Pick a page and layers with live previews (aspect selection) | No caller in this repo (unconfirmed: likely used by an external integration) | | `js/diagramly/Dialogs.js` `AspectDialog` |

### Editing and data

| Dialog | What it does | Opened by | Tags | Source |
|---|---|---|---|---|
| `EditDataDialog` | Edit cell or page data: ID (double-click to edit, prompt), label and custom properties, add or delete property, placeholders toggle, export | `editData...` (Ctrl+M); context menu; Layers window "Edit Data"; File Properties "Edit Data" | | `js/grapheditor/Dialogs.js`; `EditorUi.showDataDialog`; `EditDataDialog.getDisplayIdForCell` (`js/diagramly/Editor.js`) |
| Edit cell ID (ad-hoc) | Prompt to change a cell ID | EditDataDialog ID double-click | | `js/grapheditor/Dialogs.js` (`addTextArea` scope) |
| Edit Style (ad-hoc) | Raw style string editor | `editStyle...` (Ctrl+E) | | `js/grapheditor/Actions.js` (`TextareaDialog`) |
| `MarkupDialog` | Markdown/HTML editor with toolbar (bold, italic, strikethrough, heading, bulleted and numbered lists, code, link, HTML) | `editTooltip...` (Alt+Shift+T), `editNote...` (Alt+Shift+N) | | `js/grapheditor/Dialogs.js` |
| Markup link URL (ad-hoc) | Prompt for a link URL inside MarkupDialog | MarkupDialog link button | | `js/grapheditor/Dialogs.js` |
| `LinkDialog` | Edit a link: URL, page link (`data:page/id,…`), custom action (`data:action/json,…`), open in new window, cloud pickers (Google Picker, Dropbox Chooser, OneDrive), mixed-value handling for multi-select | `editLink...` (Alt+Shift+L), `insertLink` (Insert > Link…), `link...` (text editor) | pickers per backend | `js/diagramly/Dialogs.js` `LinkDialog` (replaces the grapheditor version); `EditorUi.showLinkDialog` |
| `CustomActionDialog` | Thin adapter that opens AnimationDialog in "action" mode to edit custom link actions | LinkDialog "Custom action" (`LinkDialog.editCustomAction`) | | `js/diagramly/Dialogs.js` |
| `EditGeometryDialog` | Numeric left, top, width, height, rotation, relative dx/dy for selected vertices | `editGeometry...` (Ctrl+Shift+M); Edit menu; Format "Edit" dropdown | | `js/diagramly/Dialogs.js` |
| Rotation (ad-hoc) | Prompt for an angle (0-360) | `rotation` (Arrange menu) | | `js/grapheditor/Actions.js` |
| `ConnectionPointsDialog` | Visual editor for fixed connection points (`points` style): add, delete, dx/dy, grid, grid size (prompt), zoom, fit, reset | `editConnectionPoints...` | | `js/diagramly/Dialogs.js` |
| Connection points grid size (ad-hoc) | Prompt for the editor grid size | ConnectionPointsDialog | | `js/diagramly/Dialogs.js` `changeGridSize` |
| `EditShapeDialog` | Stencil XML editor with preview and validation | `editShape...`, `createShape` (Insert > Advanced > Shape…) | | `js/diagramly/Dialogs.js` |
| `PolygonDialog` | Click-to-add polygon point editor: curved, close path, grid, undo/redo, zoom, fit | `insertPolygon` (Insert > Polygon…), `editPolygon...` | | `js/diagramly/Dialogs.js` |
| `ImageDialog` | Insert or edit an image: URL, file open, drag-and-drop, Google Picker, embed as data URI, crop, size check | `image...` (Insert > Image / Edit Image), `insertImage`; LibraryDialog "Add image URL" | Google Picker `[drive]` | `js/diagramly/Dialogs.js` `ImageDialog`; `EditorUi.showImageDialog` |
| `CropImageDialog` | Crop an image with a rectangle, rounded or ellipse clip (`clipPath`), arc size, zoom, fit | `crop...`; ImageDialog crop button | | `js/diagramly/Dialogs.js` |
| `BackgroundImageDialog` | Page background image (URL, file, drag-and-drop, page link) plus size and fill color | Page Setup "Change…"; Format panel (Diagram tab) background | | `js/diagramly/Dialogs.js`; `EditorUi.showBackgroundImageDialog` |
| `FontDialog` | Custom font: system font, Google Fonts or web font URL | Font family menu "Custom…" (Format Text panel) | | `js/diagramly/Dialogs.js`; `js/diagramly/Menus.js` `fontFamily` |
| Custom font size (ad-hoc) | Prompt for a point size | Font size menu "Custom…" | | `js/grapheditor/Menus.js` `promptChange` |
| HTML table cell padding (ad-hoc) | Prompt for `cellPadding` of an HTML table in a label | Text format table tools, toolbar table menu | | `js/grapheditor/Format.js`, `js/grapheditor/Toolbar.js` |
| Custom stroke pattern (ad-hoc) | Prompt for `dashPattern` | Format Style > line pattern "Custom" | | `StyleFormatPanel.prototype.addStroke` (`js/grapheditor/Format.js`) |
| Color opacity (ad-hoc) | Prompt for an opacity of 0-100 | ColorDialog | | `js/grapheditor/Dialogs.js` `ColorDialog` |
| `ColorDialog` | Color picker: presets, recent, custom palette, hex input, advanced picker, opacity, inherit, default, light/dark (adaptive) pair with swap, B/W | Any color control (modal when another modal is open) | | `js/grapheditor/Dialogs.js`; `EditorUi.pickColorModal` |
| `EditDiagramDialog` | Edit the whole diagram as XML: replace, open in new window, select, copy to clipboard, anonymize, extract text | `editDiagram...` (Extras > Edit Diagram) | | `js/grapheditor/Dialogs.js` |
| `MoreShapesDialog` | Choose which shape libraries the sidebar shows, with previews and "remember this setting" | `shapes` ("More Shapes…") | compact variant when offline | `js/diagramly/Dialogs.js` |
| Freehand smoothing (ad-hoc) | Prompt for smoothing (1-20) | Freehand window | | `js/diagramly/Dialogs.js` `FreehandWindow` |
| Add tag (ad-hoc) | Prompt for a tag name | Tags window "Add" | | `js/diagramly/Dialogs.js` `TagsWindow` |
| `AddCustomPropertyDialog` | Name, type (bool, color, …) for a custom property | No caller found (dead code) | | `js/diagramly/Editor.js` |

### Layout

| Dialog | What it does | Opened by | Tags | Source |
|---|---|---|---|---|
| ELK layout options (ad-hoc) | Per-algorithm options (node spacing, layering strategy, edge routing, edge style, corners, resize nodes, selection as roots), saved to localStorage | Arrange > Layout > Vertical Flow, Horizontal Flow, Vertical Tree, Horizontal Tree, Radial Tree, Organic (all "…") | `typeof ElkLayout` | `js/diagramly/ElkLayout.js` `ElkLayoutBindings.runWithDialog` |
| Org chart (ad-hoc) | Layout type (branch optimizer), parent-child spacing, sibling spacing | Arrange > Layout > Org Chart…; custom-layout "Add" | | `js/diagramly/Menus.js` `layout`; `EditorUi.showOrgChartConfigDialog` |
| Custom layout (ad-hoc) | JSON array of layouts plus an "Add" dropdown that writes entries through each layout's config dialog | `runLayout` (Arrange > Layout > Custom…) | | `EditorUi.showCustomLayoutDialog` |
| Orthogonal routing spacing (ad-hoc) | Prompt for the libavoid shape buffer distance, then routes | Arrange > Layout > Orthogonal Routing… | `typeof LibavoidRouting` | `js/diagramly/Menus.js` `layout` |
| Parallels spacing (ad-hoc) | Prompt for parallel-edge spacing | Arrange > Layout > Parallels… | | `js/diagramly/Menus.js` `layout` |

### View and settings

| Dialog | What it does | Opened by | Tags | Source |
|---|---|---|---|---|
| `PageSetupDialog` | Paper size (presets or custom, portrait or landscape), grid size (in units), background color or image ("Change…"); collapsed Advanced: adaptive colors (default, auto, simple, none), initial view (use current, reset), page animation ("Edit" opens the Animation window) | `pageSetup...` | | `js/grapheditor/Editor.js` `PageSetupDialog`, `PageSetupDialog.addPageFormatPanel` |
| Custom zoom (ad-hoc) | Prompt for a zoom % | `customZoom` (Ctrl+0; View > Zoom > Custom…) | | `js/grapheditor/Actions.js` |
| Page scale (ad-hoc) | Prompt for a page scale % | `pageScale...` | | `js/grapheditor/Actions.js` |
| Configuration (ad-hoc) | Visual config editor (`DrawioConfigEditor`, about 82 keyed fields) plus a JSON tab; buttons Reset, Plugins (sketch/simple/min), Link (`#_CONFIG_` URL in `EmbedDialog`, not Electron), Preferences | `configuration...` (Extras) | `isLocalStorage` and not `[embed]` | `EditorUi.showConfigurationEditorDialog`; `js/diagramly/ConfigEditor.js`; `js/diagramly/Menus.js` |
| Preferences (ad-hoc) | Raw JSON of `Editor.settingsKey` (mxSettings) with Reset | Configuration > Preferences | not atlassian, not `[embed]` | `EditorUi.showLocalStorageDialog` |
| `PluginsDialog` | List, add (built-in or custom URL prompt) and delete plugins; restart note | `plugins...` (Extras) | `[desktop]` variant offers a built-in picker (`App.publicPlugin`) | `js/diagramly/Dialogs.js`; `js/diagramly/Menus.js`; `js/diagramly/ElectronApp.js` |
| Add plugin URL (ad-hoc) | Prompt for a custom plugin URL | PluginsDialog | | `js/diagramly/Dialogs.js` |
| Built-in plugin picker (ad-hoc) | Select a bundled plugin | PluginsDialog "Add" | `[desktop]` | `js/diagramly/ElectronApp.js` `plugins...` |
| Language manager (ad-hoc) | Lists language bundles cached for offline use; online/offline state | Language menu > Manage… | service worker ready (`[web]`/PWA) | `EditorUi.showLanguageDialog` |
| Diagram language code (ad-hoc) | Prompt for the language code used to translate diagram labels | Extras > Diagram Language > Language Code… | | `js/diagramly/Menus.js` `languageCode...` |
| Keyboard shortcuts (ad-hoc) | Shows `shortcuts.svg` in a dialog | `keyboardShortcuts...` (Help) | `[desktop]` (web opens shortcuts.svg in a new tab) | `js/diagramly/Menus.js` |

### Collaboration and revisions

| Dialog | What it does | Opened by | Tags | Source |
|---|---|---|---|---|
| `RevisionDialog` | Revision list with preview, page selector, zoom, compare, restore, open, and merge (patch editor) | `revisionHistory...` (File) | `[drive]` `[dropbox]` (`isRevisionHistorySupported`) | `js/diagramly/Dialogs.js`; `js/diagramly/Menus.js` |
| Revision merge patch (ad-hoc) | Edit the JSON diff patch before merging a revision | RevisionDialog "Merge" | | `js/diagramly/Dialogs.js` (`TextareaDialog`) |
| Share (Google) | Google Drive share settings (`gapi.drive.share.ShareClient`); falls back to a `ConfirmDialog` that opens the Drive folder | `share...` | `[drive]` (GitHub and GitLab open the repo access page; others offer to save to Drive) | `DriveClient.prototype.showPermissions`; `DrawioFile.prototype.share` |

### Integrations and authorization

| Dialog | What it does | Opened by | Tags | Source |
|---|---|---|---|---|
| `AuthDialog` | "Authorization required" with Authorize and Remember me | First access to a backend | `[drive]` `[onedrive]` `[dropbox]` `[github]` `[gitlab]` `[trello]` | `js/diagramly/Dialogs.js`; `App.prototype.showAuthDialog` |
| GitHub authorize (ad-hoc) | Access denied: Help / Retry / Authorize | GitHub 401/403 | `[github]` | `GitHubClient.prototype.showAuthorizeDialog` |
| GitHub browser (ad-hoc) | Browse org > repo > branch > path to pick a file, folder or library | GitHub open/save/library | `[github]` | `GitHubClient.prototype.showGitHubDialog` |
| GitHub commit message (ad-hoc) | Commit message for add or update | Save to GitHub or GitLab | `[github]` `[gitlab]` | `GitHubClient.prototype.showCommitDialog` |
| Enter repo path (ad-hoc) | Prompt `org/repo/ref` (GitHub) or `group/project` (GitLab) | "Enter value…" in the browsers | `[github]` `[gitlab]` | `GitHubClient.js`, `GitLabClient.js` |
| GitLab browser (ad-hoc) | Browse group > project > branch > path | GitLab open/save | `[gitlab]` | `GitLabClient.prototype.showGitLabDialog` |
| `CustomGitLabUrlWarningDialog` | Warning when `?gitlab=` overrides the server without `enableCustomGitLabUrl` | GitLab authenticate | `[gitlab]` `[flag:gitlab]` | `js/diagramly/Dialogs.js` |
| Trello browser (ad-hoc) | Browse boards and cards to attach or open diagrams; filter prompt | Trello open/save | `[trello]` | `TrelloClient.prototype.showTrelloDialog` |
| OneDrive inline picker (ad-hoc) | In-app OneDrive/SharePoint file or folder browser | OneDrive open/save/folder | `[onedrive]` | `OneDriveClient.prototype.createInlinePicker` |
| Third-party pickers (external) | Google Picker (`google.picker.PickerBuilder`), Dropbox Chooser (`Dropbox.choose`), OneDrive picker SDK | Open, Import, Link, Image | `[drive]` `[dropbox]` `[onedrive]` | `js/diagramly/DriveClient.js`, `js/diagramly/Dialogs.js` |

### Help, errors and notifications

| Dialog | What it does | Opened by | Tags | Source |
|---|---|---|---|---|
| `AboutDialog` | "About GraphEditor" logo and version | `about` action in grapheditor only; draw.io replaces `about` with a version item (Shift-click toggles debug output) | not reachable in draw.io | `js/grapheditor/Dialogs.js`; `js/diagramly/Menus.js` `about` |
| Error / alert / confirm (generic) | `showError`, `alert`, `confirm`, `handleError` (with alternate actions such as Recover or Retry) | Throughout | | `js/grapheditor/EditorUi.js`, `js/diagramly/EditorUi.js` |
| Embed `dialog` message (ad-hoc) | Host-requested message box (title, message, button) | postMessage `{action:'dialog'}` | `[embed]` | `EditorUi.installMessageHandler` |
| Embed `prompt` message (ad-hoc) | Host-requested prompt; the reply goes back to the host | postMessage `{action:'prompt'}` | `[embed]` | `EditorUi.installMessageHandler` |
| Developer: Check File / Diff-Sync / Create Sidebar Entry (ad-hoc, 3) | Paste XML to validate; diff/sync testing; generated sidebar entry code | Extras > Develop | `[flag:test=1]` | `js/diagramly/Menus.js` `testCheckFile`, `testDiff`, `createSidebarEntry` |
| Plugin dialogs (ad-hoc, 2) | Replay recording delay prompt with an `EmbedDialog` link; Replay changes textarea | `record...`, `replay...` | `[plugin:replay]` | `plugins/replay.js` |

### Non-modal windows

| Window | What it does | Opened by | Tags | Source |
|---|---|---|---|---|
| Layers (`LayersWindow`) | Add, rename, delete, duplicate, show/hide, lock/unlock and reorder layers; move selection to a layer; select a layer's objects; edit layer data | `layers` (Ctrl+Shift+L); opens itself on load when the diagram has more than one layer | | `js/grapheditor/Dialogs.js`; `EditorUi.showLayersDialog` |
| Outline (`OutlineWindow`) | Minimap navigator | `outline` (Ctrl+Shift+O) | | `js/grapheditor/Dialogs.js` |
| Find / Find-Replace (`FindWindow`) | Search labels and data; regex, all pages, replace, replace all, next/previous | `findReplace` (Ctrl+F); find-only when read-only or with Shift; sidebar search "Find in Diagram" | | `js/diagramly/Dialogs.js`; `EditorUi.showSearchWindow` |
| Tags (`TagsWindow`) | List, add, remove and select tags; filter (hide) cells by tag | `tags` (Ctrl+K) | | `js/diagramly/Dialogs.js`; `Graph.prototype.createTagsDialog` (`js/diagramly/Editor.js`) |
| Freehand (`FreehandWindow`) | Start drawing, brush mode, smoothing, black-and-white | `insertFreehand` (Insert > Freehand; X key) | `window.mxFreehand` | `js/diagramly/Dialogs.js` |
| Adaptive Colors (`AdaptiveColorsWindow`) | Review and remove user-defined light/dark color pairs (background, labels) | `adaptiveColors` (Ctrl+Shift+6 only, no menu) | | `js/diagramly/Dialogs.js`; `js/diagramly/EditorUi.js` key bindings |
| Generate / AI chat (`ChatWindow`) | Describe a diagram, generate or edit with AI (selection/page/file context), dictate, paste response, insert/apply, new chat | `generate` (Insert menu; sidebar search "Generate"), NewDialog | `[flag:enableAi]` (or Electron, or ac/aj.draw.io hosts), online, Mermaid supported | `js/diagramly/Dialogs.js`; `App.prototype.openGenerateDialog` |
| Comments (`CommentsWindow`) | Threaded comments: add, reply, edit, delete, resolve/reopen, show resolved, anchored to shape/point/area, refresh | `comments` (View panels, toolbar comment button) | `[drive]` (only `DriveFile.commentsSupported()` returns true in this repo) | `js/diagramly/EditorUi.js` `CommentsWindow`; `js/diagramly/Menus.js` |
| Animation (`AnimationDialog`) | Step-based page animation editor (show, hide, fade in/out, wipe in/out, flow, highlight, toggle, text, scroll, move, wait, loop; select by tags or layers; preview); also edits custom link actions | Page Setup > Animation "Edit"; LinkDialog custom action | | `js/diagramly/Dialogs.js` `AnimationDialog`; `js/diagramly/Menus.js` `animation` |
| Color (`ColorWindow`) | Non-modal color picker wrapping `ColorDialog` | Color controls when no modal dialog is open | | `js/grapheditor/Dialogs.js`; `EditorUi.pickColor` |
| Format window (`WrapperWindow`) | Format panel as a floating window | Theme switch | `[theme:sketch]`, `[theme:min]` with `EditorUi.windowed` (`urlParams['windows'] != '0'`) | `EditorUi.createFormatWindow`; `js/diagramly/Minimal.js` |
| Shapes window (`WrapperWindow`) | Sidebar as a floating window | Theme switch | `[theme:sketch]`, `[theme:min]` windowed | `EditorUi.createShapesWindow`; `js/diagramly/Minimal.js` |
| Data (props plugin) | Shows the selected cell's data | `extractData...` (Extras) | `[plugin:props]` | `plugins/props.js` |
| From SQL | SQL-to-table import window | `fromSql` | `[plugin:sql]` | `plugins/sql.js` |
| Hidden Tags | Toggle visibility by tag | `hiddenTags...` | `[plugin:tags]` | `plugins/tags.js` |

Related popups and overlays (not counted): Explore overlay (`Graph.exploreFromCell`, `explore` action and `[plugin:explore]`); shape picker (`EditorUi.showShapePicker`); sidebar hover preview and entry menu (`Sidebar.showTooltip`, `showPopupMenuForEntry`); note box (`Graph.showNoteBox`); notifications panel (`App.showNotification`); banners (`showBanner`: download desktop `[web]`, PWA install on mobile, update available/ready `[desktop]`, embed deprecation `[embed]`, Dropbox deprecation `[dropbox]`); viewer layers and tags dropdowns (`GraphViewer`).

Counts: dialog_constructors=47, adhoc_dialogs=75, windows=15, total_dialogs=122 (47+75; windows counted separately).
How counted: `dialog_constructors` = distinct `*Dialog` constructor names in `js/grapheditor/*.js` and `js/diagramly/*.js`. `LinkDialog` is counted once (diagramly replaces the grapheditor one). The count includes `AnimationDialog` (non-modal at runtime), the uncalled `AspectDialog` and `AddCustomPropertyDialog`, and `AboutDialog`, which draw.io cannot reach. `adhoc_dialogs` = distinct user-facing inline dialogs listed above: rows marked "(ad-hoc)", where "(ad-hoc, N)" rows count as N, plus Share (Google) and Third-party pickers. It excludes the generic helper rows (error/alert/confirm, `EditorUi.prompt`). `windows` = the rows of the non-modal table: 12 core and 3 plugin windows.

## 8. File formats

Paths relative to `src/main/webapp/`. `EUi` = `js/diagramly/EditorUi.js`, `dMenus` = `js/diagramly/Menus.js`, `dDlg` = `js/diagramly/Dialogs.js`, `dEd` = `js/diagramly/Editor.js`.

### Native document format

| Aspect | Detail | Source |
|---|---|---|
| Container | `<mxfile>` with one `<diagram>` per page, each holding `<mxGraphModel>` (plain) or deflate-raw + base64 + URI-encoded text (compressed) | `js/grapheditor/Graph.js` `Graph.compress`/`Graph.decompress`; `dEd` `Editor.extractGraphModel` |
| Compression default | Uncompressed (`Editor.defaultCompressed = false`); config key `compressXml`; per-file toggle "Compressed" in File > Properties | `dEd` (`Editor.defaultCompressed`, `configure`); `dDlg` `FilePropertiesDialog` |
| Saveable file types (Save/Save as type select) | `.drawio` "XML File", `.png` "Editable Bitmap Image", `.svg` "Editable Vector Image", `.html` "HTML File"; `.pdf` added `[desktop]` | `dEd` `Editor.prototype.diagramFileTypes`; `js/diagramly/ElectronApp.js` (concat `formatPdf`) |
| Editable PNG | XML in PNG `tEXt` chunk keyword `mxfile` (URI-encoded); DPI in `pHYs`; file named `*.drawio.png` | `dEd` `Editor.writeGraphModelToPng`; `EUi` `createImageDataUri`, `getEmbeddedPng` |
| Editable SVG | XML in `content` attribute of root `<svg>`; `*.drawio.svg` | `EUi` `getEmbeddedSvg`, `exportSvg`; `dEd` `Editor.extractGraphModel` (`node.nodeName == 'svg'`) |
| Editable PDF | Diagram as PDF 1.7 embedded file (`application/vnd.jgraph.mxfile`) or Subject; re-save as `.pdf` `[desktop]` | `dEd` `Editor.extractGraphModelFromPdf`; `ElectronApp.js` `getEmbeddedPdf` |
| Editable HTML | `<div class="mxgraph" data-mxgraph='{"xml":…}'>` + `viewer-static.min.js` (loaded from `EditorUi.drawHost` or `DRAWIO_VIEWER_URL`); optional meta-refresh redirect | `EUi` `getHtml2`, `getHtml`; `dEd` `Editor.extractGraphModel` |
| Editable-file save options | PNG/SVG: zoom (`scale`), border; SVG: embed fonts; PDF: notes `[desktop]`; all: compressed | `EUi` `getPngFileProperties`, `getSvgFileProperties`, `getPdfFileProperties`; `dDlg` `FilePropertiesDialog` |
| ZIP container | `.drawio` zip with `diagram/diagram.xml` | `EUi` `importZipFile` |
| Library | `<mxlibrary>[JSON array]</mxlibrary>`, extensions `.drawiolib`, `.xml` | `dEd` `Editor.prototype.libraryFileTypes`; `EUi` `importFile` (`<mxlibrary` → `loadLibrary`) |

### Import formats

Format detection order in `EUi` `importFile`: image MIME → `<graphml ` → Visio filename → Gliffy JSON → `PK` zip → text (`insertTextAt`). Open (not insert) path: `EUi` `openFileHandle`/`openLocalFile`. Lazy bundles: Visio, GraphML, Lucidchart and Miro load `js/extensions.min.js` on demand (`mxscript(DRAWIO_SERVER_URL + 'js/extensions.min.js')`); offline without the bundle shows "serviceUnavailableOrBlocked".

| # | Format | Extensions / MIME / signature | Mechanism | Entry points | Notes / tags |
|---|---|---|---|---|---|
| 1 | draw.io XML | `.drawio`, `.xml`; `<mxfile>`, `<mxGraphModel>`; compressed or plain | client | Open, Import from (Device/Browser/Drive/OneDrive/Dropbox/GitHub/GitLab/Trello/URL), drag-drop, paste, Edit Diagram, `#R`, embed `load` | Multi-page mxfile adds pages; Ctrl+drop/insert adds as new page (`importXml` `addNewPage`). `EUi` `isCompatibleString`, `importXml` |
| 2 | draw.io ZIP | `PK` header, `diagram/diagram.xml` | client (JSZip) | Open, import, drop | `EUi` `importZipFile` |
| 3 | Editable PNG | `.png` with `tEXt mxfile` | client | Open, import, drop, paste (clipboard image) | Shift+drop inserts as plain image (`ignoreEmbeddedXml`). `EUi` `extractGraphModelFromPng`, `readGraphModelFromImageClipboardData` |
| 4 | Editable SVG | `.svg` with `content` attr | client | Open, import, drop | Without diagram data: inserted as image. `EUi` `importFiles` |
| 5 | Editable PDF | `.pdf` with embedded mxfile | client | Open, import, drop | PDFs without embedded diagram are not imported (unconfirmed: falls through to data-URI image path). `dEd` `Editor.extractGraphModelFromPdf` |
| 6 | HTML with diagram | `.html`; `div.mxgraph[data-mxgraph]` or escaped `<mxfile` | client | Open, drop, paste | `EUi` `extractGraphModelFromHtml`; `js/grapheditor/EditorUi.js` `extractGraphModelFromEvent` |
| 7 | Raster images | any `image/*` the browser decodes (PNG, JPEG, GIF, WebP, BMP…); URL extensions `gif\|jpg\|jpeg\|tiff\|png\|svg` | client | Insert > Image, drop, paste, import | Inserted as `shape=image;…;aspect=fixed`; large images trigger resample prompt (`resampleThreshold`, `maxImageSize`). `EUi` `importFile`, `confirmImageResize`, `resizeImage` |
| 8 | SVG image | `image/svg+xml` | client | same as 7 | Style adds `editableCssRules=.*` (SVG colors editable). `EUi` `importFile` |
| 9 | Visio drawing | `.vsdx`, `.vstx` (templates) | client (`js/diagramly/vsdx/importer.js` `mxVsdxCodec`) | Open, import, drop, embed `load` (`data:application/vnd.visio;base64,`), `#U` | Embedded EMF images converted via `emfToSvg` (`js/diagramly/emf/emf-svg.js`). `EUi` `importVisio`; `importer.js` `EditorUi.prototype.doImportVisio` |
| 10 | Legacy binary Visio | `.vsd`, `.vst` (OLE `D0CF11E0`) | client (`js/vsd/drawio-vsd.min.js` `DrawioVsd.convert` → VSDX) | same as 9 | `.vdx`/`.vsx` (Visio 2003–2010 XML) explicitly unsupported. `EUi` `convertBinaryVisio`, `isLegacyVisioFormat` |
| 11 | Visio stencils | `.vssx`, `.vss` (via drawio-vsd) | client (`mxVssxCodec.decodeVssx` → `<mxlibrary>`) | Open/import (loads as sidebar library), `loadTemplate(asLibrary)` | `importer.js` `doImportVisio`; `js/diagramly/App.js` `loadTemplate` |
| 12 | GraphML (yEd) | content contains `<graphml ` | client (`js/diagramly/graphml/mxGraphMlCodec.js`) | Open, import, drop | yFiles/BPMN mappings. Import only. `EUi` `importGraphML` |
| 13 | Gliffy | `.gliffy` JSON with `"contentType":"application/gliffy+json"`; Gliffy zip (`versions/N`) | client (`js/gliffy/drawio-gliffy.min.js` `mxGliffyToDrawio.convert`) | Open, import, drop, paste text, embed `load`, `#U` | 413 → "diagramTooLarge" on converter limits. `EUi` `isGliffyData`, `importGliffy`, `loadGliffy` |
| 14 | Lucidchart | JSON starting `{"state":"{\"Properties\":` or `{"Properties":`; clipboard span `data-lucid-type="application/vnd.lucid.chart.objects"` | client (`LucidImporter.importState`, source `js/diagramly/Extensions.js`) | Open (`.json` renamed `.drawio`), import, paste from Lucidchart, embed `load`, `#U` | `EUi` `isLucidChartData`, `convertLucidChart`, `pasteCells` |
| 15 | Miro | clipboard JSON starting `{"isProtected":` | client (`js/diagramly/miro/MiroImporter.js` `importMiroJson`) | Paste only | `EUi` `pasteCells` |
| 16 | Mermaid | text | client (`js/mermaid/drawio-mermaid.min.js` `mxMermaidToDrawio.parseText`) | Arrange > Insert > Mermaid (`mermaid` action → `ParseDialog`); embed `load` descriptor `format:'mermaid'`; open `.mmd`/`.mermaid` `[desktop]` | Output: "Diagram" (editable native group, source kept in `mermaidData` attr, re-editable via double-click/pen icon) or "Image" (static SVG). Gated by `EditorUi.isMermaidSupported()` (`isMermaidEnabled` = `structuredClone` present). Desktop `--mermaid-image` flag opens as image. `EUi` `parseMermaidDiagram`, `createMermaidImageXml`; `ElectronApp.js` `readGraphFile` |
| 17 | PlantUML | text | client (`js/plantuml/drawio-plantuml.min.js` `mxPlantUmlToDrawio.parseText`) | Insert > Advanced > PlantUML (`plantUml`); embed descriptor `format:'plantuml'` | Output: "Diagram" (editable group, `plantUmlData`) or "Image" (client-rendered SVG); no PlantUML server. `EUi` `parsePlantUmlDiagram`, `parsePlantUmlImage` |
| 18 | SQL DDL | `CREATE TABLE …` text | client | Insert > Advanced > SQL (`formatSql` → `ParseDialog` type `table`) | Produces ER table shapes. Legacy "From SQL" `[plugin:sql]` (`plugins/sql.js` `fromSql`) |
| 19 | CSV | text with `#` directives | client | Insert > Advanced > CSV (`csv` → `showImportCsvDialog`); `?desc=` / embed descriptor `format:'csv'` | Directives: `label`, `labelname`, `labels`, `style`, `stylename`, `styles`, `vars`, `identity`, `parent`, `parentstyle`, `namespace`, `width`, `height`, `left`, `top`, `padding`, `collapsed`, `link`, `ignore`, `connect` (JSON), `layout`, `nodespacing`, `levelspacing`, `edgespacing`, `unknownStyle`. Layouts: `auto`, `verticalflow`, `horizontalflow`, `verticaltree`, `horizontaltree`, `organic` (ELK), `circle`, `orgchart`, JSON custom layout arrays. `EUi` `doImportCsv`, `EditorUi.CSV_ELK_LAYOUTS` |
| 20 | Text structures ("From Text") | text | client | Insert > Advanced > From Text (`fromText` → `ParseDialog`) | Types: `list` (UML class blocks, `--` divider), `diagram` (`a->label->b` lines, organic layout), `circle`, `horizontalFlow`, `verticalFlow`. `dDlg` `ParseDialog` |
| 21 | draw.io library | `.xml`, `.drawiolib` (`<mxlibrary>`) | client | File > Open Library from…, import, drop | Loaded into sidebar, not canvas. `EUi` `importFile`, `libraryLoaded` |
| 22 | Plain/HTML text, URLs | `text/plain`, `text/html`, `text/uri-list` | client | Paste, drop | Text → `text;whiteSpace=wrap;` cell (truncated at `maxTextBytes`); URL text gets cell link (`Graph.isLink`); image URL → image cell; single `<img>`/`<a>`/`<pre>` in dropped HTML extracted; Ctrl/Cmd+Shift+V pastes plain text. `EUi` `insertTextAt`, `installNativeClipboardHandler`, `pasteCells` |
| 23 | Freemind | Freemind XML | client | `importFreemind` action | `[plugin:import]` (`plugins/import.js`; not in `App.publicPlugin`) |

Not supported (confirmed absent or rejected): Excalidraw (only a hostname string in `App.js`/`GraphViewer.js` error filtering), Visio 2003–2010 XML (`.vdx`, `.vsx`), standalone EMF/WMF files (EMF only inside VSDX), JSON re-import of the JSON export (no import path found; unconfirmed).

### Import entry points and transport

| Entry point | Behavior | Source / tags |
|---|---|---|
| File > Import from > Google Drive / OneDrive / Dropbox / GitHub / GitLab / Trello | Picker → `importFile`; SVG without diagram → image | `dMenus` `importFrom`; `[drive]` `[onedrive]` `[dropbox]` `[github]` `[gitlab]` `[trello]` |
| File > Import from > Browser | localStorage/IndexedDB files | `dMenus` `importFrom`; `[browser]`; `[flag:browser!=0]` |
| File > Import from > Device | File input, no `accept` filter | `EUi` `importLocalFile`; `[flag:noDevice!=1]` |
| File > Import from > URL | Fetched via `PROXY_URL` | `dMenus` `importFrom`; `[web]` `[server]` (hidden when offline) |
| File > Import… | Single action replaces submenu | `dMenus` file menu; `[desktop]` (also Chrome app, `getServiceName()=='atlassian'`); `ElectronApp.js` `import...` |
| Drag-drop files on canvas | Insert at drop point; Alt = ignore position; Shift = keep PNG/SVG as image; Ctrl = new page / resize dialog; single `.drawio`/`.xml`/Visio dropped on blank unmodified diagram (or Shift) opens it instead | `EUi` drop listener near `installImagePasteHandler` (`graph.container` `drop`) |
| Drag-drop text/HTML/URL | `extractGraphModelFromEvent` → `insertTextAt` | same |
| Paste | Clipboard XML (plain or URI-encoded), HTML, images, files, Lucidchart, Miro | `EUi` `pasteCells`, `pasteFromClipboard`, `readGraphModelFromClipboard` |
| Edit Diagram dialog | Edit raw XML; Apply; Copy to clipboard; open in new window; Anonymize; Extract Text | `js/grapheditor/Dialogs.js` `EditDiagramDialog`; `editDiagram` action |
| URL hash | `#R<data>` raw/compressed XML; `#U<url>` load URL (proxy if no CORS); `#E` embed draft; storage hashes `#G` Drive, `#D` Dropbox, `#W`/`#M` OneDrive/SharePoint, `#H` GitHub, `#A` GitLab, `#T` Trello, `#L` browser; `#S` deprecated | `js/diagramly/App.js` `loadFile`; `*File.js` `getHash` |
| URL params | `?url=` (→ `#U`), `?open=`, `?create=`/`?data=` (from opener), `?desc=` compressed descriptor (`url`, `data`, `format:'csv'`, `update`, `interval`) | `App.js` `start`; `EUi` `loadDescriptor` |
| Embed `load` message | `xml`, `xmlpng`, `descriptor` (csv/mermaid/plantuml), Visio base64, Gliffy, Lucidchart | `EUi` `installMessageHandler`; `[embed]` |
| Templates/URLs | `loadTemplate` converts Visio, Gliffy, Lucidchart, PNG, PDF | `App.js` `loadTemplate` |

### Export formats

Raster export runs client-side when `Editor.prototype.isExportToCanvas()` (Chrome app or canvas/foreignObject test passed, `Editor.useCanvasForExport`); otherwise via `EXPORT_URL` server (`isRemoteExportEnabled`). Server limits: `MAX_REQUEST_SIZE`, `MAX_AREA` (`EUi` `downloadRequestBuilder`).

| # | Format | Options (see keys below) | Entry point (action id → label) | Client vs server | Tags |
|---|---|---|---|---|---|
| 1 | PNG | zoom, width/height, size (diagram/page/selection), transparent, include copy (+ all/current page), DPI (100/200/300/400/custom; writes `pHYs`), border, appearance (light/dark), shadow, grid, presets | `exportPng` → "PNG…" (`dMenus`); `EUi` `showExportDialog`, `exportImage` | client canvas; else server (`format=png`/`xmlpng`) | server fallback `[server]` |
| 2 | JPEG | as PNG minus transparent, include copy, DPI | `exportJpg` → "JPEG…" | client if `Editor.jpgSupported`; else server | |
| 3 | WebP | as JPEG | `exportWebp` → "WebP…" | client only (`Editor.webpSupported`) | |
| 4 | SVG | zoom, width/height, size, transparent, include copy (+ pages), border, appearance (light/dark/auto via `light-dark()`), links target (auto/new window/this window), shadow, grid, embed images, embed fonts, cell metadata (`data-meta-*`), icons (tooltip/link/note icons with popups), presets | `exportSvg` → "SVG…"; `EUi` `exportSvg` | client | Legacy `data-*` output `[plugin:svgdata]` |
| 5 | PDF | pages: all / from–to (+ current page button) / selection only; page view / crop / fit to N sheets across × M down; border; zoom; grid; shadows; transparent; include copy; notes as PDF sticky-note annotations `[desktop]`; Preview button (web) | `exportPdf` → "PDF…" (`dMenus`); `dEd` `PrintDialog.prototype.create`; `EUi` `downloadFile('pdf')` | server (`EXPORT_URL`) on web `[server]`; local Electron pipeline `[desktop]`; without export service falls back to browser print dialog (`isPrintPdfExport`) | PDF includes link/tooltip annotations and math text layer (`js/export.js`) |
| 6 | VSDX | "All Pages" checkbox (multi-page diagrams) | `exportVsdx` → "VSDX (beta)…" | client `VsdxExport` | `[flag:getServiceName()=='atlassian']` (`EUi` `vsdxExportEnabled`); `VsdxExport` source/bundle not present in this repo (referenced in `Devel.js`, not in `app.min.js`/`extensions.min.js`) |
| 7 | HTML (standalone viewer page) | include copy vs public URL, zoom (enabled + initial %), fit, lightbox, appearance (light/dark/auto), pages, edit button (new window/make copy/custom URL), layers, tags (+ use current settings), link icons, tooltip icons, link target, link color | `exportHtml` → "HTML…"; `EUi` `showHtmlDialog`, `createHtml` | client; output loads `viewer-static.min.js` from drawHost | |
| 8 | XML (`.drawio`) | selection only, all pages, compressed | `exportXml` → "XML…"; `EUi` `downloadFile('xml')` | client | |
| 9 | URL | link target, link color, pages, lightbox, appearance, edit, layers, tags (+ current settings), link icons, tooltip icons | `exportUrl` → "URL…" → `EmbedDialog`; `EUi` `createLink` (`#R` + compressed XML, or file hash) | client | `[flag:config enableExportUrl]` (default on) |
| 10 | JSON | selection only, all pages, include copy of diagram, compressed | `exportJson` → "JSON…"; `EUi` `createJsonForExport` | client | Structure + labels + custom attributes, no styles/geometry |
| 11 | Animated GIF | source (Page Animation / Flow Animations), speed (slow 8 / medium 15 / fast 24 fps), zoom, border, loops (forever/1/3/5), appearance, transparent; GIF capped 30 s (`AnimationExport.maxGifDuration`) | `exportAnimatedGif` → "Animation…"; `EUi` `showAnimatedGifExportDialog`; `js/diagramly/gif/AnimationExport.js`, `AnimatedExport.js`, `GifEncoder.js` | client | needs `isExportToCanvas()` |
| 12 | MP4 video | as GIF; page animations only; H.264 via WebCodecs | same dialog, format "MP4 Video" | client (`js/diagramly/gif/Mp4Encoder.js`, `VideoEncoder`) | only if `Mp4Encoder.isSupported()`; WebM not present |

Other output paths:

| Output | Options | Entry point | Tags / source |
|---|---|---|---|
| Advanced export dialog | filename, format (PNG/JPEG/SVG; GIF & XML hidden in draw.io), zoom %, width, height, DPI, transparent, grid, border | `export` → "Advanced…" in Export as | hidden offline; `js/grapheditor/Dialogs.js` `ExportDialog`; `EUi` override (`ExportDialog.exportFile`) |
| Remote export dialog (no canvas export) | selection only, include copy, transparent, zoom, border | PNG/JPEG export | `[server]`; `EUi` `showRemoteExportDialog` |
| Print | pages/range/selection, page view/crop/fit sheets, border, zoom, grid, shadows, Preview | `print` (Ctrl+P), Page Setup | `dEd` `PrintDialog.prototype.create` |
| Embed > Image | fit, shadow, retina, lightbox, edit, layers, link icons, tooltip icons | `embedImage` | `[flag:!isOffline()]` (all Embed actions are defined only online, `dMenus`); `EUi` `showEmbedImageDialog`, `createEmbedImage` |
| Embed > SVG | pages, fit, shadow, image (`<img>` vs inline `<svg>`), lightbox, appearance, edit, layers, link icons, tooltip icons | `embedSvg` | `EUi` `createEmbedSvg` |
| Embed > HTML | as HTML export, button "Create" | `embedHtml` | `dMenus` |
| Embed > IFrame | width/height, link options, lightbox, pages, appearance, edit, layers, tags, icons | `embedIframe` | `[flag:!isOffline()]`, hidden in iOS standalone |
| Embed > Notion | publish link dialog → URL for Notion Chrome extension | `embedNotion` | `[flag:!isOffline()]`, not in embed mode (`urlParams['embed'] != '1'`) |
| Embed > Microsoft Office | opens `https://office.draw.io` add-in | `microsoftOffice` | same gating as Notion |
| Embed > Live image | `<img src>` of the stored PNG | `liveImage` | `[drive]` `[github]` (`.png` files only) |
| Publish > Link | link type (copy / auth required / public URL), size, transparent, initial page, lightbox, appearance, edit, layers, tags, icons | `publishLink` | `EUi` `showPublishLinkDialog` |
| EmbedDialog actions | copy, preview, download snippet (`embed.txt`/`embed.html`), email | — | `dDlg` `EmbedDialog` |
| Copy as Image | PNG at 4×, writes `image/png` + `text/html`; falls back to download | `copyAsImage` (Ctrl+Alt+X) | visible if `Editor.enableNativeClipboard && isExportToCanvas()`; `EUi` `copyImage` |
| Copy as SVG | SVG of selection, current appearance | `copyAsSvg` (Ctrl+Alt+Shift+X) | same gating; `EUi` `copySvg` |
| Copy as Text | label as text or HTML | `copyAsText` (Format panel Edit dropdown) | `js/grapheditor/Actions.js` |
| Copy / Cut | cell XML (`navigator.clipboard.writeText`, URI-encoded legacy path) | `copy`, `cut` | `EUi` `copyXml`, `copyCells` |
| Presentation Mode | chromeless full-screen viewer, Ctrl+←/→ pages | `presentationMode` (Publish menu) | `dMenus` |
| Embed `export` message | formats `png`, `xmlpng`, `svg`, `xmlsvg`, `html`, `html2`, `xml`, `json`; params `scale`, `border`, `background`, `shadow`, `grid`, `transparent`, `theme`, `keepTheme`, `layerIds`, `pageId`, `currentPage`, `allPages`, `selection`, `width`, `size`, `embedImages`, `embedFonts`, `embedCellMetadata`, `includeData`, `compressed`, `asText`, `spin`, `spinKey` | postMessage | `[embed]`; `EUi` `installMessageHandler` |
| Desktop save dialogs | filters png, jpg, svg, pdf, vsdx, html, xml, txt, gif, mp4 | all exports | `[desktop]`; `ElectronApp.js` `saveData` |
| Desktop command line | `--layout`, `--normalize`, `--mermaid-image` flags forwarded to the editor; CLI export itself lives in drawio-desktop (unconfirmed here); `vsdxImporter.html` serves its VSDX import | — | `[desktop]`; `ElectronApp.js`; `js/vsdxImporter.js` |
| Export server page | renders XML/CSV/Mermaid to png/jpg/svg/pdf with `from`/`to`, `allPages`, `fit`, `sheetsAcross/Down`, `crop`, `pageMargin`, `w`/`h`, `theme`, `layout`, `icons` | — | `[server]`; `js/export.js`, `export3.html` |

### Export option keys (distinct)

| # | Key / label | Applies to |
|---|---|---|
| 1 | Zoom | PNG/JPEG/WebP/SVG, PDF, print, animation, advanced, remote, HTML |
| 2 | Width / Height | PNG/JPEG/WebP/SVG, advanced, publish/iframe |
| 3 | Size (`exportType`: Diagram / Page / Selection Only) | PNG/JPEG/WebP/SVG |
| 4 | Selection Only | XML, JSON, PDF, print, remote |
| 5 | Crop | PDF/print (crop radio); raster export when no size select |
| 6 | Transparent Background | PNG, SVG, PDF, animation, publish, advanced, remote |
| 7 | Include a copy of my diagram | PNG, SVG, PDF, JSON, HTML/publish link type, remote |
| 8 | Include pages (All Pages / Current Page) | PNG, SVG |
| 9 | DPI | PNG, advanced |
| 10 | Border Width | all image/PDF/print/animation/advanced/remote |
| 11 | Appearance (light / dark / auto) | PNG, JPEG, WebP, SVG (auto), HTML, publish, embed SVG, animation |
| 12 | Links target (auto / new window / this window / iframe) | SVG, HTML, URL, publish, iframe |
| 13 | Link color | HTML, URL, publish |
| 14 | Shadow(s) | PNG/JPEG/WebP/SVG, PDF, print, embed image/SVG |
| 15 | Grid | PNG/JPEG/WebP/SVG, PDF, print, advanced |
| 16 | Embed Images | SVG |
| 17 | Embed Fonts | SVG, editable SVG files |
| 18 | Cell Metadata | SVG |
| 19 | Icons (tooltip/link/note) | SVG |
| 20 | Presets (named, ≤50, localStorage) | PNG, SVG, JPEG, WebP (`EditorUi.exportPresetFormats`) |
| 21 | All Pages | XML, JSON, PDF, VSDX, URL, HTML, embed SVG |
| 22 | Page range (from/to, current page) | PDF, print |
| 23 | Page View | PDF, print |
| 24 | Fit to sheets across × down | PDF, print |
| 25 | Notes (PDF annotations) | PDF `[desktop]` |
| 26 | Compressed | XML, JSON, file properties |
| 27 | Fit | HTML, embed image/SVG |
| 28 | Lightbox | HTML, URL, publish, embed image/SVG/iframe |
| 29 | Edit button (new window / make copy / custom URL) | HTML, URL, publish, embed |
| 30 | Layers | HTML, URL, publish, embed |
| 31 | Tags (+ Use Current Settings) | HTML, URL, publish, iframe |
| 32 | Link Icons | HTML, URL, publish, embed |
| 33 | Tooltip Icons | HTML, URL, publish, embed |
| 34 | Zoom toolbar enabled + initial zoom | HTML |
| 35 | Initial Page | publish link, iframe |
| 36 | Link type (copy / auth required / public URL) | HTML, publish |
| 37 | Retina | embed image |
| 38 | SVG as `<img>` | embed SVG |
| 39 | Animation source (page / flow) | animation |
| 40 | Animation format (GIF / MP4) | animation |
| 41 | Speed (fps) | animation |
| 42 | Loops | animation |
| 43 | Filename | advanced export, desktop save |
| 44 | Format select | advanced export |

Config keys affecting IO (`dEd` `Editor.configure`): `compressXml`, `includeDiagram`, `enableExportUrl`, `embedSvgFonts`, `enableNativeClipboard`, `mermaid` (default Mermaid config).

Related but out of this section: AI "Generate" produces diagrams through Mermaid (`EUi` `generateOpenAiMermaidDiagram`, `[flag:Editor.enableAi]`, external LLM endpoint).

Counts: import_formats=23 (rows of the Import formats table; formats grouped by parser, e.g. VSDX+VSTX as one, raster images as one), export_formats=12 (file formats in the Export formats table; embed snippets, clipboard, print and embed-protocol outputs listed separately: embed/publish outputs=9: 7 Embed submenu items + Publish Link + Presentation Mode; clipboard outputs=4), export_options=44 (rows of the Export option keys table; same concept across dialogs counted once).

## 9. Storage, collaboration, and offline

Source root: `src/main/webapp/`. Mode constants: `js/diagramly/App.js` `App.MODE_GOOGLE|DROPBOX|ONEDRIVE|M365|GITHUB|GITLAB|DEVICE|BROWSER|TRELLO|EMBED|ATLAS`. Backend enablement: `App.prototype.isModeEnabled`, `isModeReady`, client creation in the `App` constructor, URL-param gating in `js/diagramly/Init.js` and the static initializer at the top of `App.js`. File abstraction: `js/diagramly/DrawioFile.js` (capability hooks overridden per `*File.js`).

### Backend capability matrix

Capabilities come from the `DrawioFile` hooks each subclass overrides: `isAutosave`, `isAutosaveOptional`, `isRevisionHistorySupported`, `commentsSupported`, `isRealtimeSupported`, `isSyncSupported`, `isRenamable`, `move`, `share`, `isEditable`. A "-" means the base default applies: false, or no-op.

| Backend (label) | Open | Save / Save as | New | Libraries | Autosave | Revisions | Comments | Realtime collab | Share / permissions | Rename / move | Tags / gating |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Google Drive (`googleDrive`) `DriveClient/DriveFile/DriveLibrary.js` | Google Picker (`pickFile`); hash `#G<id>`; Drive "Open with" via `state` param; Home screen (`HomeDialog.js`, "My Diagrams") | Save. The Save submenu shows Make a Copy instead of Save as (`Menus.js` `'save'` menu) | yes | new + open; autosaved (`DriveLibrary.isAutosave`) | optional, on by default. Adaptive delay of 1.5 to 10 s (`DriveFile` save callback) | yes (Drive revisions API, `DriveFile.getRevisions`) | yes: anchored, @mentions, permission check (`DriveFile.commentsSupported/anchoredCommentsSupported/mentionsSupported/canComment`) | yes. Per-file on/off stored as Drive property `collaboration` (`DriveFile.setRealtimeEnabled`, `isRealtimeOptional`) | Google share dialog (`DriveClient.showPermissions`, gapi `drive-share`); falls back to opening the Drive folder | rename (if editable), Move to Folder, Make a Copy (`DriveFile.copyFile`, `move`) | `[drive]` `[flag:gapi]`. Restricted files (reader role + `restricted` label) disable copy, export, print and publish (`DriveFile.isRestricted`) |
| OneDrive (`oneDrive`) `OneDriveClient/OneDriveFile/OneDriveLibrary.js` | Microsoft Graph file picker, inline (v8 SDK, `Editor.oneDriveInlinePicker`) or popup (`onedrive3.html`); hash `#W` | Save, Save as; Save submenu shows Make a Copy | yes | new + open (autosaved) | optional, 500 ms delay | - | - | yes. Optimistic sync sends the notification with the save (`isOptimisticSync`) | opens the file in the OneDrive web UI (`OneDriveFile.share`) | rename, Move to Folder | `[onedrive]` `[flag:od]`. Enabled only on draw.io and diagrams.net hostnames and not on iOS (`isModeEnabled`) |
| Microsoft 365 / SharePoint (`m365`) `OneDriveClient(..., sharepointMode=true)` | SharePoint picker (`pickFileSP`); hash `#M` | as OneDrive | yes (`CreateDialog`, `SaveDialog`) | (unconfirmed: `OneDriveLibrary` accepts `isSP`, but no New/Open Library menu entry exists) | as OneDrive | - | - | yes (channel prefix `M-`) | as OneDrive | as OneDrive | `[onedrive]` `[web]` `[flag:ms365]`. Not created in Electron (`App` ctor) |
| Dropbox (`dropbox`) `DropboxClient/DropboxFile/DropboxLibrary.js` | Dropbox Chooser; hash `#D` | Read-only: `isEditable` false. Banner "Dropbox support is ending"; Save As moves the file elsewhere | not offered (`SaveDialog` and `CreateDialog` exclude it) | open only | n/a (read-only) | listing supported (`isRevisionHistorySupported`) | - | - | - | rename disabled | `[dropbox]` `[flag:db=1]`. Deprecated. Without `db=1` a `#D` link explains where the files are (`App.loadFile`) |
| GitHub (`github`) `GitHubClient/GitHubFile/GitHubLibrary.js` | repo/branch/path browser (`GitHubClient.showGitHubDialog`); hash `#H` | Save = commit with message (`showCommitDialog`). A new title creates a new file in a picked folder (`GitHubFile.saveFile`) | yes | new + open | off (`GitHubFile.isAutosave` = false) | - | - | - | opens repo Settings > Access (`GitHubFile.share`) | rename no | `[github]` `[flag:gh]`. Conflict = HTTP 409. Public URL = raw `download_url` for public repos (`getPublicUrl`). Server via `DRAWIO_GITHUB_URL` / `DRAWIO_GITHUB_API_URL` |
| GitLab (`gitlab`) `GitLabClient/GitLabFile/GitLabLibrary.js` (extends GitHub) | same dialog; hash `#A` | commit as GitHub. Not offered as a Save-as or New target (`SaveDialog`: "Dropbox and GitLab storage are deprecated") | not offered | open only | off | - | - | - | opens project members page | rename no | `[gitlab]` `[flag:gl]`. Conflict = HTTP 400. Self-hosted via `gitlab=` and `gitlab-id=` params; requires config `enableCustomGitLabUrl` (`GitLabClient.js`) |
| Trello (`trello`) `TrelloClient/TrelloFile/TrelloLibrary.js` | card attachment picker (`showTrelloDialog`); hash `#T` | saves as a card attachment (`.xml`, max 10 MB) | yes (pick card) | new + open | always on (`TrelloFile.isAutosave` = true) | - | - | - | - | rename no | `[trello]` `[flag:tr=1]`. Off by default; a stored mode is ignored unless explicitly enabled (`App` ctor) |
| Browser (`browser`) `StorageFile/StorageLibrary.js` | Open From > Browser; hash `#L<title>` | yes | yes | new + open. The scratchpad is stored here as `.scratchpad` | optional (500 ms; forced after 20 s) | - | - | - (multi-tab sync by 10 s polling: `StorageFile.isPolling`) | - | rename | `[browser]`. IndexedDB `database` v2, stores `objects`/`files`/`filesInfo`, migrated from localStorage (`EditorUi.openDatabase`). The storage dialog shows it only with `browser=1` or `offline=1`; menus hide it with `browser=0` |
| Device (`device`) `LocalFile/LocalLibrary.js` | File System Access API `showOpenFilePicker` when `EditorUi.nativeFileSupport` (not Opera, Electron or `extAuth`); otherwise an `<input type=file>` | In place via file handle, with a `lastModified` conflict check; otherwise a download | yes (`showSaveFilePicker`) | new + open (download/upload; not autosaved) | optional only with a file handle | - | - | - | - | rename | `[device]` `[flag:noDevice]` |
| Desktop file system `ElectronApp.js` (`LocalFile` overrides) | native dialog, CLI args (`App.loadArgs`), Open Recent | native Save / Save As (`showSaveDialog`). Extra editable type: `.pdf` | new window (`newfile` IPC) | `DesktopLibrary` saves in place | optional, **default off on desktop** (`mxSettings` default `!isElectronApp`). PDF autosave is a separate opt-in (`.pdfAutosave`) | - (`.bkp` backup as recovery source) | - | - | - | rename no; Synchronize yes | `[desktop]` |
| URL (`url`) `App.loadFile 'U'`, `UrlLibrary.js` | Open From > URL, `#U<url>`, `url=` param. Loaded through `PROXY_URL` when not CORS-enabled | opens as a temporary unsaved `LocalFile` copy | - | URL libraries, read-only (`UrlLibrary.isEditable` = false) | - | - | - | - | - | - | `[server]` for the proxy. `#R<data>` opens raw or compressed XML embedded in the link |
| Embed host `EmbedFile.js`, `EditorUi.installMessageHandler` | `load` message; `#E` + `remoteInvoke('getDraftFileContent')` | host-stored; `save`, `autosave`, `exit` events; `saveAndExit`, `noSaveBtn`, `noExitBtn` | host | `libraries=1` shows New/Open Library | host-driven (`load.autosave=1` emits `autosave` events) | via host | via host | `embedRT=1` loads Pusher. `diffSync` option sends `patch` events (`embedDiffSync`) | host | Rename (`rename` enabled in embed) | `[embed]` |
| Confluence Cloud / Jira (atlas mode) | `App.MODE_ATLAS` menus: Save, Save and Exit, Revision History, Exit (`Menus.js` `'diagram'` menu). Confluence Cloud library target with `confLib=1` (`'newLibrary'`) | | | | | if the plugin file supports it | plugin `ac148cmnt` (code not in repo) | | | | `[conf]`. Plugins `ac`, `acj`, `ac148`, `ac148cmnt` are registered in `App.pluginRegistry`, but their files are not in this repo |
| Nextcloud | `plugins/nextcloud.js`: embed-mode bridge that handles the `load` descriptor and `disableAutoSave` | | | | | | | | | | `[embed]` `[flag:p=nxtcld]` |

Other integration hooks, from code only:
- MS Teams: `extAuth=1` in a WebView forces lightbox viewer, `noDevice=1` and `gapi=0` (`Init.js`); `teamsNoEditingMsg` string; `teams.html` entry page.
- Monday.com: `monday` plugin id in the registry, but `plugins/monday.js` is not in this repo (unconfirmed what it does); `monday-app-association.json`.
- Notion: File > Embed > Notion (`embedNotion`) creates a viewer link and suggests the Chrome extension. `[web]`
- Microsoft Office: File > Embed > Microsoft Office opens `https://office.draw.io`. `[web]`

### Storage selection and file lifecycle

| Feature | Detail | Source |
|---|---|---|
| Storage dialog (first run, `saveDiagramsTo`) | Google Drive, Microsoft 365, Device, Browser (only with `browser=1`/`offline=1`), OneDrive, GitHub; "Decide Later" creates an unsaved temp file | `Dialogs.js` `StorageDialog` |
| Remembered storage | `.mode` in localStorage; legacy `MODE=` cookie migrated | `App.getStoredMode`, `setMode(mode, remember)` |
| Mode override | `mode=` param; `local=1` forces Device; host `db.draw.io` defaults to Dropbox; `se.diagrams.net` forces Google with lockdown | `Init.js`, `App.js` |
| Open from | Google Drive, OneDrive, Microsoft 365, Dropbox, GitHub, GitLab, Trello, Browser, Device, URL (shown only when ready, or with a "loading..." placeholder) | `Menus.js` `'openFrom'` |
| Open Recent | up to 10 entries per type in localStorage `.recent` (`.recentFolders` for save folders); Reset | `App.addRecent/getRecent/resetRecent`, `Menus.js` `'openRecent'`; desktop override in `ElectronApp.js` |
| New / Save as target picker | Recent folders, Google Drive (My Drive + pick folder), OneDrive (My Files + pick), Microsoft 365 (pick), GitHub (pick), Trello, Device, Browser, Download, Open in New Window | `Dialogs.js` `SaveDialog`, `CreateDialog` |
| Make a Copy | Drive: copy, then move to a picked folder; others: `editAsNew` (new unsaved window) | `Menus.js` `makeCopy...` |
| Move to Folder | Drive, OneDrive | `Menus.js` `moveToFolder...` |
| Rename | file-type dependent (`isRenamable`); embed always | `Menus.js` `rename...` |
| Open Folder / Open File in provider UI | `getFolderUrl` / `getFileUrl` (Drive, OneDrive, Dropbox, GitHub, GitLab) | `Menus.js` `openFolder`, `openFile...` |
| Upload | offline app (`offline=1`) sends the current file to app.diagrams.net (`?create=drawdata`) | `Menus.js` `upload...` |
| Close | replaces the file with an empty temp file and removes its draft | `Menus.js` `close` |
| Accounts / user panel | per-provider sign in and out; Drive multi-account switch (`DriveClient.getUsersList`, Change User); Change Storage | `App.prototype.toggleUserPanel`, `Menus.js` `accounts...` |
| Auth token persistence | localStorage or sessionStorage `.gDriveAuthInfo`, `.oneDriveAuthInfo`, `.ms365AuthInfo`, `.oneDriveExtAuthInfo`, `.dbauth`, `.ghauth`, `.gitlabauth`, `.tauth` | `DrawioClient.getPersistentToken` |
| File properties dialog | Compressed, Locked (file-level edit lock, `mxfile@locked`), Realtime Collaboration toggle (when `isRealtimeOptional`), PNG/SVG zoom and border, SVG Embed Fonts, PDF Notes, public link | `Dialogs.js` `FilePropertiesDialog`; `DrawioFile.setLocked` |
| Read-only detection | Drive `desc.editable`; Dropbox always read-only; desktop `isFileWritable`; write revoked mid-session (`DrawioFile.handleWriteRevoked`) retracts unsaved realtime edits and switches to read-only | `DrawioFile.js` |
| Unload guard | browser prompt `allChangesLost` / `ensureDataSaved` when modified | `App.prototype.onBeforeUnload` (`App.js` around L3149) |

### Autosave and drafts

- Global toggle `Editor.autosave`, persisted as `mxSettings.autosave`. Default is on for web and off for desktop: `Settings.js` defaults, plus a one-time `._autoSaveTrans_` migration on desktop.
- Where the toggle appears: File > Save submenu `autosave`, File menu item, and an "Autosave" checkbox in the Format panel Diagram tab (`Editor.js` `DiagramFormatPanel.addOptions` override). The toggle is enabled only when `file.isAutosaveOptional()` (`EditorUi.updateActionStates`).
- Timing:
  - `DrawioFile.autosaveDelay` is 1500 ms. Override it with config `autosaveDelay` or `mxSettings.autosaveDelay`.
  - A save is forced after 30 s of continuous edits (`maxAutosaveDelay`).
  - A new revision is created at most every 5 min (`maxAutosaveRevisionDelay`, `isAutosaveRevision`).
  - Per-backend delays: OneDrive 500 ms; Browser 500 ms with a 20 s maximum; Drive adapts up to 10 s.
- Triggers: model changes, plus `gridSizeChanged`, `shadowVisibleChanged`, `pageFormatChanged`, `pageScaleChanged`, `backgroundColorChanged`, `backgroundImageChanged`, `foldingEnabledChanged`, `mathEnabledChanged`, `gridEnabledChanged`, `guidesEnabledChanged`, `tooltipsEnabledChanged`, `pageViewChanged`, `connectionPointsChanged`, `connectionArrowsChanged` (`DrawioFile.installListeners`).
- Status bar states:
  - `saving` "Saving..."
  - `allChangesSaved`; click opens Revision History when supported
  - `lastChange` "Last change {1} ago"
  - `unsavedChangesClickHereToSave`, with the error message appended
  - `fileChangedSync` (conflict)
  - lock icon when the file is locked
  - (`DrawioFile.addAllSavedStatus`, `addUnsavedStatus`, `addConflictStatus`, `addLastChangeStatus`)
- Drafts (crash recovery for unsaved or temporary files):
  - Enabled by `EditorUi.enableDrafts`; disable with `drafts=0`.
  - Saved to IndexedDB `objects` as `.draft_<guid>` for files with no storage mode and on desktop. Delay is `EditorUi.draftSaveDelay` (1 s), saved at least every 30 s. Empty drafts are dropped (`DrawioFile.saveDraft`).
  - Startup check: `App.checkDrafts` uses a cross-tab liveness check through `.draft-alive-check`. One orphan draft loads automatically; several open `DraftDialog` (`selectDraft`).
- Desktop drafts `[desktop]`:
  - Saved on disk beside the file through IPC `saveDraft`. The file name format is set in the drawio-desktop main process, which is not in this repo (unconfirmed).
  - On open, `getFileDrafts` shows `DraftDialog` "Unsaved changes" (`App.readGraphFile`).
  - Interval setting under Extras: `drafts...` "Draft Save Interval [sec] (0 to disable)", saved as `mxSettings.draftSaveDelay`.
- Desktop backups `[desktop]`: toggle Extras > "Automatic Backup" (`autoBkp`, `enableStoreBkp`). The `.bkp` file is used as a lossless recovery source (`LocalFile.getRecoveryVersion`, "Open backup as copy").
- Load-failure recovery: `EditorUi.getRecoveryData` builds an ordered candidate list, then `RecoveryDialog` shows it. Order: prior good revision (cloud revisions or desktop `.bkp`), then lossy in-memory repair (`Dialogs.js` `RecoveryDialog`).
- Embed drafts `[embed]`: host message `{action:'draft'}` shows `DraftDialog` with edit, discard and optional ignore, and replies `event:'draft'` (`EditorUi.installMessageHandler`).

### Conflict detection and merge

| Item | Detail | Source |
|---|---|---|
| Conflict signals | Drive HTTP 412 (etag); GitHub 409; GitLab 400; Device `lastModified` mismatch; desktop mtime + file watcher; Browser etag (data hash); OneDrive etag (`isConflict` overrides) | `*File.isConflict`, `LocalFile.saveFile`, `ElectronApp.js` `handleFileChange` |
| Synchronize (`synchronize`, Alt+Shift+S) | pulls the latest version and merges it. Label becomes "Refresh" when `sync=none` | `Menus.js`, `DrawioFile.synchronizeFile` |
| Merge algorithm | 3-way: `diffPages(shadowPages, remotePages)` patched onto local pages (`DrawioFile.mergeFile`, `patch`). Diff/patch ops insert `i`, remove `r`, update `u`, file `f` (`DiffSync.js` `diffPages/patchPages`). `DrawioFile.LAST_WRITE_WINS` = true | `DrawioFile.js`, `DiffSync.js` |
| Conflict dialogs | External Changes: Overwrite / Merge / Cancel (`showConflictDialog`); Make a Copy / Overwrite (`showCopyDialog`); checksum warning: Make a Copy / Merge(reload) / Cancel (`showRefreshDialog`) | `DrawioFile.js` |
| Checksum validation | page hash compared after merges and realtime patches; mismatch sets status "Checksum" and sends an error report | `DrawioFile.checksumError`, `DrawioFileSync.testChecksum` |
| Protocol upgrade | an incompatible collaborator version stops saves and sync (`requireAppUpgrade`, `DrawioFileSync.PROTOCOL` = 7) | `DrawioFile.js`, `DrawioFileSync.js` |
| Desktop external edit | watcher marks the conflict status. Timestamp-only changes are ignored by comparing page hashes | `ElectronApp.js` `EditorUi.prototype.handleFileChange` |

### Realtime collaboration

- Gating:
  - `DrawioFile.SYNC` = `sync` param, one of `auto` (default), `fast`, `none`. `REALTIME_URL` must exist, otherwise SYNC becomes `none` (`EditorUi.js`).
  - `Editor.enableRealtime`. `fast-sync=0` turns off live realtime but keeps change notifications.
  - Disabled by `stealth`, `lockdown`, `local` and `offline`. Pusher is not loaded in Electron or the Chrome app.
  - Live realtime requires autosave on (`DrawioFileSync.isRealtimeActive` returns `editor.autosave`). Supported only by Drive, OneDrive and M365 (`isRealtimeSupported`). `[server]`
- Transports:
  - Pusher, third-party channel for change notifications (`App.getPusher`, `PUSHER_KEY`).
  - draw.io realtime WebSocket relay `RT_WEBSOCKET_URL` (`wss://<host>/rt`) via `P2PCollab` (`sockets=0` disables).
  - Patch cache `REALTIME_URL` (`<server>/cache`, `Editor.enableRealtimeCache`, off in lockdown) for catch-up.
  - Optional WebRTC P2P via simple-peer for cursors, selection and view, only with `fast-sync=1` and `no-p2p=0`.
  - (`DrawioFileSync.js`, `P2PCollab.js`, `Init.js`)
- Notify-only sessions: clients without the realtime model (autosave off, realtime off, viewers) join to receive save, rename, comment and join notifications only (`P2PCollab(..., notifyOnly)`).
- Security: messages are encrypted with a per-file channel key (CryptoJS). Realtime stays off if no CSPRNG is available (`DrawioFileSync.isEncrypted`, `isEncryptionAvailable`).
- Live edits: local diffs flushed after about 300 ms (`syncSendMessageDelay`), with dirty-page tracking, unconfirmed-remove handling and page-root checks (`DrawioFileSync.sendLocalChanges`, `receiveRemoteChanges`, `patchRealtime`).
- Presence:
  - `userJoined` / `userLeft` status messages.
  - Remote cursors with name label and per-session color (20-color palette).
  - Remote selection highlight (`remote-selection=0` disables).
  - A silent session counts as left after 2 min (`INACTIVE_TIMEOUT`), which removes its cursor. The sync session stops after 30 min of inactivity or when the tab is hidden.
  - (`P2PCollab.js`, `DrawioFileSync.handleMessageData`)
- No collaborator roster or avatar list was found in this repo's UI. Presence shows only through cursors and status messages (unconfirmed; searched `P2PCollab.js`, `EditorUi.js`, `Simple.js`).
- View sharing:
  - Bring Everyone to Me (`bringEveryoneToMe`) sends `{a:'view'}` with page and viewport.
  - Present to Everyone (`presentToEveryone`, toggle) makes others follow this client's viewport. Statuses: `userPresenting`, `presentationEnded`, `viewSharedWithEveryone` (`EditorUi.bringEveryoneToMe`, `togglePresenting`, `startFollowing`).
- Menu items: Show Remote Mouse Cursors (`showRemoteCursors`) and Share Mouse Cursor (`shareCursor`), both persisted in mxSettings, plus Bring Everyone to Me and Present to Everyone. `Menus.addCollaborationItems` adds them to View, Extras and the toolbar Panels dropdown when realtime is enabled for the file.
- Network status (`EditorUi.getNetworkStatus`), shown in the Share menu and status: Offline, `checksum` error, "Real-Time Collaboration: disabled", Not connected, or the realtime error.
- Embed realtime: `embedRT=1` (Pusher); `diffSync` load option sends patches to the host and accepts `merge`/`patch` actions `[embed]`.

### Comments

- Supported only where `file.commentsSupported()` is true. In this repo that is `DriveFile` only `[drive]`. Integrations can override the `EditorUi.commentsSupported/getComments/addComment...` wrappers (`EditorUi.js`, "Comments" section, around L32290), for example the Confluence plugin `[conf]`.
- UI: `CommentsWindow` (`EditorUi.js` L33154). Toggle action `comments`, in Edit, View, the Panels dropdown and the min/simple theme toolbar (`Simple.js` comment button).
- Features:
  - add, reply (`canReplyToReplies`), edit, delete
  - resolve / reopen, Show Resolved, refresh, explicit Save when `commentsSaveNeeded`
  - @mentions with candidate lookup (live or local). "People you mention are not notified" appears when notifications are unsupported
  - anchors: attach to selected shape(s), page, point, or area. Anchor chips jump to the target
  - canvas comment icon overlay on cells with unresolved anchored comments (`EditorUi.updateCommentOverlays`)
  - collaborators notified of comment changes via `{a:'comments'}` (`DrawioFileSync.sendCommentsChangedMessage`)
- Model: `DrawioComment.js` (anchor `{p: pageId, c: cellIds, r: region, pt: point}`), `DriveComment.js`.

### Revision history

- Action `revisionHistory...` opens `RevisionDialog` (`Dialogs.js` L8181). Supported where `isRevisionHistorySupported()` is true: Drive (full) and Dropbox (listing; file read-only). Also embed or atlas hosts that implement it.
- Dialog: revision list, page selector, zoom in/out/fit, Compare (overlay diff against current), Merge (JSON patch editable in `TextareaDialog`, applied via `file.patch`), Restore (realtime-safe), Open (new window), Create Revision (`createRevision`, Ctrl+S).
- Entry points: File > Save submenu, status-bar click on "All changes saved" / "Last change...", embed File menu.

### Sharing and publish links

| Feature | Detail | Source |
|---|---|---|
| Share (`share...`) | Drive share dialog; OneDrive/GitHub/GitLab open provider permission pages. Other files ask to save to Google Drive first (`saveItToGoogleDriveToCollaborate`) or show `sharingAvailable` | `DrawioFile.share` + overrides |
| Share submenu | network status, Share, Publish > Link, Presentation Mode (own Drive domain only), Accounts | `Menus.js` `'share'` |
| Publish > Link (`publishLink`) | `showPublishLinkDialog`, then `createLink`: public URL (`#U`), file hash (`#G…`), or embedded copy (`#R` compressed). Options include target, link color, lightbox, edit link, layers, tags, page, dark mode, link/tooltip icons. Disabled for restricted files and offline | `Menus.js`, `EditorUi.createLink` |
| Live image (`liveImage`) | `<img>` snippet pointing at the public file URL; Drive or GitHub `.png` files only | `Menus.js` `'embed'` |
| Viewer host | `DRAWIO_LIGHTBOX_URL` (default viewer.diagrams.net). GitHub, GitLab and M365 links use the current host so the viewer can authenticate | `EditorUi.createLink` |
| Public URL lookup | `getPublicUrl`: Drive and GitHub (public repos) | `EditorUi.getPublicUrl` |

### Offline / PWA

- Service worker: `service-worker.js` (generated, Workbox-compatible precache, cache-first, ignores query params). 136 entries: app JS bundles, 33 images, 59 `resources/` language files (lazy, fallback `resources/dia.txt`), 3 plugins, Atlassian `connect/*` pages, `shortcuts.svg`, `open.html`, `index.html`, math, plantuml, onedrive and dropbox SDK files.
- Registration: `App.main`. Skipped on first load unless a channel is pinned, `enableSW=1`, or settings already exist. `offline=0` uninstalls (`App.clearServiceWorker`). `Editor.enableServiceWorker`.
- Release channels: `stable/service-worker.js` vs `service-worker.js`. Choice via `?channel=` or the server verdict (`App.checkReleaseChannel`), stored in localStorage `.drawio-channel*`. Falls back to beta after 14 days of stable SW failures.
- Install banner (`installApp`) on Android/iOS via `beforeinstallprompt` (`App` ctor). Manifest `images/manifest.json` (`index.html`).
- `offline=1` (offline app): disables all cloud backends, plugins and Pusher. Shows Browser storage. Upload replaces Make a Copy. Publish > Link is disabled and Embed > IFrame is hidden (`Init.js`, `EditorUi.isOfflineApp`, `isOffline`).
- `isOffline()` also treats `navigator.onLine == false` (web only), `stealth=1` and `lockdown=1` as offline. `lockdown=1` blocks all non-save server traffic: export server, cache, logging (`EditorUi.isExternalDataComms`, `isRemoteExportEnabled`).
- Server dependencies `[server]` (`Init.js`): `EXPORT_URL` (PDF/image export; null falls back to the print dialog for PDF), `REALTIME_URL` cache, `RT_WEBSOCKET_URL`, `PROXY_URL` (URL open/import), `SAVE_URL`, `NOTIFICATIONS_URL`, icon search.

### Desktop specifics `[desktop]`

`ElectronApp.js`:
- File menu: New, Open, Open Recent, Synchronize, Save, Save As, Import, Export As, Embed, Presentation Mode, New Library, Open Library, Properties, Page Setup, Print, Close, Exit.
- Open: native dialog; CLI and file-association args (`App.loadArgs`); `.vsdx`/`.vssx` are imported on open, `.mmd`/`.mermaid` open as Mermaid, `.png`/`.pdf` are read for embedded diagrams (`App.readGraphFile`).
- Save: IPC `saveFile` with conflict check against the original `stat`. `.pdf` is an editable save format (`Editor.diagramFileTypes` + `formatPdf`). Last directories `.lastSaveDir`, `.lastOpenDir`, `.lastImpDir`, `.lastExpDir`.
- External change watching: IPC `watchFile`/`unwatchFile` (`EditorUi.watchFile`, `handleFileChange`).
- Read-only files: `isFileWritable` → `setEditable(false)`; Save becomes Save As.
- Drafts and backups: see Autosave and drafts.
- Extras items (`Menus.js` desktop branch): Google Fonts (`googleFonts`), Spell Checker (`spellCheck`), Automatic Backup (`autoBkp`), Drafts interval (`drafts`), Automatic Updates (`autoUpdate`, hidden with `disableUpdate=1`), Open DevTools (`openDevTools`).
- Updates: `checkForUpdates`, banner `updateReady`/`updateAvailable` → `installUpdate` (`App.setUpdateState`).
- Window zoom: `desktopZoomIn/Out/ResetZoom`. Fullscreen via IPC.
- Not in this repo: file encryption or password protection (unconfirmed; the drawio-desktop main process was not inspected; no `encrypt` in `ElectronApp.js`).

### Persisted settings

- `mxSettings` lives in localStorage `.drawio-config`. Config `settingsName` changes the key to `.<name>-config`. Loading is disabled with `configure=1` or `window.mxLoadSettings=false` (`Settings.js`, `Editor.settingsKey`).
- Keys in `Settings.getDefaults`/setters (29):

  | | | | | |
  |---|---|---|---|---|
  | `language` | `configVersion` | `customFonts` | `libraries` | `customLibraries` |
  | `plugins` | `recentColors` | `formatWidth` | `sidebarWidth` | `collapsedSections` |
  | `collapsedLibraries` | `libraryOrder` | `pageFormat` | `search` | `gridColor` |
  | `darkGridColor` | `darkMode` | `autosave` | `resizeImages` | `openCounter` |
  | `version` | `isNew` | `unit` | `isRulerOn` | `windowStates` |
  | `currentEdgeStyle` | `exportPresets` | `ui` | `draftSaveDelay` | |

- Keys read or written elsewhere (12): `autosaveDelay`, `compactMode`, `defaultEdgeLength`, `enableAnimations`, `highContrast`, `pages`, `pagesVisible`, `shareCursorPosition`, `showRemoteCursors`, `sidebarTitles`, `sketchMode`, `zoomWheel`.
- Other localStorage keys:
  - storage and files: `.mode`, `.recent*`, `.configuration` (Configuration dialog JSON: lockdown, `showSplashOnStart`, …), `.localStorageMigrated`
  - drafts: `.draft-alive-check`
  - release channel: `.drawio-channel`, `.drawio-channel-ts`, `.drawio-channel-swfail`, `.drawio-channel-swerr-ts`, `.drawio-channel-switch-ts`
  - auth and pickers: provider auth keys (see lifecycle table), `odpickerv7cache`, `drawio_trello_token`, `trello_token`
  - desktop: `.lastSaveDir`, `.lastOpenDir`, `.lastImpDir`, `.lastExpDir`, `.pdfAutosave`, `._autoSaveTrans_`
- IndexedDB `database`: drafts (`.draft_*`), `.drawioMigrated3`, browser files and libraries.

Counts: storage_backends=14, collaboration_features=17, settings_keys=41.

How counted:
- storage_backends: 12 backends implemented in this repo plus 2 integration hosts. In-repo: Google Drive, OneDrive, Microsoft 365/SharePoint, Dropbox, GitHub, GitLab, Trello, Browser, Device, Desktop file system, URL, Embed host. Integration hosts: Confluence/Jira atlas mode, Nextcloud plugin.
- collaboration_features: 17 distinct user-facing features.
  1. change notification and auto-merge
  2. live realtime edits
  3. per-file realtime toggle
  4. remote cursors
  5. share-cursor toggle
  6. remote selection
  7. join/leave presence
  8. Bring Everyone to Me
  9. Present to Everyone (follow)
  10. comments with replies, resolve, edit and delete
  11. anchored comments with canvas markers
  12. @mentions
  13. revision history (compare, merge, restore)
  14. conflict dialogs and Synchronize
  15. sharing dialogs and permissions
  16. publish link and live image
  17. file lock and restricted-file enforcement
- settings_keys: 41 mxSettings keys (29 in `Settings.js` plus 12 elsewhere). Excludes the separate localStorage and IndexedDB keys listed above and the legacy keys `lastAlert` and `scratchpadSeen`, which are deleted on load.

## 10. Editor behaviors

Paths are relative to `src/main/webapp/`. Shortcuts use `Ctrl` for `Editor.ctrlKey` (Cmd on macOS).

### Grid
- Toggle: action `grid` "Grid", Ctrl+Shift+G (`js/grapheditor/Actions.js` `addAction('grid')`). The Diagram tab also has a Grid checkbox with a color swatch (`js/grapheditor/Format.js` `DiagramFormatPanel`, `createColorOption(mxResources.get('grid'))`).
- Grid size: spinner in the Format panel Diagram tab, shown in the current unit (`Format.js` ~L9100, `graph.setGridSize`). It is also in Page Setup (`js/grapheditor/Editor.js` `PageSetupDialog`, "Grid Size").
- Grid color: separate light and dark values. The view uses `light-dark(defaultGridColor, defaultDarkGridColor)` (`js/grapheditor/EditorUi.js` `setGridColor`). Both values are stored in user settings (`gridColor`, `darkGridColor`) (`js/diagramly/Settings.js` `getGridColor`/`setGridColor`), not in the file.
- Major lines: `mxGraphView.prototype.gridSteps = 4`, so every 4th line is major. This is a constant with no UI (`js/grapheditor/Graph.js`).
- Saved per diagram/page as `<mxGraphModel grid="" gridSize="">` (`js/grapheditor/Editor.js` `getGraphXml`/`setGraphXml`). The `grid` URL param overrides it.
- Snap selection to grid: action `snapToGrid` "Snap to Grid" (`Actions.js` → `graph.snapCellsToGrid`).

### Guides
| Guide type | Behavior | Source / switch |
|---|---|---|
| Position (alignment) guides | Align edges and centers while moving | `mxgraph/src/util/mxGuide.js` `positionEnabled`; config `enablePositionGuides` (`js/diagramly/Editor.js` `Editor.configure`) |
| Distance (equal-spacing) guides | Equal gaps between cells while moving | `mxGuide.distanceEnabled`; config `enableDistanceGuides` |
| Size guides | Match the sizes of other cells while resizing | `mxVertexHandler.prototype.sizeGuidesEnabled`, `snapEdges` (`Graph.js`); config `enableSizeGuides` |
| Angle guides | Snap edge segments and waypoints to 45° when the edge has no edgeStyle | `mxEdgeHandler.prototype.isAngleGuidesEnabledForEvent` (`Graph.js`) |
- Master toggle: action `guides` "Guides" (no shortcut). The Diagram tab also has a checkbox. Saved in the file as `guides="0|1"` (`Editor.js` `getGraphXml`).
- Holding Alt while moving turns guides off; Alt+Shift keeps them on (`Graph.js` `mxGuide.prototype.isEnabledForEvent`).
- When the ruler is visible, it marks the guide positions (`js/diagramly/mxRuler.js`, `mxGuide.prototype.move` override).

### Snapping
- Moves and resizes snap to the grid. Alt turns grid snapping off (`mxgraph/src/view/mxGraph.js` `isGridEnabledEvent`). Shift constrains to an axis or to proportional resize (`isConstrainedEvent`).
- Edge waypoints snap to off-grid terminals (`mxEdgeHandler.prototype.snapToTerminals = true`, `Graph.js`).
- `snapToPoint=1` style makes connections attach at the point instead of the perimeter. Used by the Waypoint shape (`js/grapheditor/Sidebar.js`) and listed as "Snap to Point" in `Editor.commonProperties` (`js/diagramly/Editor.js`).
- Hit tolerance becomes 12 px on touch devices (`Graph.js` ~L34144).

### Rulers and units
- Rulers: `mxDualRuler` adds horizontal and vertical rulers (`js/diagramly/mxRuler.js`). Toggle with action `ruler` "Ruler" in the View/Extras menu (`js/diagramly/Menus.js`). The setting is stored per user (`mxSettings.isRulerOn`). URL `ruler=1` forces it on `[flag:ruler]`. Rulers are hidden in the chromeless viewer unless it is editable (`js/diagramly/EditorUi.js` ~L19919).
- Right-clicking a ruler opens a popup menu to pick the unit (`mxDualRuler`, "Adds units context menu").
- Units: actions `points` "Points" (default; px-equivalent), `inches`, `millimeters`, `centimeters`, `meters` in the `units` submenu. The min, simple and sketch themes also show `pageScale` there (`js/diagramly/Menus.js` `this.put('units')`).
- The unit is a user setting (`mxSettings.setUnit`), not saved in the file. It affects ruler labels, Format geometry fields, grid size display, and `Editor.pageSizeUnit`.

### Zoom, navigation and fullscreen
| Action id | Label | Shortcut | Notes |
|---|---|---|---|
| `zoomIn` / `zoomOut` | Zoom In / Zoom Out | Ctrl + / Ctrl − / Ctrl+wheel | Uses fast "lazy" zoom when enabled (`Actions.js`) |
| `resetView` | Reset View | Enter / Home | Zoom 100% and reset scrollbars |
| `fitWindow` | Fit Window | Ctrl+Shift+H | With nothing selected it toggles keep-fitted mode (`ui.setFitWindowEnabled`) |
| `fitPage` / `fitTwoPages` / `fitPageWidth` | Fit Page / Two Pages / Fit Page Width | Ctrl+J / Ctrl+Shift+J / – | Turns on page view if it is off |
| `customZoom` | Custom... | Ctrl+0 | Asks for a zoom percentage |
| `zoomWheel` | Zoom with Mouse Wheel | – | `Graph.zoomWheel`. When on, the wheel zooms, Alt+wheel scrolls vertically and Shift+wheel scrolls horizontally. When off, Ctrl or Alt+wheel zooms. Trackpad pinch always zooms (`Graph.js` `isZoomWheelEvent`) |
| `fullscreen` | Fullscreen | – | Uses the browser Fullscreen API. Shown only when top-level and supported, or in inline embed (`[flag:embedInline]`) (`js/diagramly/Menus.js`) |
- `viewZoom` menu: Reset View, Fit Window, then 25/50/75/100/125/150/200/300/400%, Fit Page Width, Fit Page, Two Pages, Custom (`js/grapheditor/Menus.js`).
- Zoom stops: 5% to 16000% on a 5% grid. With model coordinates ("fine zoom") the stops below 100% go down to 1% (`Graph.prototype.getZoomSteps`).
- The simple and sketch themes have a zoom input in the footer (`js/diagramly/Simple.js` `createFooterMenuForTheme`, `createZoomInput`) `[theme:simple|sketch]`.
- Group navigation: `home` (Shift+Home), `exitGroup` (Ctrl+Shift+Home), `enterGroup` (Ctrl+Shift+End) (`Actions.js`).
- Outline-window wheel zoom is covered under Outline window.

### Page view and page setup
- `pageView` "Page View" toggles page view. It shows a page background and dashed page-break lines (`Editor.js` page-break rendering with `pageBreakColor`/`pageBreakDashed`). `graph.pageBreaksVisible` and `preferPageSize` follow `pageVisible`.
- `pageScale...` "Page Scale" opens a percentage prompt and applies `ChangePageSetup` (`Actions.js`).
- `pageSetup...` → `PageSetupDialog` (`js/grapheditor/Editor.js`):
  - Paper size. Formats from `PageSetupDialog.getFormats`: letter, legal, tabloid, executive, a0–a7, b4, b5, 16:9, 16:10, 4:3, plus custom. Portrait/landscape. Custom width/height in points, inches, mm, cm or m.
  - Grid size.
  - Background color and image: "Change..." opens `BackgroundImageDialog`.
  - Advanced section: Adaptive Colors (default/automatic/simple/none); Initial View ("Use Current" / "Reset" pins the page's opening pan and zoom via `ChangePageView`); Animation ("Edit" opens the page animation window, which plays in lightbox).
- `BackgroundImageDialog` (`js/diagramly/Dialogs.js`): takes an image URL or a dropped image, or another page of the file (`data:page/id,...`), plus width/height and optional color.
- Global shadow: model attribute `shadow` / `graph.shadowVisible`, a Diagram-tab option (`js/diagramly/Editor.js` `getGraphXml`).
- Attributes saved on `<mxGraphModel>`: `dx dy grid gridSize guides tooltips connect arrows fold page pageScale pageWidth pageHeight background backgroundImage math shadow adaptiveColors extFonts style` (`js/grapheditor/Editor.js` `getGraphXml`; `js/diagramly/Editor.js` override).

### Multiple pages
- Each page is a `DiagramPage` holding a `<diagram id name>` node. Page operations are undoable changes: `RenamePage`, `ChangePageId`, `ChangePageView`, `MovePage`, `SelectPage`, `ChangePage`, `ReplaceDiagram` (`js/diagramly/Pages.js`).

| Action id | Label | Shortcut | Source |
|---|---|---|---|
| `insertPage` | Insert Page | – | `js/diagramly/Menus.js` (`editorUi.insertPage`) |
| `duplicatePage` | Duplicate Page (`duplicateIt`) | – | names the copy "Copy of {name}" |
| `renamePage` | Rename Page... | double-click tab | `Pages.js` `addTabListeners` |
| `removePage` | Remove Page (`removeIt`) | – | |
| `movePage` (submenu) | Move | drag tab | lists target positions; tabs are draggable |
| `sortPages` | Sort Pages | – | alphabetical, `EditorUi.sortPages` |
| `previousPage` / `nextPage` | Previous / Next Page | Ctrl+Shift+PageUp / PageDown | wraps around (`Pages.js` `initPages`) |
| `pageTabs` | Page Tabs | – | shows or hides the tab bar (`setTabContainerVisible`) |
| "Delete All" | Delete All | – | item in the `pages` menu |
| "Open in New Window" | Open in New Window | – | page menu; `[web]` draw.io service only, not Electron/ChromeApp/embed |
- Tab bar: "+" tab inserts a page, a pages-menu tab lists all pages with a checkmark on the current one (tooltip shows name, index/count and id), left/right scroll tabs, and a right-click page menu (`createPageMenu`). Lightbox has prev/next page buttons (`js/grapheditor/EditorUi.js` ~L4053).
- Page links: `data:page/id,<id>` in cell links (`Graph.js` ~L5908). Image cells and backgrounds can render another page (`createImageForPageLink`, `getImageForPage`).
- State kept per page (`Graph.createViewState` in `Pages.js`): gridEnabled, gridSize, guidesEnabled, foldingEnabled, shadowVisible, pageVisible, background, backgroundImage, pageScale, pageFormat, tooltips, connect, arrows, mathEnabled, adaptiveColors, selectionCells, defaultParent, scrollbars, scale, hiddenTags, extFonts.
- Per-page extras: initial view box (`DiagramPage.getViewBox`) and an `animation` attribute on the page root.

### Layers
- Window: `layers` "Layers", Ctrl+Shift+L → `LayersWindow` (`js/grapheditor/Dialogs.js`).
- Per-layer row: visibility checkbox (Shift applies it to all checked layers), lock toggle `lockUnlock` (sets `locked=1` on the layer; Shift applies it to all checked layers), rename by double-click, drag to reorder, click to make it the current (default) layer. A dot marks the layer of the current selection.
- Footer: Add Layer (Shift inserts below), Delete, and a "More" menu. The menu offers, for multi-layer selection, Layers > Select All/None/Invert/Show/Hide/Lock/Unlock. For the current layer it offers Duplicate, Add Layer, Rename, Edit Data, To Front/To Back/Bring Forward/Send Backward, Select Objects in Layer, and Move Selection to ▸ (lists layers; locked layers are flagged).
- Layer drop targets accept drags from the sidebar and libraries (`'drop'` listener).
- Cells in a locked layer cannot be selected. Clicks pass through to cells below, except cells with links (`Graph.js` `isCellSelectable`, `updateMouseEvent`).
- Custom actions can target layers (`layers` selector in `getCellsForAction`, `js/diagramly/Editor.js`).
- No merge-layers function was found (unconfirmed: absent in `LayersWindow`).

### Tags
- `tags` attribute on cell values holds space-separated tags (`js/diagramly/Editor.js` `getTagsForCell`, `addTagsForCells`, `removeTagsForCells`).
- Window: `tags` "Tags", Ctrl+K → `TagsWindow` (`js/diagramly/Dialogs.js`) built on `Graph.createTagsDialog`.
- Per tag: show/hide toggle (Shift+click shows only that tag), select cells with the tag, click the name to toggle visibility, trash icon removes the tag from all cells, checkbox adds or removes the tag on the selection. Global controls: reset (show all) and Add (prompt; applies to the selection, or registers the tag when nothing is selected).
- Hidden tags (`graph.hiddenTags`, `setHiddenTags`, `toggleHiddenTag`) are part of the page view state. They are session-only: no file attribute was found.
- Custom action `tags: {toggle|show|hide: [...]}` (`executeCustomActions`).
- Also available in the viewer toolbar (`js/diagramly/GraphViewer.js`) and the simple-theme tags component (`EditorUi.js` ~L8099).

### Locking
- `lockUnlock` "Lock/Unlock", Ctrl+L, toggles `movable`, `resizable`, `rotatable`, `deletable`, `editable` and `connectable`, and sets `locked=1/0` (`Actions.js`).
- Effects of `locked=1` (inherited by descendants, `Graph.isCellLocked`): rubberband ignores the cell, the cursor is default, links stay clickable, and the cell cannot be a drop target or be connected (`Graph.js` ~L1494–1700, `isValidDropTarget`).
- Other individual style keys: `cloneable`, `bendable`, `selectable` (`mxgraph/src/util/mxConstants.js`, `mxGraph.isCell*`).
- Locked groups: `lockedGroup=1` stops descendants from being selected or dragged out. A lock-toggle handle shows when the key is defined (`lockedGroupIcon=0|1` overrides) (`Graph.js` `getLockedGroupAncestor`, ~L32331). Used for Mermaid-generated groups.

### Containers, groups and collapse/expand
- `group` (Ctrl+G): with one cell selected it sets `container=1`; otherwise it wraps the cells in a group cell with style `group`, plus `transparentBounds=1` when config `defaultTransparentGroups` is set (`Actions.js`, `Graph.createGroupCell`).
- `ungroup` (Ctrl+Shift+U) also clears `container` on cells left without children. `removeFromGroup` skips table rows and cells.
- Container rules: swimlanes are containers unless `container=0`; other shapes need `container=1` (`Graph.isContainer`). `dropTarget=0` blocks dropping. `part=1` cells are not drop targets unless they are containers. Lanes cannot be dropped into lanes. Alt-drag ignores drop targets (`isValidDropTarget`).
- `expand=0` stops children from growing the parent (`isExtendParent`).
- Selection: the first click selects the group, the next click selects the child. Swimlanes select the clicked child directly. `transparentBounds` groups pass clicks through (`mxGraphHandler.isPropagateSelectionCell`).
- Folding:
  - `collapseExpand` "Collapse/Expand" turns folding on or off for the diagram (file attribute `fold`).
  - `collapse` (Ctrl+Home) and `expand` (Ctrl+End) act on the selection.
  - `collapsible` toggles the style key. Containers fold by default; other cells fold only with `collapsible=1` (`Graph.js` ~L16868).
  - Collapsed size is kept in `alternateBounds`.
- Tree containers, mind maps and childLayout are covered in Section 6.

### Connection creation (summary; affordances in Section 2)
- `connectionArrows` "Connection Arrows" (Alt+Shift+A) and `connectionPoints` "Connection Points" (Alt+Shift+O) are toggles (`Actions.js`). Saved in the file as `arrows` and `connect`.
- Connection preview is live and uses the default edge style (`mxConnectionHandler.livePreview`). Ctrl/Cmd-drag from a shape clones the source as the target (`isCreateTarget` with `isCloneEvent`).
- Outline connect: Alt inside a shape, or a 1500 ms touch hold, connects to the outline. Style `outlineConnect=0|1|2|3` controls this (`Graph.js` ~L1340).
- New-edge length from hover arrows is `Graph.defaultEdgeLength = 80`.

### Duplicate, paste offsets, copy/paste style and data
- `duplicate` (Ctrl+D) offsets the copy by `gridSize` (`Graph.duplicateCells`). Ctrl+Enter runs `ui.ctrlEnter()`, which duplicates (`js/grapheditor/EditorUi.js` key handler).
- Pasting the same content again offsets by `pasteCounter * gridSize` (`js/diagramly/EditorUi.js` ~L23986). `pasteHere` pastes at the context-menu point.
- `copyStyle` / `pasteStyle` (Alt+Shift+Q / Alt+Shift+W via `altShiftActions`) and `copyTextStyle` / `pasteTextStyle` are in the context menu (`js/diagramly/Menus.js`, `EditorUi.js` ~L19443).
- `copySize` (Alt+Shift+F), `pasteSize` (Alt+Shift+V), `copyData` (Alt+Shift+B), `pasteData` (Alt+Shift+E) (`Actions.js`).
- Default style: `setAsDefaultStyle` (Ctrl+Shift+D), `clearDefaultStyle` (Ctrl+Shift+R), `setAsDefaultForNewConnections`, `clearDefaultForNewConnections` (`Actions.js`).

### Custom data and placeholders
- Cell values become XML `UserObject` elements with attributes. Reserved names: `label`, `id`, `placeholders` (`Graph.reservedDataNames`). Built-in properties: `label`, `tooltip`, `placeholders`, `placeholder`, `note` (`Graph.prototype.builtInProperties`).
- `editData...` "Edit Data", Ctrl+M → `EditDataDialog` (`js/grapheditor/Dialogs.js`):
  - Shows and edits the ID (`ChangeCellId`; page IDs via `ChangePageId`, uniqueness checked).
  - Add Property (validated XML name), delete, and multi-cell editing ("Multiple values").
  - Placeholders checkbox and an edit-link shortcut.
  - Export writes the data as `data.json` (`getDataForCells`).
  - With no selection it edits the page root (page-level data).
- `placeholders=1` turns on `%name%` substitution in labels and tooltips (`Graph.replacePlaceholders`, pattern `%(date\{.*\}|[^%\{\}"'=;]+)%`). `%%` escapes.
- Lookup order: attributes on the cell, then its ancestors (layer, then page root), then global variables, then export variables.
- Built-in variables:

| Variable | Value | Source |
|---|---|---|
| `%id%` | cell id | `replacePlaceholders` |
| `%width%`, `%height%` (+`_mm`, `_cm`, `_in`, `_m`, `_current`) | vertex size in a unit | same |
| `%length%` (+unit suffix) | length of the ancestor edge | same |
| `%date%`, `%time%`, `%timestamp%`, `%date{mask}%` | locale date/time, formatted date | `Graph.getGlobalVariable`, `formatDate` |
| `%page%`, `%pagenumber%`, `%pagecount%`, `%pagenumber+N%`, `%pagecount-N%` | page name, index and count | `js/diagramly/EditorUi.js` ~L19618, `replacePlaceholders` |
| `%filename%` | current file title | `EditorUi.js` ~L19625 |
| config `globalVars` | custom globals | `js/diagramly/Editor.js` `Editor.globalVars` |
- `%label%` and `%tooltip%` are never substituted.

### Tooltips and notes
- `editTooltip...` (Alt+Shift+T) stores the `tooltip` attribute. Per-language variants use `tooltip_<lang>`. Placeholders are resolved when `placeholders=1` (`Graph.convertValueToTooltip`).
- With no tooltip, hovering shows the cell's custom properties, plus the link when in a locked layer or read-only (`Graph.getTooltipForCell`).
- `tooltips` "Tooltips" toggles tooltips (file attribute `tooltips`). URL `tooltips=0` hides them entirely `[flag:tooltips]`.
- `tooltipCell=1` style marks a cell as the tooltip carrier for its group (`Graph.isTooltipCell`).
- Notes: `editNote...` (Alt+Shift+N) stores a Markdown `note` attribute. A note icon appears at the cell's bottom-left (`Graph.showNoteIcons`). Clicking it opens a box with the rendered, sanitized note and an Edit button (`Graph.createNoteOverlay`, `showNoteBox`).

### Links and custom link actions
- `editLink...` (Alt+Shift+L) → `LinkDialog` (`js/diagramly/Dialogs.js`). It offers three kinds of link:
  - URL. Optional "Open in New Window" sets `linkTarget=_blank`. Pickers for Google Drive `[drive]`, Dropbox `[dropbox]` and OneDrive `[onedrive]`.
  - Page (`data:page/id,...`).
  - Custom action (`data:action/json,...`), edited in `CustomActionDialog` or the animation step editor.
- `openLink` follows the link. Link policy comes from URL `target` (`auto|self|blank|frame`) via `Graph.linkPolicy` / `linkTarget`. `mailto:` never opens a new window (`Graph.isExternalProtocol`).
- In edit mode, selecting a linked cell shows a link hint (`Graph.js` `linkHint`).
- Custom actions JSON `{actions:[...]}` run in sequence (`js/diagramly/Editor.js` `Graph.handleCustomLink`, `executeCustomActions`). Action types:

| Group | Keys |
|---|---|
| Navigation | `open` (URL or `data:` link), `page` (`next`/`previous`), `scroll` (with `smooth`), `viewbox`, `explore` |
| Visibility | `toggle`, `show`, `hide`, `tags` (`toggle`/`show`/`hide`) |
| Selection / emphasis | `select`, `highlight` |
| Style | `style` (key/value), `toggleStyle` |
| Effects | `opacity`, `fadeIn`, `fadeOut`, `fadeTo`, `wipeIn`, `wipeOut`, `popIn`, `popOut`, `flow` |
| Timing | `wait`; `animation: {steps:[...]}` wrapper is flattened (`Graph.flattenAnimationActions`) |
- Selectors: `cells`, `tags`, `layers`, `excludeCells` (`getCellsForAction`). When cells are copied, link references are remapped (`updateCustomLinkActions`).
- `explore` action / `Graph.exploreFromCell` opens a neighborhood explorer (`Actions.js` `explore`).

### Animations
- Edge flow animation: style `flowAnimation=1`. Options in Edit Style or the property list (`js/diagramly/Editor.js` `commonEdgeProperties`):
  - `flowAnimationDuration` (default 500 ms)
  - `flowAnimationTimingFunction`: linear, ease, ease-in, ease-out, ease-in-out
  - `flowAnimationDirection`: normal, reverse, alternate, alternate-reverse
  - Applies to edges only (`mxShape.isFlowAnimationEnabled`).
- `animations` "Flow Animations" toggle turns animation playback on or off (`Editor.enableAnimations` → `graph.enableFlowAnimation`). Also config `enableAnimations`.
- Page animation: `animation` "Animation" window → `AnimationDialog`, a non-modal step editor (`js/diagramly/Dialogs.js`). Steps use the custom-action vocabulary. The script is stored as JSON in the page root's `animation` attribute and plays automatically in lightbox (`Editor.AnimationPlayer`). The same editor builds link "effects".
- Animated export is covered in Section 8 (`exportAnimatedGif`, `js/diagramly/gif/`).

### Math typesetting
- `mathematicalTypesetting` "Mathematical Typesetting" toggles `mathEnabled` per diagram via `ChangePageSetup`. Saved in the file as `math`. URL `math=1` `[flag:math]` (`js/diagramly/Menus.js`, `js/diagramly/Editor.js` `setGraphXml`).
- Engine: MathJax bundle `math4/es5/drawio-mathjax.min.js`, loaded lazily (`Editor.initMath`).
  - Inputs: TeX and AsciiMath (`input/tex`, `input/asciimath`, `[tex]/html`). Output: SVG with font `mathjax-tex`.
  - Inline line-breaking is disabled.
  - Delimiters (`Editor.containsMath`): `$$…$$`, `\(…\)`, `\[…\]`, `\begin{…}`, and backticks for AsciiMath. These are MathJax defaults; no custom `inlineMath` config was found.
- Autosized cells are measured after typesetting (`getPreferredSizeForCell` override, `updateMathCellSizes`). The class `geDisableMathJax` opts a node out.

### Freehand
- `insertFreehand` "Freehand", key X (`js/diagramly/EditorUi.js` ~L19753), opens `FreehandWindow` and starts or stops drawing (`js/diagramly/Menus.js`, `js/diagramly/Dialogs.js`). Esc stops.
- Controls: Brush checkbox (perfect-freehand pressure mode vs smoothed polyline), color swatches including black-and-white, settings for Smoothing (1–20), a brush-size slider, and a Start/Stop Drawing button (`FreehandWindow`).
- Output is an inline stencil shape (`shape=stencil(...)`):
  - Brush mode adds `lineShape=1` and a filled stroke outline.
  - Plain mode uses `fillColor=none` with a smoothed path.
  - Settings also cover closed path / auto-close, open fill, auto insert, auto scroll and select-inserted (`js/diagramly/mxFreehand.js`).
- Library: `js/freehand/perfect-freehand.js`.

### Sketch style and fill patterns
- Per-shape `sketch=1` renders with rough.js (`Editor.createRoughCanvas`, `mxShape.createHandJiggle`).
- `sketchStyle`: `rough` (default) or `comic` (HandJiggle).
- Rough keys mapped (`js/diagramly/Editor.js` ~L1770): `jiggle` (→ roughness, default 2), `curveFitting` (default 1), `bowing`, `hachureAngle`, `hachureGap` (`auto` = -1), `fillWeight`, `dashGap`, `dashOffset`, `zigzagOffset`, `simplification`, `disableMultiStroke`, `disableMultiStrokeFill`.
- `fillStyle` options:

| List | Values | Source |
|---|---|---|
| Sketch (`Editor.roughFillStyles`) | auto, hachure, solid, zigzag, cross-hatch, dashed, zigzag-line (`dots` falls back to auto for performance) | `js/grapheditor/Editor.js` |
| Normal (`Editor.fillStyles`) | auto, hatch, solid, dots, cross-hatch, dashed, zigzag-line; drawn as SVG patterns | `js/grapheditor/Editor.js`, `mxgraph/src/util/mxSvgCanvas2D.js` `createFillPatternId` |
- Global sketch mode: the Diagram-tab "Sketch" checkbox calls `ui.setSketchMode`, saved per user as `mxSettings.sketchMode` (`Format.js` ~L8139, `EditorUi.js` `setSketchMode`). It adds `sketch=1`, `curveFitting`, `jiggle` and `hachureGap=4` to the default vertex and edge styles, plus the Architects Daughter font (`Editor.sketchFontFamily`).
- URL `rough=1` `[flag:rough]`. The sketch UI theme also changes the default edge style: curved, `endArrow=open`, sizes 14, perimeter spacing 8.

### Dark mode and adaptive colors
- Appearance submenu (`js/diagramly/Menus.js` `appearance`):
  - `autoMode` "Automatic" (follows `prefers-color-scheme`; only shown when supported)
  - `lightMode` "Light"
  - `darkMode` "Dark"
  - `highContrast` "High Contrast"
  - Saved per user (`mxSettings.settings.darkMode`, `EditorUi.setAndPersistDarkMode`).
- `Editor.isDarkMode()`. Dark canvas color is `Editor.darkColor = #121212`. Legacy `ui=dark` maps to the kennedy theme plus dark mode (`js/diagramly/Init.js`).
- Colors can be `light-dark(light,dark)` pairs. ColorDialog has a dark-variant picker (`js/grapheditor/Dialogs.js` ~L808).
- Per-diagram `adaptiveColors`:
  - `default` (falls back to `Graph.defaultAdaptiveColors`, which is `auto`, or `simple` when URL `contrast=0`)
  - `auto`, `simple`, `none`
  - Set from the Extras submenu `adaptiveColors` (`defaultAdaptiveColors`, `automaticAdaptiveColors`, `simpleAdaptiveColors`, `noAdaptiveColors`) or Page Setup. Saved in the file as `adaptiveColors`.
- `adaptiveColors` window (Ctrl+Shift+6) → `AdaptiveColorsWindow`: "Remove User-defined" dark colors for the selection or all cells, with Background and Labels checkboxes (`js/diagramly/Dialogs.js`).
- High contrast: forced-colors stylesheet `styles/high-contrast.css`. It turns on automatically for `prefers-contrast: more` unless the user set it (`EditorUi.js` ~L20355, ~L23022).

### UI themes
| Theme id | Label | What changes | Source |
|---|---|---|---|
| `kennedy` | Classic | Menubar, toolbar, docked sidebar and format panel (`geClassic` CSS) | `js/diagramly/Simple.js` `switchCssForTheme` |
| `simple` | Simple | Compact header menu, floating picker toolbar (text A, rectangle D, ellipse F, note S, line C, freehand X, shapes, insert), footer (pages, undo/redo, delete, zoom input, fullscreen, exit) | `Simple.js` `createMainMenuForTheme`, `createPickerMenuForTheme`, `createFooterMenuForTheme` |
| `sketch` | Sketch | Like simple, with floating Format and Shapes windows (`createFormatWindow`, `createShapesWindow`), sketch fonts and default styles | `Simple.js`, `js/diagramly/EditorUi.js` `switchTheme` |
| `min` | Minimal | Minimal chrome with dockable or floating windows (`EditorUi.windowed`, URL `windows=0` turns them off) | `js/diagramly/Minimal.js` `initMinimalTheme` |
| `atlas` | Atlas | Atlassian-styled chrome (`geAtlas` body class); App also uses `atlas` as a mode for the Confluence/Jira hosts | `Simple.js`, `js/diagramly/EditorUi.js` ~L20393, `js/diagramly/App.js` `MODE_ATLAS` |
| `dark` (legacy) | – | Redirected to kennedy + dark mode | `js/diagramly/Init.js` |
- Theme menu: Automatic (simple on screens ≤1024 px or touch/mobile, otherwise kennedy; `App.isSimpleThemePreferred`), Classic, then `Editor.themes`.
- Source of the theme: URL `ui`, then `.drawio-config` in localStorage. MS Teams / `extAuth=1` default to sketch (`Init.js` `uiTheme`).
- Switching between classic and simple happens live. Other switches restart (`doSetCurrentTheme`). The menu is hidden in embed mode unless `themes=1` `[embed]`.

### Find and replace
- `findReplace`, Ctrl+F, calls `showSearchWindow` (`js/diagramly/Menus.js`, `js/diagramly/EditorUi.js`). It opens `FindWindow` with replace when editable; Shift+click opens find-only. The label is "Find/Replace" ("Find" when read-only), built at runtime from the `find` and `replace` strings (`js/diagramly/EditorUi.js` `updateActionStates`).
- Options: Regular Expression and All Pages checkboxes. Matching is always case-insensitive (lowercased). There is no whole-word or match-case option (none found in `FindWindow`).
- Searches label text (HTML stripped), exact cell IDs (regex matches IDs partially), and all non-label attributes (metadata). It expands collapsed ancestors to reveal matches and shows a match count.
- Buttons: Find (Enter), previous (Shift+Enter), Reset, Replace/Find, Replace, and Replace All (with a safeguard limit and a "{n} matches replaced" notice), Close (`js/diagramly/Dialogs.js` `FindWindow`).

### Outline window
- `outline` "Outline", Ctrl+Shift+O → `OutlineWindow` (`mxOutline`) (`js/grapheditor/Dialogs.js`). Drag the viewport rectangle to pan; mouse wheel or pinch inside it zooms; it fits on show.

### Scratchpad
- `scratchpad` "Scratchpad" toggles the `L.scratchpad` library in the sidebar (`EditorUi.toggleScratchpad`). It is stored in browser storage as `.scratchpad` (`StorageFile`) and synced across tabs with BroadcastChannel `drawio-scratchpad` (`js/diagramly/EditorUi.js` ~L5068–5160).
- Requires local storage or the ChromeApp (`isScratchpadEnabled`) `[flag:localStorage]`.
- `addToScratchpad` "Add to Scratchpad" adds the selection. Library editing is shared with custom libraries (`showLibraryDialog`).

### Inline toolbar (edges)
- Floating toolbar at the edge midpoint when exactly one unlocked edge is selected and the graph is editable (`js/grapheditor/InlineToolbar.js` `updateSelection`). Config `enableInlineToolbar` (default on) `[flag:enableInlineToolbar]`.
- Three buttons with popovers:
  - Line: solid/dashed/dotted, stroke color, fill/gradient (`showLineStyleMenu`).
  - Line end: start/end markers (`showLineEndMenu`, `showMarkerSubPanel`).
  - Connection: straight, orthogonal, curved, isometric, entity-relation, sequence diagram, horizontal/vertical, rounded/sharp, and edge shapes link, arrow, simpleArrow, taperedArrow, filledEdge, pipe, wire. Includes "libavoid auto route" when available (`showConnStyleMenu`).

### Print
- `print...` → `PrintDialog` (`js/diagramly/Editor.js` `PrintDialog.prototype.create`; base in `js/grapheditor/Editor.js`):
  - All pages or a page range from–to, with a "Current Page" button. Selection Only. Page View. Crop.
  - Fit to N sheets across by M sheets down (poster), or Zoom %. Border width.
  - Grid, Shadows, Transparent Background.
  - Preview and Print buttons.
- Placeholders `%pagenumber%` and `%pagecount%` are resolved per printed page.

### Undo/redo
- `undo` (Ctrl+Z) and `redo` (Ctrl+Shift+Z, or Ctrl+Y on Windows). `mxUndoManager` keeps 100 steps by default. Undo and redo restore the selection for the changed cells (`js/grapheditor/Editor.js` ~L1651). Page operations are undoable model changes (`Pages.js`).
- File revision history is covered in Section 9.

### Accessibility
- Keyboard selection (`js/grapheditor/EditorUi.js` key handler):
  - Tab / Shift+Tab: next or previous cell (`selectCell`).
  - Alt+Tab: parent (`selectParentCell`).
  - While editing: Tab inserts a tab or indents list items; Shift+Tab applies the edit.
  - Arrow keys move or resize (Section 2). F2/Enter edits.
  - Most actions have shortcuts. `keyboardShortcuts...` shows `shortcuts.svg` in a dialog or new window (`js/diagramly/Menus.js`).
- Appearance: High Contrast mode and forced-colors stylesheet, dark mode, and adaptive colors (above).
- ARIA: present only in the Drive Home dialog (`js/diagramly/HomeDialog.js`: `aria-label`, `role=navigation`, `aria-live`, `aria-current`, `aria-busy`) and as `aria-invalid` in ConfigEditor. The canvas, menus, sidebar and format panel have no ARIA roles or labels and no screen-reader output. This is an absence based on grep of `js/grapheditor`, `js/diagramly` and `mxgraph/src`.
- No UI right-to-left mirroring was found (unconfirmed: absence). Labels support `textDirection` (Section 3).

### Internationalization
- UI languages: 42 in `mxLanguageMap` (`js/diagramly/Init.js`), plus an `i18n` pseudo key. Chosen in the `language` submenu, saved per user (`EditorUi.setAndPersistLanguage`). Strings live in `resources/dia*.txt`.
- Diagram translation: labels and tooltips can carry `label_<lang>` / `tooltip_<lang>` attributes. The `diagramLanguage` submenu has `languageCode...` "Language Code" and Disabled (`Graph.translateDiagram`, `Graph.diagramLanguage`). URL `translate-diagram=1` and `diagram-language=xx` `[flag:translate-diagram]` (`js/grapheditor/Graph.js` ~L1797, `js/diagramly/Menus.js` ~L2102).

Counts: behavior_topics=30 (the `###` subsections above), languages=42 (`mxLanguageMap` entries excluding the `i18n` key), custom_link_action_types=23 (keys handled in `executeCustomActions`: open, page, wait, opacity, fadeIn, fadeOut, fadeTo, flow, wipeIn, wipeOut, popIn, popOut, toggle, show, hide, toggleStyle, style, select, highlight, scroll, viewbox, tags, explore; the `animation.steps` wrapper is not counted), sketch_fill_styles=7 (`Editor.roughFillStyles`; normal mode `Editor.fillStyles` also has 7, with hatch and dots instead of hachure and zigzag), themes=5 (kennedy/Classic, simple, sketch, atlas, min; the "Automatic" menu entry picks simple or kennedy, and legacy `dark` redirects to kennedy, so neither is counted).

### Templates

Sources: `js/diagramly/Dialogs.js` `NewDialog` (L2220-4200), `js/diagramly/App.js` `openTemplateDialog` (L4652), `searchTemplates`, `loadTemplate` (L6007), `js/diagramly/Menus.js` actions `new...` (L233) and `insertTemplate` (L257), `templates/index.xml`, `EditorUi.templateFile` (`js/diagramly/EditorUi.js` L189), `TEMPLATE_PATH` (`js/diagramly/Init.js` L70).

Entry points

| Entry | Action / trigger | Notes |
|---|---|---|
| File > New... | `new` | NewDialog in create mode (filename field + Create). Compact variant (name only) when offline. |
| Insert > Template... | `insertTemplate` (label "Template...") | NewDialog in insert mode (button "Insert"), inserts at free insert point. Disabled if default layer locked. |
| Splash / startup new-file flow | `App.showSplash` -> NewDialog | Cancel with no file re-shows splash. |
| Embed host request | message `{action:'template'}` | `[embed]` see Embed mode. |
| URL | `template-filename` | Filter name used by `App.loadTemplate`. |

NewDialog features

- Left category list, right thumbnail grid; thumbnails are `TEMPLATE_PATH/<name>.png` next to each XML.
- Magnifier icon per tile: full preview ("Preview") before choosing.
- First tile "Blank Diagram" (`blankDiagram`), omitted when `noBlank`.
- Template search box: local tag index built from `tags` attribute in index.xml plus custom template titles (`filterTemplates`, `NewDialog.tagsList`). Not a server search.
- Filename / "Diagram name" input, label depends on storage mode.
- Templates carry `libs="general;uml"`: choosing one also opens those sidebar libraries. Custom library bundles defined in index.xml `<clibs name>`: `azure` (23 URL libraries), `fortinet` (18 URL libraries).
- "From Text" category (`showFromText`, Dialogs.js L3500): tiles Mermaid (`mermaid`, if `EditorUi.isMermaidSupported()`), SQL (`formatSql`), CSV (`csv`), PlantUML (`plantUml`), Text (`fromText`); each shown only if its action exists.
- "Generate" tile in Basic (`type:'generative'`) when `Editor.enableAi && isExternalDataComms() && service=='draw.io' && mermaid supported` (L3491).
- Embed/host-only tabs: recent docs, search docs, open external doc, custom templates callback (`recentDocsCallback`, `searchDocsCallback`, `openExtDocCallback`, `customTempCallback`) `[embed]` (used by Confluence/Jira hosts, `[conf]` unconfirmed: host code not in repo).
- Config: `templateFile` (alternate index.xml URL), `enabledTemplateSections` (category whitelist), `customTemplates` (extra entries) (Editor.js `Editor.configure`).

Built-in categories (`templates/index.xml`, counted `<template url="<cat>/...">`; label = dia.txt key, fallback capitalised key)

| Category id | Label | Templates |
|---|---|---|
| basic | Basic | 10 |
| business | Business | 15 |
| charts | Charts | 6 |
| cloud | Cloud | 41 |
| engineering | Engineering | 3 |
| flowcharts | Flowcharts | 9 |
| layout | Layout | 4 |
| maps | Maps | 5 |
| network | Network | 13 |
| other | Other | 12 |
| software | Software | 12 |
| tables | Tables | 4 |
| uml | UML | 8 |
| venn | Venn (no dia.txt key; capitalised fallback, Dialogs.js L3750) | 8 |
| wireframes | Wireframes | 5 |

AI generation (Generate / Smart Template)

| Item | Detail | Source |
|---|---|---|
| Action `generate` (label "Generate") | Toggles `ChatWindow` (chat-style AI window) or `openGenerateDialog`. Listed in Insert menu as `['-','insertFreehand','generate','-']`. | Menus.js L1380-1420, L4532; App.js `openGenerateDialog` L4587; Dialogs.js `ChatWindow` L10821 |
| Gating | `[desktop]` unless `enableAi`/`enableChatGpt` false in config; web: `Editor.enableAi` (default true only on app.diagrams.net, test.draw.io, preprod.diagrams.net) or Atlassian hosts ac/aj.draw.io (shows "AI features require admin approval" until enabled `[conf]`); plus not offline, `aiActions` non-empty, `isExternalDataComms()`, service name draw.io, Mermaid supported. | Menus.js L1380; Editor.js L393 |
| Smart template URL | `?smart-template=<prompt>` generates a diagram on startup (`generateOpenAiMermaidDiagram`, complexity high). Label key `smartTemplate=Smart Template`. | App.js L4187, L4546 |
| AI actions | `createPublic` (hosted draw.io service, prompt limit `Editor.maxPublicPromptLength`=10000 chars), `create`, `update` (edit current diagram XML, keep ids), `assist` (help). | Editor.js L400, L431 |
| Providers | `aiConfigs`: `gpt` (OpenAI chat completions), `gemini`, `claude`. Models list `aiModels`: Claude 4.8 Opus, Claude 4.6 Opus, Gemini 3 Pro Preview, Gemini 2.5 Pro, GPT-5.1, GPT-4.1. | Editor.js L461, L516 |
| Keys | BYO keys `gptApiKey`, `geminiApiKey`, `claudeApiKey`, `gptUrl` are configuration-only (never URL params); endpoints on draw.io/diagrams.net hosts rejected (`Editor.isAllowedAiEndpoint`). | Editor.js L401-545 |
| Output | Mermaid or draw.io XML; Mermaid converted to native cells. | Editor.js `aiGlobals.create` |

### Plugins

Sources: `js/diagramly/App.js` `App.pluginRegistry` (L331), `App.publicPlugin` (L347), `App.loadPlugins` (L1867), `App.initPluginCallback` (`window.Draw.loadPlugin`), plugin loading in `App.main` (L1192-1270), `App.retiredPlugins` (L940); `js/diagramly/Dialogs.js` `PluginsDialog` (L17347); `js/diagramly/Menus.js` action `plugins...` (L3177); `js/diagramly/ElectronApp.js` (L234-308, L825).

Registry (`?p=<id>`; "Public" = listed in Plugins dialog picker)

| id | File | Public | What it does |
|---|---|---|---|
| ex, 4xAKTrabTpTzahoLthkwPNUn | plugins/explore.js | yes (ex) | Context menu "Explore from here..." (`exploreFromHere`) on cells with edges: neighbourhood explorer (`Graph.exploreFromCell`). |
| svgdata | plugins/svgdata.js | yes | Legacy SVG export with rich per-cell metadata attributes (core has newer `data-meta-*` mode). |
| number | plugins/number.js | yes | Adds "Numbered" bool property; auto-numbers vertices with a number badge. |
| sql | plugins/sql.js | yes | Insert > "From SQL" (`fromSql`): parse `CREATE TABLE` into ER tables. |
| props | plugins/props.js | yes | Floating "Data" window showing selected cell properties; Extras > "Extract Data" (`extractData`). |
| text | plugins/text.js | yes | Extras > "Extract Text" (`extractText`). |
| anim | plugins/animation.js | yes | Re-exposes legacy Extras > "Animation" item; engine is core (`Editor.AnimationPlayer`, `AnimationDialog`). |
| update | plugins/update.js | yes | Periodically POSTs page XML to `updateUrl` (diagram metadata or `update-url`/`update-interval` URL params) and applies returned updates (live data). |
| trees | plugins/trees/trees.js | yes | Mind-map/tree helpers: context menu Select Children/Subtree/Siblings/Parent, subtree move. |
| import | plugins/import.js | no (commented out) | Freemind import (`importFreemind`, File > Import from). |
| replay | plugins/replay.js | yes | Extras > Record / Replay of editing steps into a replay URL. |
| anon | plugins/anonymize.js | yes | Extras > "Anonymize Current Page" (`anonymizeCurrentPage`): scrambles label text. |
| webcola | plugins/webcola/webcola.js | yes | Arrange > Layout > "WebCola Layout..." (`webColaLayout`); deprecated in favour of ELK layouts. |
| tags | plugins/tags.js | yes | Extras > "Hidden Tags" (`hiddenTags`): set tags, toggle hidden tags (legacy; tags are now core). |
| rnd | plugins/random.js | no (commented out) | Test helpers: Random Label, Reorder/Swap/Place children. |
| page | plugins/page.js | no (commented out) | Extras > "Reorder pages...", "Place pages...". |
| tr | plugins/trello.js | no | Trello Power-Up embed glue (card/filename/template params) `[trello]` `[embed]`. |
| f5 | plugins/rackF5.js | no | F5 BIG-IP rack shapes (mxShape subclasses). |
| nxtcld | plugins/nextcloud.js | no | Nextcloud embed integration `[embed]`. |
| ac, acj, ac148, ac148cmnt | plugins/connect.js, connectJira.js, cConf-1-4-8.js, cConf-comments.js | no | Confluence/Jira Cloud integration and comments `[conf]` (files not in this repo; unconfirmed behaviour). |
| monday | plugins/monday.js | no | monday.com integration (file not in this repo; unconfirmed). |

Unregistered files in `plugins/`: `edgeConnection.js` (dropping an edge end in free space creates a small black join circle), `flow.js` (context menu "Toggle Flow..." edge flow animation). Loadable only via settings path when custom plugins are allowed (web) or from `./plugins/` on desktop.

Retired: `tips` / `plugins/tooltips.js` -> enables built-in tooltip icons (`App.retiredPlugins`).

Loading

| Mechanism | Detail | Tags |
|---|---|---|
| `?p=id1;id2` | Loads registry entries from `PLUGINS_BASE_PATH`. | `[web]` |
| Extras > Plugins... (`plugins`) | `PluginsDialog`: list installed, add from public registry dropdown, "Custom..." URL (only if `ALLOW_CUSTOM_PLUGINS`), remove; stored in `mxSettings.plugins`; restart required. | hidden when `plugins=0` |
| Stored plugins (`mxSettings.settings.plugins`) | Web: same-domain only, and must be built-in unless `ALLOW_CUSTOM_PLUGINS` (default false, Init.js L75). | `[web]` |
| Desktop | Only `./plugins/` built-ins shipped with the app, `..` rejected; web plugin loading disabled (`urlParams['plugins']='0'`); own Plugins dialog (ElectronApp.js L825) picks from registry. | `[desktop]` |
| Disabled when | `plugins=0`, `offline=1`, `embedInline=1`, se.diagrams.net. | |
| Plugin API | `Draw.loadPlugin(function(ui){...})` receives the `EditorUi`. | |

### Embed mode

Sources: `js/diagramly/EditorUi.js` `installMessageHandler` (L27390-28990), `initializeEmbedMode` (L26311), `createLoadMessage` (L26579), `sendEmbeddedSvgExport` (L26602), `createEmbedButton` (L29105), `installPassThroughKeys` (L27226), `remoteInvokableFns` (L31656); `js/diagramly/Menus.js` embed `save`/`saveAndExit`/`exit` (L3238-3330); `js/diagramly/App.js` configure handshake (L1690-1745), `create=` hash (L6620), `initializeViewerMode` (L1958); `js/diagramly/Init.js` (L264-292). `js/diagramly/Embed.js` and `js/embed.dev.js` are the separate legacy "embed script" that renders read-only diagrams in host HTML pages (`mxClientOnLoad`/`mxClientOnCreate` callbacks), not the iframe protocol.

Protocols

- Legacy (default): host posts raw XML string (also PNG data URI, SVG data URI, URL-encoded or compressed XML; `extractDiagramXml`). App posts `'ready'` (or `?ready=<string>`) on start, posts XML on Save, `''` on Exit.
- JSON (`proto=json`): JSON messages `{action:...}` in, `{event:...}` out. Unknown action -> `{error:'unknownMessage'}`.
- Configure handshake (`configure=1`, only with `embed=1`): app posts `{event:'configure'}`, waits for `{action:'configure', config:{...}, colorSchemeMeta}` and calls `Editor.configure` before starting.
- Embed UI: top-right buttons Save, Save & Exit (or "Publish" with `publishClose=1`), Exit/Close; title via `title` load option. Save As disabled.
- Inline embed (`embedInline=1`): forces embed+sketch UI+json+no plugins+page view off; Escape = exit; resizable inline frame emitting `resize`.

Host -> app actions (`proto=json`)

| Action | Meaning / key fields |
|---|---|
| load | Load diagram: `xml`, `xmlpng`, or `descriptor` (`{format:'mermaid'\|'plantuml', data, image, wrap, version}`); options `autosave`, `modified`, `saveAndExit`, `noSaveBtn`, `noExitBtn`, `title`, `libs`, `toSketch`, `rough`, `dark`, `theme`, `background`, `border`, `scale`, `scaleBorder`, `fit`, `maxFitScale`, `minWidth`, `minHeight`, `viewport`, `viewbox`, `scroll`, `rect`, `layout`, `zoomEvents`, `diffSync` (`{patchOnly}`), `exportProtocol`, `sourceMetadata` |
| merge | Merge `xml` into current file; replies `merge` (with `error` on failure) |
| patch | Apply diff `patch` (with optional `checksum`); replies `patch` |
| getDiff | Reply with patch since last shadow copy + checksum (or full xml) |
| resetDiff | Reset diff shadow (optionally to `xml`); replies `resetDiff` |
| export | Export `format`: `png`, `xmlpng`, `svg` (default), `xmlsvg`, `html`, `html2`, `xml`, `json`; options `xml`, `scale`, `border`, `width`, `background`, `transparent`, `shadow`, `grid`, `theme`, `keepTheme`, `layerIds`, `pageId`, `currentPage`, `allPages`, `selection`, `size`, `embedImages`, `embedFonts`, `embedCellMetadata`, `includeData`, `compressed`, `asText`, `withSvg`, `spin`/`spinKey` |
| snapshot | Send embedded SVG export without exiting |
| status | Set status text (`message`/`messageKey`) and `modified` flag |
| spinner | Show/hide spinner (`show`, `message`/`messageKey`) |
| dialog | Show message dialog (`title(Key)`, `message(Key)`, `button(Key)`, `modified`) |
| prompt | Show text prompt; replies `prompt` (value) or `prompt-cancel` |
| draft | Show DraftDialog for `xml`/`name`; replies `draft` with `result` edit/discard/ignore |
| template | Show NewDialog; options `callback`, `templatesOnly`, `withoutType`, `enableRecent`, `enableSearch`, `enableCustomTemp`; replies `template` |
| layout | Run layout spec(s) `layouts` (preset names, `libavoid`, custom arrays); replies `layout` |
| fit | Fit diagram (`border`, `maxScale`); replies `fit` |
| viewbox | Set visible region; replies `viewbox` |
| viewport | Set embed viewport rectangle |
| fullscreenChanged | Inline mode fullscreen state (`value`) |
| textContent | Reply with diagram text content |
| invokeAction | Run any registered action by `actionName` |
| resetEditor | Stop editing, close menus, clear selection |
| exit | Trigger Exit |
| remoteInvoke / remoteInvokeReady / remoteInvokeResponse | RPC to `remoteInvokableFns`: `getDiagramTextContent`; `getLocalStorageFile`, `getLocalStorageFileNames`, `setMigratedFlag` (app.diagrams.net only, localStorage migration) |
| configure | Startup configuration (handshake above) |
| create | Only for `#create={"type":"message"}` hash: app posts `ready`, host sends `{action:'create', data}` |

App -> host events

| Event | When |
|---|---|
| init | Editor ready for `load` (json); legacy sends `ready` string |
| ready | `#create=` message flow ready |
| configure | Requesting configuration (`configure=1`) |
| load | After load (bounds, scale, page, `xml` for descriptors, `error` on parse failure); also sent when `returnbounds=1` |
| save | Save pressed: `xml`, `exit:true` for Save & Exit |
| autosave | Change with `autosave:1`; `xml` or `patch`+`checksum` with diffSync |
| exit | Exit pressed: `modified` |
| export | Export result: `format`, `data`, `xml`, `message`; also host-delegated downloads with `exportProtocol` (`filename`) |
| merge, patch, getDiff, resetDiff, layout, fit, viewbox, textContent, template, draft, prompt, prompt-cancel | Replies to the matching action |
| openLink | Link clicked (`href`, `target`, `allowOpener`) |
| shortcut | Host-reserved key chord pressed (`Editor.passThroughKeys`, `command`) |
| zoom | View scale changed (with `zoomEvents`) |
| resize | Inline embed resized / fullscreen toggled (`rect`, `fullscreen`) |
| scrollWheel | Wheel over chromeless/embedded view forwarded to parent |
| size | Graph size changed in viewer mode (`App.initializeViewerMode`) |
| remoteInvoke, remoteInvokeResponse | RPC traffic |

Embed-related URL params: `embed`, `proto`, `configure`, `spin`, `modified`, `keepmodified`, `saveAndExit`, `publishClose`, `noSaveBtn`, `noExitBtn`, `noFileMenu`, `returnbounds`, `ready`, `toSvg`, `embedInline`, `embedRT`, `libraries`, `libs`, `clibs`, `themes`, `ui`, `pages`, `title`, `notif`. Meanings in URL parameters below.

### URL parameters

Source: `grep -rhoE "urlParams\[...\]"` over `js/diagramly`, `js/grapheditor`, `js/bootstrap.js`, `js/PreConfig.js`, `js/PostConfig.js`, `js/embed.dev.js` (163 unique). Normalisation in `js/diagramly/Init.js`; `js/bootstrap.js` parses query and `#P` hash. "=0" means the feature is on by default and the param disables it.

UI / theme / view

| Param | Meaning | Source |
|---|---|---|
| ui | Theme: `kennedy`, `atlas`, `dark` (redirects to dark=1), `min`, `sketch`, `simple` | Init.js `uiTheme`, App.js L1440 |
| sketch | `1` forces sketch UI | Init.js L352, EditorUi.js L4696 |
| rough | Sketch (rough) style on/off | EditorUi.js L16737 |
| dark | Dark mode on/off | Init.js L346, EditorUi.js L20297 |
| contrast | `0` uses simple adaptive colours instead of auto | Graph.js L2249 |
| high-contrast | `1` high-contrast appearance | EditorUi.js L20352 |
| themes | `1` shows theme menu in embed mode | EditorUi.js `isThemeMenuVisible` |
| chrome | `0` chromeless (no menus/panels) | Init.js L264, Minimal.js L21 |
| toolbar | `0` hides toolbar (chromeless) | grapheditor/EditorUi.js L3970 |
| toolbar-config | JSON for chromeless toolbar buttons (back/close/refresh/fullscreen) | grapheditor/EditorUi.js L3972 |
| format | `0` hides Format panel | EditorUi.js L1030 |
| sidebar | `0` hides shapes sidebar | EditorUi.js L1035 |
| sidebar-entries | `large` larger sidebar thumbnails | Sidebar.js L267 |
| shape-picker | `0` disables shape picker | grapheditor/EditorUi.js L1265 |
| search-shapes | Pre-fills sidebar shape search | EditorUi.js L23691 |
| windows | `0` disables floating windows (min/sketch UI) | Minimal.js L13 |
| splash | `0` skips splash/storage screen | Init.js L403 |
| pages | `0` single-page (no page tabs unless file has several) | EditorUi.js L22102 |
| hide-pages | `1` hides page tabs in read-only view | grapheditor/EditorUi.js L5424 |
| grid | Grid on/off | EditorUi.js L22081, Pages.js |
| pv | Page view on/off | Init.js L279, EditorUi.js L22086 |
| ruler | `1` shows rulers | EditorUi.js L19920 |
| sb | `0` disables scrollbars | Editor.js L9426 |
| zoom | `nocss` disables CSS-transform fast zoom | Graph.js L10748 |
| touch | `1` forces touch mode | Graph.js L1786 |
| android | Force/suppress Android tablet detection | App.js L1014 |
| tooltips | `0` disables cell tooltips | Graph.js L17296 |
| tooltip-icons / link-icons / note-icons | Show tooltip / link icons; `note-icons=0` hides note icons | EditorUi.js L18572 |
| transparent | `1` transparent page background | App.js L1450 |
| math | `0` disables MathJax; `1` enables math on new diagrams | App.js L1290, Editor.js L4529 |
| lang | UI language | Init.js L94 |
| appLang | Desktop UI language fallback `[desktop]` | Init.js L113 |
| diagram-language | Language for translatable labels | Graph.js L1861 |
| translate-diagram | `1` enables diagram label translation | Graph.js L1797 |
| browser-translate | `0` disables Chrome page translation hooks | Graph.js L1824 |
| page / page-id | Start page index / page id | EditorUi.js L3293-3339 |
| layer-ids | Space-separated visible layer ids | EditorUi.js L3369 |
| viewbox | Initial visible region JSON | EditorUi.js L26536 |
| tags | Hidden tags JSON (viewer) | EditorUi.js L8054 |
| vars | JSON global placeholder variables | Editor.js L10154 |
| base | Base URL for relative links | Graph.js L8075 |
| target | Link policy: `auto`, `self`, `frame`, `blank` | Graph.js L7923 |
| suppressNewWindows | `1` no new windows/popups | grapheditor/Editor.js L301 |
| openInSameWin | `1` opens files in same window | App.js L88 |
| animate | `0` disables animation playback in chromeless view | EditorUi.js L18513 |
| svg-warning | `0` hides foreignObject SVG warning | Graph.js L28440 |
| filesupport | `0` disables file drop/paste support | Graph.js L1792 |
| enableSpellCheck, enableStoreBkp, isGoogleFontsEnabled, autoUpdate, disableUpdate | Desktop preference state passed by Electron shell (spell check, auto backup, Google Fonts, auto update) `[desktop]` | Menus.js L5359-5410 |

Storage / files

| Param | Meaning | Source |
|---|---|---|
| mode | Storage mode: `google`, `onedrive`, `dropbox`, `github`, `gitlab`, `trello`, `device`, `browser` | App.js, Init.js L499 |
| storage | `device` prefers device storage | Dialogs.js L4610 |
| gapi / picker / drive | `0` disables Google API / Picker / Drive | Init.js L477, App.js L2578 |
| gapi-stealth | Stealth mode keeping Google APIs | Init.js L468 |
| db / od / ms365 / gh / gl / tr | `0` disables Dropbox / OneDrive / Microsoft 365 / GitHub / GitLab / Trello (`tr=1` enables Trello) | App.js, Init.js L480-509 |
| browser | `1` forces / `0` hides browser storage | Dialogs.js L221 |
| noDevice | `1` hides device storage | Dialogs.js L216 |
| offline | `1` offline app: no cloud, no plugins | Init.js L474 |
| local / stealth / lockdown / demo | No external comms variants (no cloud, no realtime; lockdown also blocks sync notifications) | Init.js L474, DrawioFileSync.js |
| fileId | Google Drive file id to open (sets `#G`) | App.js L3725 |
| state | Google Drive "Open with"/"New" state JSON | App.js L3707 |
| open | Hash fallback (sets location.hash) | Init.js L520 |
| url | Open diagram from URL | App.js L4019 |
| desc | Compressed JSON descriptor to load | App.js L4003 |
| create / data / client | Client mode: XML from opener variable / param / message | App.js L3617, L4025 |
| title / notitle | File title / suppress default title | App.js L3638, L6804 |
| template-filename | Template filter name | App.js L6862 |
| smart-template | AI-generate on start | App.js L4187 |
| rev | Open specific Drive/Dropbox revision | DriveClient.js L1433 |
| save | `remote` saves via server echo instead of Blob download | EditorUi.js `isLocalFileSave` |
| drafts | `0` disables drafts | EditorUi.js L238 |
| sync | `auto`/`manual` file sync | DrawioFile.js L45 |
| gitlab / gitlab-id | Custom GitLab URL / OAuth app id | Init.js L415-429 |
| ignoremime / override-mime | Drive MIME check overrides `[drive]` | DriveClient.js |
| gPickerSize / topBaseUrl | Google Picker size / origin `[drive]` | DriveClient.js L2692 |
| thumb | `0` no Drive thumbnails `[drive]` | DriveClient.js L2413 |
| inlinePicker | `0` disables OneDrive inline picker `[onedrive]` | Editor.js L289 |
| noLogoutOD / odAuthCancellable / ownerEml | OneDrive auth options `[onedrive]` | OneDriveClient.js |
| extAuth | External auth host (MS Teams): Drive off, viewer-only on mobile WebView | Init.js L241 |
| home | Google Drive home dialog `[drive]` | App.js `isHomeEnabled` |
| nowarn | `1` no unsaved-changes warning on unload | App.js L3166 |
| forceMigration | Force localStorage migration from draw.io domain | EditorUi.js L31909 |
| enableSW / pwa | Force / disable service worker (PWA) | App.js L1094, Editor.js L209 |
| channel | `stable`/`beta` release channel pin | bootstrap.js L269 |

Embed

| Param | Meaning |
|---|---|
| embed | `1` embed mode |
| proto | `json` JSON message protocol |
| configure | `1` wait for configure message (embed only) |
| spin | `1` spinner while waiting for load |
| modified | Resource key for status when modified; `0` no modified tracking |
| keepmodified | `1` keep modified state after save |
| saveAndExit | `1` show Save & Exit |
| publishClose | `1` Save & Exit labelled Publish |
| noSaveBtn / noExitBtn | Hide Save / Exit buttons |
| noFileMenu | `1` removes File menu |
| returnbounds | `1` load event with bounds (legacy) |
| ready | Custom legacy ready message |
| toSvg | Save & Exit returns SVG |
| embedInline | Inline embed (sketch UI) |
| embedRT | Allow realtime collaboration in embed |
| libraries | `1` custom library menus in embed |
| atlas | Atlassian host mode `[conf]` |
| confLib | Confluence Cloud library option `[conf]` |
| notif | Notification id to fetch in embed |

Libraries

| Param | Meaning |
|---|---|
| libs | Sidebar library ids to show (`;` separated) |
| clibs | Custom libraries to open (`U<url>`, ids; `;` separated) |
| createindex / savesidebar | Dev: build sidebar search index / save sidebar PNGs |

Viewer / lightbox

| Param | Meaning |
|---|---|
| lightbox | `1` lightbox viewer (implies chrome=0) |
| viewer | Viewer flag (`Graph.isViewer`) |
| nav | Page navigation in lightbox |
| layers | Layers button in lightbox |
| highlight | Link highlight colour |
| edit | Edit button URL |
| close | `1` close button |
| border | Lightbox border |
| noPrint / noExport | Hide print / export buttons |
| viewerOnlyMsg | Show "viewer only" notice |

Collaboration / sync

| Param | Meaning |
|---|---|
| rt | `1` realtime in chromeless view |
| fast-sync | P2P fast sync (`0` off; `1` loads simple-peer) |
| no-p2p | `0` enables P2P (inverted flag) |
| sockets | `0` disables sockets |
| cache-notice / alone-cache / alone-gate | Realtime cache notification tuning |
| join-announce | `0` no join announcements |
| remote-selection | `0` hides remote selections |
| checksum | `1` extra checksum validation |
| libavoid-independent | libavoid per-edge independent routing toggle |

Dev / debug: `dev`, `test`, `dev-tooltips`, `print-csp`, `orgChartDev`, `cors` (CORS regexp), `prefetchFonts`.

Ambiguous: `zoom` only has `nocss`; `viewer` semantics only via `Graph.isViewer` (unconfirmed purpose); `client` vs `create` flows overlap.

URL hash formats (`App.prototype.loadFile` L6537, `getModeForChar` L6094, bootstrap.js L43)

| Hash | Meaning |
|---|---|
| `#G<id>` | Google Drive file `[drive]` |
| `#D<path>` | Dropbox `[dropbox]` |
| `#W<id>` | OneDrive `[onedrive]` |
| `#M<id>` | Microsoft 365 / SharePoint (`App.MODE_M365`) |
| `#H<path>` | GitHub `[github]` |
| `#A<path>` | GitLab `[gitlab]` |
| `#T<id>` | Trello `[trello]` |
| `#L<name>` | Browser storage (localStorage/IndexedDB) `[browser]` |
| `#U<url>` | Load from URL |
| `#R<data>` | Raw compressed or URL-encoded XML in URL |
| `#E` | Reload embed file |
| `#S...` | Deprecated (redirect to `?desc=`) |
| `#create=<json>` | Create from object or message |
| `#P<json>` | URL params passed in hash |
| `#_CONFIG_<compressed>` | Store configuration (with `merge`) |
| trailing `#{"pageId":...}` | Hash object for target page (`getHashObject`) |

### Configuration

Sources: `js/diagramly/Editor.js` `Editor.configure` (L2930-3880, 136 keys), `js/diagramly/Init.js` (`lockdown`, `showSplashOnStart` from `.configuration`), `js/diagramly/Settings.js` (`override`), `window.DRAWIO_CONFIG` (`js/PreConfig.js`, App.js L1751), embed `configure` message, `#_CONFIG_` hash. UI: Extras > Configuration... (`configuration`, Menus.js L1473) -> `EditorUi.showConfigurationEditorDialog` (EditorUi.js L6117) using `DrawioConfigEditor.install` (`js/diagramly/ConfigEditor.js`): visual card editor + JSON text tab ("Format JSON"), buttons Reset, Plugins, Link (`#_CONFIG_` URL, web only), Preferences (raw `mxSettings` JSON editor + Reset); restart required. Stored in localStorage `.configuration`.

Config keys (`Editor.configure` unless noted)

| Group | Keys |
|---|---|
| Meta | `version`, `override` (reset user settings), `debug`, `settingsName` (storage key prefix), `resources` (custom UI strings), `keyboardShortcuts` (array remap), `passThroughKeys` (host chords), `lockdown` (Init.js), `showSplashOnStart` (Init.js) |
| Fonts | `defaultFonts`, `customFonts`, `fontCss`, `enableLocalFonts` |
| Colours | `presetColors`, `customPresetColors`, `defaultColors`, `colorNames`, `defaultColorSchemes`, `customColorSchemes` |
| Dark mode | `darkColor`, `darkColorVar`, `defaultAdaptiveColors`, `enableCssDarkMode`, `enableLightDarkColors`, `defaultPageBackgroundColor`, `defaultDarkPageBackgroundColor`, `defaultGridColor`, `defaultDarkGridColor` |
| Shadow | `shadowColor`, `shadowOpacity`, `shadowOffsetX`, `shadowOffsetY`, `shadowBlur` |
| Default styles | `defaultVertexStyle`, `defaultEdgeStyle`, `defaultTextStyle`, `styles` (Style presets), `updateDefaultStyle`, `defaultTransparentGroups`, `mermaid` (Mermaid config) |
| Canvas | `defaultGridSize`, `gridSteps`, `defaultGridEnabled`, `defaultPageVisible`, `pageFormat`, `zoomFactor`, `zoomWheel`, `passiveScroll`, `defaultEdgeLength`, `foldingIconSize`, `defaultFoldingEnabled`, `defaultConnectable`, `defaultConnectionArrowsEnabled`, `copyOnConnect`, `showConnectHandle`, `enablePositionGuides`, `enableDistanceGuides`, `enableSizeGuides`, `selectParentLayer`, `intersectionSelect`, `swimlaneSelectionEnabled`, `stopEditingOnEnter`, `pasteAtMousePointer`, `fitDiagramOnLoad`, `fitDiagramOnPage`, `preserveViewState`, `noResizers`, `browserTranslate` |
| Labels / render | `simpleLabels`, `optimizeHtmlLabels`, `fastRendering`, `mathOutputSize`, `tooltipFontSize`, `tooltipMaxWidth`, `showLinkIcons`, `showTooltipIcons`, `showNoteIcons` |
| Sidebar / libraries | `libraries` (custom entries), `defaultLibraries`, `enabledLibraries`, `defaultCustomLibraries`, `enableCustomLibraries`, `appendCustomLibraries`, `expandLibraries`, `inlineExtIcons`, `sidebarWidth`, `sidebarTitles`, `sidebarTitleSize`, `thumbWidth`, `thumbHeight`, `shapePicker` (`shapes`), `emptyLibraryXml` |
| Templates | `templateFile`, `enabledTemplateSections`, `customTemplates`, `emptyDiagramXml` |
| Menus / UI | `hideMenus`, `hideMenuItems`, `compact`, `noAutoFocus`, `enableInlineToolbar`, `enableWindowDocking`, `enableAnimations`, `insertAnimations`, `defaultLanguages`, `css`, `customCss` |
| File / export | `compressXml`, `compressStyles`, `defaultFileType`, `includeDiagram`, `embedSvgFonts`, `replaceSvgDataUris`, `foreignObjectImages`, `removeImageMetadata`, `expandPatternsForPrint`, `enableExportUrl`, `restrictExport`, `maxImageBytes`, `maxImageSize`, `autosaveDelay`, `globalVars` |
| Clipboard / windows | `useInternalClipboard`, `enableNativeClipboard`, `suppressNewWindows` |
| Collaboration | `shareCursorPosition`, `showRemoteCursors` |
| Storage | `oneDriveInlinePicker`, `enableCustomGitLabUrl` |
| AI | `enableAi`, `enableChatGpt` (alias), `gptApiKey`, `geminiApiKey`, `claudeApiKey`, `gptUrl`, `aiActions`, `aiGlobals`, `aiConfigs`, `aiModels` |

ConfigEditor cards (`ConfigEditor.js` L1740-2408, section i18n keys): General; Canvas & Grid; Appearance; Sidebar & Panels; Libraries; Fonts; Colors; Color Schemes; Default Styles; Custom CSS; Embedding; Menu Customization; AI Configuration; Export & Security; Collaboration & Advanced; Confluence Cloud; Confluence Server/Data Center. Inputs: 57 `data-key` fields plus boolean toggles (L230-330), list editors (fonts, colours, tag lists, colour schemes), "Use Current" buttons for default vertex/edge style. Confluence-only keys shown but not read in this repo: `simpleViewer`, `disableVersioning`, `hiResPreview`, `autoCropViewer`, `viewerCanExceedPageWidth`, `inplaceEdits`, `viewerTimeout`, `ui` `[conf]`. Desktop-only toggles via `isDesktop` `[desktop]`.

### User preferences persisted

`mxSettings` (`js/diagramly/Settings.js`), localStorage key `Editor.settingsKey` (`.drawio-config`; `.sketch-config` in sketch build, `.<settingsName>-config` via config). `currentVersion` 18; reset when `configVersion` differs or `override`.

| Key | Meaning |
|---|---|
| language | UI language |
| ui | Selected theme |
| darkMode | `auto`/true/false |
| highContrast | High-contrast appearance |
| sketchMode | Sketch style toggle |
| compactMode | Compact (collapsed) UI |
| customFonts | User-added fonts |
| recentColors | Recent colour swatches |
| libraries | Enabled built-in sidebar libraries |
| customLibraries | Open custom libraries |
| collapsedLibraries | Collapsed library sections |
| libraryOrder | Sidebar library order |
| search | Sidebar search visible |
| sidebarTitles | Show shape titles in sidebar |
| sidebarWidth | Sidebar width |
| formatWidth | Format panel width (0 = hidden) |
| collapsedSections | Collapsed Format panel sections |
| windowStates | Floating window positions/visibility |
| pages | Page tabs visible |
| pagesVisible | Pages panel visible (`Editor.pagesVisible`) |
| pageFormat | Default page size |
| unit | Units (points/inches/mm/...) |
| isRulerOn | Rulers |
| gridColor / darkGridColor | Grid colours |
| zoomWheel | Wheel zooms without modifier |
| defaultEdgeLength | Clone/connect distance |
| currentEdgeStyle | Persisted toolbar edge style |
| autosave | Autosave on/off |
| autosaveDelay | Autosave delay |
| draftSaveDelay | Draft save delay |
| resizeImages | Resize large images on insert (null = ask) |
| exportPresets | Last export options per format |
| enableAnimations | UI animations |
| shareCursorPosition / showRemoteCursors | Collaboration cursors |
| plugins | Installed plugin paths |
| openCounter | Open count (for prompts) |
| configVersion / version / isNew | Bookkeeping |
| lastAlert / scratchpadSeen | Legacy, deleted on load |

Other localStorage keys: `.configuration` (config JSON), `.mode` (last storage mode), `.recent<type>` (recent files per storage, App.js L3096), `.drawio-channel*` (release channel/SW failure tracking), `.localStorageMigrated`, `.draft-alive-check`, `._autoSaveTrans_`, `ElkLayout.SETTINGS_KEY` (ELK dialog options), `odpickerv7cache`, `drawio_trello_token`/`trello_token`, client auth cookies (`gDriveViewerAuthInfo` etc.), desktop-only `.lastSaveDir`, `.lastOpenDir`, `.lastImpDir`, `.lastExpDir`, `.pdfAutosave` `[desktop]`. IndexedDB `database` v2 stores: `objects` (drafts, etc.), `files` and `filesInfo` (browser storage files) (EditorUi.js `openDatabase` L31849).

### Lightbox / viewer mode

Sources: `js/diagramly/GraphViewer.js` (constructor L150-200, `addToolbar` L1515, `showLightbox` L2246, `processElements` L2682, `createViewerForElement` L2749); chromeless toolbar `js/grapheditor/EditorUi.js` (L3960-4420, L5395-5450); `js/diagramly/EditorUi.js` tags/export buttons (L8040-8240); `js/diagramly/Init.js` (lightbox implies `chrome=0`; viewer.diagrams.net forces lightbox).

- Embedding viewer: `<div class="mxgraph" data-mxgraph='{json}'>` + `viewer.min.js` / `viewer-static.min.js`.
- Viewer toolbar tokens (`toolbar` config, space-separated): `pages` (prev/next/page counter), `zoom` (in/out/fit), `layers` (layer visibility menu), `tags` (hide by tags), `lightbox` (open fullscreen lightbox; also "Edit" when `edit` set). Custom buttons via `toolbar-buttons`.
- Lightbox/chromeless toolbar (app with `lightbox=1`/`chrome=0`): Previous/Next page + current page, Zoom in/out, Fit, Layers, Tags, Export, Print (`noPrint`), Edit (`edit`), Refresh, Fullscreen, Back, Close (`close`); `toolbar-config` keys `backBtn`, `refreshBtn`, `fullscreenBtn`, `closeBtn`, `noCloseBtn`.
- Click-through links, hover highlight of links (`highlight`), animations play (`animate`), tooltips.

`data-mxgraph` keys (`graphConfig`):

| Key | Meaning |
|---|---|
| xml / url | Diagram source |
| page / pageId | Initial page |
| layerIds | Visible layers |
| hiddenTags | Hidden tags |
| toolbar | Toolbar tokens |
| toolbar-position | `top`/`bottom`/`inline` |
| toolbar-nohide | Always show toolbar |
| toolbar-buttons | Custom buttons |
| nav | Page navigation / folding |
| layers | Visible layer indexes (space-separated) |
| lightbox | Click opens lightbox |
| edit / editable / editFunc | Edit link, `_blank` editor, or callback |
| highlight | Link highlight colour |
| target | Link target policy |
| zoom | Initial zoom |
| resize | Resize container to diagram |
| max-height | Max container height |
| border | Border |
| center / forceCenter / hCenterOnly | Centering |
| auto-fit / auto-crop / auto-origin | Fit / crop / origin handling |
| allow-zoom-in / allow-zoom-out | Zoom limits |
| responsive / responsive-auto-fit / responsive-max-scale | Responsive sizing |
| move | Any drag moves cells (`isMoveCellsEvent` always true) |
| title / titleTooltip | Title / tooltip |
| dark-mode | Viewer dark mode |
| browser-translate | Allow page translation |
| check-visible-state | Defer render until visible |
| show-tooltip-icons / show-note-icons / show-link-icons | Icon overlays |

Counts: url_params=163, config_keys=139, plugins=23, template_categories=15, templates=155, embed_message_actions=27, embed_events=28, settings_keys=43, viewer_config_keys=41.
How counted: url_params = unique `urlParams['x']` names from the grep above. config_keys = 136 unique `config.<key>` reads in `Editor.configure` + `lockdown`, `showSplashOnStart` (Init.js), `override` (Settings.js); excludes 8 Confluence-only ConfigEditor keys. plugins = 23 `App.pluginRegistry` keys (21 distinct files; `ex` and its hash id share explore.js). template_categories/templates = `<template url="<cat>/...">` entries in index.xml (excludes the Generate and From Text tiles). embed_message_actions = unique `data.action == '...'` values (incl. `configure`, `create`). embed_events = unique `event` names sent to the host, `ready` is both a JSON event and the legacy string. settings_keys = unique `mxSettings.settings.<key>` + `configVersion`. viewer_config_keys = unique `graphConfig`/`config` keys in GraphViewer.js.

## 11. Parity tiers

Each tier lists areas, not individual items; the item-level detail is in the referenced sections. "Local" means the feature works without any network service. "Online service" means it depends on a third-party or draw.io-hosted service.

### Tier 1: Core editing (local)

| Area | What parity covers | Sections |
|---|---|---|
| Canvas and navigation | Zoom, pan, fit modes, page view and page breaks, grid, guides (position, distance, size, angle), snapping, rulers and units, outline window, fullscreen | §1, §2, §10 |
| Selection and manipulation | Rubberband and Alt variants, toggle select, select-behind, keyboard nudge and resize, Ctrl-drag clone, Shift constrain, rotation handle, flip, align, distribute, z-order, group and ungroup, containers, collapse and expand, lock, swap, insert or remove space, copy/paste of size, style and data, duplicate, default styles | §1, §2, §10 |
| Shapes | Core registered shapes (`Shapes.js` and mxGraph core), the stencil XML engine, inline stencils (Edit Shape), image shapes with SVG recolor, tables (merge, collapsed borders, stripes), swimlanes, custom shape handles | §2, §4 |
| Edges | Routing styles, auto-routing around shapes (libavoid), arrowheads, dash patterns, line jumps, edge shapes, flow animation, waypoint and segment handles, fixed and floating connections, connection-point editor, edge labels | §5 |
| Text | In-place rich-text (HTML) editing with its toolbar, plain vs formatted text, word wrap, label position, writing direction, autosize, fit text to shape, math typesetting (bundled MathJax) | §3, §10 |
| Format panel | Every tab, section and control, plus the generated property table | §3 |
| Document structure | Multiple pages, layers, tags, custom data and placeholders, links and custom link actions, tooltips, notes, diagram translation | §10 |
| Sidebar | Palettes, local search index, More Shapes, scratchpad, custom libraries, shape picker, hover connect arrows, search box as command palette | §2, §4 |
| Layout | ELK layouts, org chart, circle, parallels, orthogonal routing, custom layout JSON, live layout containers, tree and mind-map editing | §6 |
| Appearance | 5 UI themes, dark mode, light/dark color pairs and adaptive colors, high contrast, sketch (rough) style, fill styles | §10 |
| Tools | Freehand, find and replace, Edit Diagram (raw XML), Edit Style, Edit Geometry, polygon editor, animation editor, explore | §7, §10 |
| Infrastructure | Undo and redo, keyboard shortcuts (remappable by config), context menus, 42 UI languages, configuration, persisted preferences, plugin API, print | §1, §2, §7, §10 |

### Tier 2: Formats and IO

| Area | What parity covers | Local or service |
|---|---|---|
| Native format | `.drawio` mxfile XML (plain and compressed, multi-page), ZIP container, `<mxlibrary>` libraries | Local |
| Editable image files | PNG, SVG, HTML and PDF that carry the diagram and reopen as diagrams; per-file zoom, border and font options | Local (PDF re-save `[desktop]` only) |
| Export | PNG, JPEG, WebP, SVG, PDF, HTML, XML, URL (`#R` compressed), JSON, animated GIF, MP4; print; named export presets | Local, except PDF and the raster fallback on web, which use the export server `[server]` |
| Import | VSDX, VSD, VSSX, GraphML, Gliffy, Lucidchart, Miro (paste only), Mermaid, PlantUML, SQL, CSV, From Text, images, HTML, text and URL paste, Freemind `[plugin:import]` | Local parsers; open or import from URL uses the proxy `[server]` |
| Clipboard and drag-drop | Copy as image or SVG, paste from other apps, file drop with modifiers | Local |
| Viewing and publishing output | Lightbox and chromeless viewer, embeddable viewer script, presentation mode, Embed snippets (image, SVG, HTML, IFrame) | Local rendering; published links point at a hosted viewer (online service) |

draw.io gates VSDX export to the Confluence/Jira build (`[conf]`). Parity should treat it as a normal export.

### Tier 3: Cloud, collaboration and integrations

Online-service integrations (need a third-party account or a draw.io-hosted service):

| Integration | Features | Sections |
|---|---|---|
| Google Drive | Open, save, picker, "My Diagrams" home, share dialog, comments (the only backend with comments in this repo), revision history, realtime collaboration, restricted files | §7, §9 |
| OneDrive and Microsoft 365 / SharePoint | Open, save, inline picker, move to folder, realtime collaboration | §9 |
| Dropbox | Read-only, deprecated; revision listing | §9 |
| GitHub | Open, save as commit, repo browser, live image link | §9 |
| GitLab | Open and commit; deprecated for new files; self-hosted URL by config | §9 |
| Trello | Card attachments; off by default (`tr=1`) | §9 |
| Realtime collaboration service | Pusher notifications, draw.io WebSocket relay, patch cache, optional WebRTC P2P: live edits, remote cursors and selections, presence, Bring Everyone to Me, Present to Everyone | §9 |
| Publish and share | Publish link and live image (hosted viewer), Notion embed (link for the Notion Chrome extension), Microsoft Office add-in (office.draw.io) | §1, §8, §9 |
| Atlassian and other hosts | Confluence/Jira Cloud atlas mode `[conf]`, MS Teams (`extAuth`), monday.com (plugin not in repo), Nextcloud `[plugin:nextcloud]` | §9, §10 |
| AI generation | Generate window, smart templates; OpenAI, Gemini or Claude endpoints, or the hosted draw.io service | §7, §10 |
| draw.io web services | Export server (PDF, remote raster), URL proxy, remote icon search, notifications, Google Fonts fetch, plugin and template hosting, service-worker release channels | §4, §8, §9 |

Local storage and platform features (no online service):

| Feature | Notes | Sections |
|---|---|---|
| Browser storage | IndexedDB files, scratchpad, drafts | §9 |
| Device files | File System Access API, or upload and download | §9 |
| Desktop file system `[desktop]` | Native open and save, open recent, file watching, drafts, `.bkp` backups, PDF as an editable save format, installed fonts, spell check, auto update, window zoom | §1, §9 |
| Autosave, drafts, recovery, conflict merge | Generic file logic. The merge is a 3-way page diff and works on local files too | §9 |
| Embed host protocol `[embed]` | postMessage API (load, save, export, merge, diff sync, prompts, layouts). It is a host integration but needs no service | §10 |
| Offline / PWA | Service-worker precache and `offline=1` mode. Only matters for a web build | §9 |

### Legacy, deprecated or dead (parity optional; files that use them must still load)

- Legacy layouts: `mxHierarchicalLayout`, `mxCompactTreeLayout`, `mxRadialTreeLayout` and `mxFastOrganicLayout` names, and `childLayout` values `flowLayout`, `treeLayout` and `organicLayout`, are mapped to ELK at load. `mxPartitionLayout` and `mxEdgeLabelLayout` are skipped (§6).
- Legacy palettes (`aws2`, `gcp`, `arrows`, `azure`, `veeam`) and unreachable palette code (§4).
- Unreachable or uncalled UI: `AboutDialog`, `AspectDialog`, `AddCustomPropertyDialog`, the `adaptiveColors` menu (§1, §2, §7).
- Deprecated backends and plugins: Dropbox (read-only), GitLab for new files, WebCola layout, `svgdata` export (§6, §8, §9, §10).
- Shortcut labels that disagree with bindings (Copy/Paste Text Style, Edit Connection Points). A new UI should pick one binding per action (§1, §2).

