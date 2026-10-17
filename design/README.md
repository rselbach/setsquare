# Design direction

This folder holds the visual design for Setsquare, a diagram editor written in Rust. It contains this explanation, the token reference in [`tokens.md`](tokens.md), the interactive mockup in [`mockup/index.html`](mockup/index.html), and the D-DIN font files with their license in [`fonts/`](fonts/).

To open the mockup, serve this folder over HTTP so the browser loads the fonts:

```sh
python3 -m http.server 8765 --directory design
```

Then open `http://127.0.0.1:8765/mockup/index.html`. In the mockup you can drag shapes to see guides and dimension lines, drop shapes from the library, press ⌘K for the command palette, and switch themes.

## Who it is for

People who draw diagrams they will maintain: engineers, architects, analysts, and students drawing flowcharts, system architecture, UML, ER models, and networks. The editor's job is to get a precise diagram down fast and keep it tidy as it changes. Feature parity with draw.io is the floor. The design must give every draw.io feature a home without copying draw.io's layout or look.

## Built from drawing-office conventions

Diagramming descends from technical drawing, so the design takes its vocabulary from the drawing office. Each borrowed convention does a job in the interface. None of them is a texture or an ornament.

The name comes from the same place. A set square is the drafting triangle used to draw precise angles and parallel lines, and the app's mark is one.

**Construction marks are non-photo blue.** Draftsmen sketch construction lines in a pale blue that copiers do not reproduce. The editor uses that idea as a rule. Everything the editor draws that never exports is cyan: the grid, guides, selection, handles, quick-add buttons, and measurements. Everything the user draws is in the user's colors. A person can always tell the tool's marks from the diagram.

**Spacing feedback uses real dimension lines.** When a shape moves, the editor draws dimension lines with extension lines and 45° architectural ticks, labeled in condensed figures. Equal gaps get a filled label, so "these are evenly spaced" reads at a glance. This is the one bold element in the design. It appears only while you work.

**The title block identifies the drawing.** Engineering drawings carry a ruled title block in the bottom-right corner. Here it holds the drawing name, the page and page navigation, the active layer, zoom, and save state with a link to revision history. Its ruled cells are the only place the design uses a full grid of hairlines, because there the rules separate fields.

**The desk is drafting-board green.** Pages sit on a pale green-grey surface, the color of the vinyl that covers drafting tables. The page itself is white engineering paper with a cyan grid.

**The type is DIN 1451.** DIN 1451 is the German standard lettering for technical drawings and signage. [D-DIN](https://www.datto.com/fonts/d-din) is an open (SIL OFL 1.1) cut of it with the three widths the standard defines, and each width has one role:

- Regular width for interface text.
- Condensed width for numbers and measurements: rulers, dimension labels, coordinates, and field values.
- Expanded width for identity: the drawing name and the selected object's name.

Width carries hierarchy, so the interface needs only two weights.

Diagram labels default to Helvetica, which keeps files portable to draw.io. That choice also separates user content from the tool's own lettering.

## Choices made against the generic default

I checked each part of the first plan against what a generic "modern diagram editor" prompt produces and changed four things.

1. Panels are separated by tone, not hairlines. The first plan ruled every panel edge, which drifts into the dense broadsheet look. The chrome is now one continuous vellum frame around an inset board. Hairlines remain only where they measure or separate fields: rulers, the title block, and inspector sections.
2. Cyan is reserved for construction marks and keyboard focus. The first plan also used it for primary buttons. That would have made cyan a generic brand accent and weakened the "cyan never prints" rule. Primary buttons are graphite.
3. Tools sit in a docked group in the top bar, not a floating pill over the canvas. Floating pills are the current default for canvas apps and they cover the drawing.
4. Coordinates and measurements use the condensed DIN width, not a monospace face. A monospace face for small data labels is a common tell, and the condensed width belongs to the drafting vocabulary.

Two smaller changes came from screenshots of the built mockup. The rotation handle moved from top-center to the top-right corner, because connectors usually enter at the top center. Quick-add buttons now appear only on sides without a connector.

## Where features live

draw.io's breadth is the main layout constraint. The design puts every action in one command registry and shows it in several places:

- The native menu bar on desktop, built from the registry.
- The app menu (the set-square mark), which opens the palette filtered to a menu group on the web build.
- The command palette (⌘K), which searches commands and shapes together.
- Context menus on the canvas.
- Keyboard shortcuts.

Other features have one fixed place:

- The library holds shape libraries, the scratchpad, and library search. **Add libraries** opens the library manager.
- The inspector shows page settings and drawing aids when nothing is selected. With a selection, it shows style presets, fill, line, text, arrange, and data.
- The title block holds pages, layers, zoom, save state, and revision history.
- The **Insert** menu holds tables, images, links, math, templates, and import from text, CSV, Mermaid, and PlantUML.
- The **Export** menu holds every export format and the "keep diagram editable" option.

The full mapping from draw.io features to these places belongs in a separate document built from [`docs/parity/drawio-inventory.md`](../docs/parity/drawio-inventory.md).

## Not designed yet

The parity inventory lists draw.io features that the mockup has no surface for yet:

- Every color control needs a second value for dark mode, because draw.io stores light and dark color pairs.
- The inspector needs an advanced section for the generated per-shape property table.
- Tree and mind-map editing uses Tab and Enter to add children and siblings. Live layout containers re-run their layout on each edit.
- Custom link actions and page animations need an editor and a player.
- Cell notes in Markdown need an indicator on the canvas.
- Collaboration needs follow mode ("bring everyone to me") and comments anchored to a shape, point, or area. Comments would use `--redline`.

draw.io ships five UI themes: Classic (`kennedy`), Simple, Sketch, Minimal (`min`), and Atlas, plus a legacy dark theme. This design replaces them with one layout in light and dark. The sketch style for diagrams stays, because it changes the drawing, not the chrome.

## Open questions

- D-DIN covers Latin-1 and ISO 8859-15 only. draw.io's interface is translated into many scripts, so the app needs fallback fonts for Cyrillic, Greek, CJK, Arabic, and others.
- The mockup draws no connector routing beyond simple orthogonal elbows. Edge styles, waypoints, and jumps still need their own interaction design.
