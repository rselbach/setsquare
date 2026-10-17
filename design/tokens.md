# Design tokens

The mockup defines these tokens as CSS custom properties in [`mockup/index.html`](mockup/index.html), under `:root` for the light theme and `[data-theme="dark"]` for the dark theme. [`README.md`](README.md) explains the reasoning behind them.

## Interface colors

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--board` | `#DBE2DB` | `#161D1A` | Desk around pages |
| `--vellum` | `#F3F5F1` | `#1F2724` | Chrome: top bar, library, inspector, rulers, title block, popovers |
| `--vellum-2` | `#E7ECE6` | `#28322E` | Hover fill, tool group background |
| `--vellum-3` | `#DAE1D9` | `#323D38` | Pressed and current items |
| `--field` | `#FFFFFF` | `#171E1B` | Input fill |
| `--sheet` | `#FFFFFF` | `#232B27` | Page, measurement chip fill |
| `--graphite` | `#2A2F2B` | `#E2E8E3` | Text, icons, primary button fill, title block frame |
| `--lead` | `#5E665F` | `#97A39A` | Secondary text and field labels |
| `--rule` | `#D3D9D2` | `#303A35` | Passive dividers |
| `--rule-strong` | `#848D85` | `#66726B` | Control borders, title block cell rules, popover edges |
| `--guide` | `#2399BF` | `#4CC3E6` | Alignment guides |
| `--ink` | `#0B7EA3` | `#5CC8EA` | Selection, handles, dimension lines, focus ring |
| `--ink-wash` | `#0B7EA3` at 13% | `#5CC8EA` at 16% | Selection extent on rulers |
| `--grid-minor` | `#5CBEDC` at 16% | `#5FC7E6` at 10% | 10 pt grid |
| `--grid-major` | `#5CBEDC` at 36% | `#5FC7E6` at 22% | 50 pt grid |
| `--redline` | `#C4313B` | `#F06A70` | Destructive actions, errors, comments |

Cyan (`--guide`, `--ink`, the grid) marks things that never export. Primary buttons use `--graphite`, not cyan.

## Diagram swatches

These are the style presets in the inspector. They color user content, so they never appear in the chrome.

| Name | Light fill | Light stroke | Dark fill | Dark stroke |
| --- | --- | --- | --- | --- |
| Mist | `#DCEBF2` | `#3C7A93` | `#1E3440` | `#6FB3CF` |
| Sage | `#E1EEDD` | `#5B8A4E` | `#22362A` | `#8DC07E` |
| Ochre | `#F7EACB` | `#A07617` | `#3A3220` | `#D9B05A` |
| Rose | `#F6DEDC` | `#A54B48` | `#40292A` | `#E08F8B` |
| Lilac | `#E9E2F2` | `#6E5A99` | `#312B41` | `#B7A2E0` |
| Stone | `#EDEEEA` | `#6B6E66` | `#2C322F` | `#A3ABA5` |

Diagram text is `#1F2421` in light and `#E2E8E3` in dark. Connectors are `#4A514C` in light and `#AEB8B1` in dark.

## Contrast

WCAG 2.2 contrast ratios for the pairs the interface relies on. Any WCAG contrast calculator reproduces them from the hex values above.

| Pair | Light | Dark |
| --- | --- | --- |
| `--graphite` on `--vellum` | 12.4 | 12.3 |
| `--lead` on `--vellum` | 5.4 | 5.8 |
| `--ink` on `--sheet` | 4.6 | 7.5 |
| `--sheet` text on an `--ink` chip | 4.6 | 7.5 |
| `--guide` on `--sheet` | 3.3 | 7.1 |
| `--redline` on `--vellum` | 5.0 | 5.1 |
| `--rule-strong` on `--vellum` | 3.1 | 3.0 |

## Type

| Family | File | Role |
| --- | --- | --- |
| D-DIN | `D-DIN.woff2`, `D-DIN-Bold.woff2` | Interface text |
| D-DIN Condensed | `D-DINCondensed.woff2`, `D-DINCondensed-Bold.woff2` | Numbers and measurements |
| D-DIN Exp | `D-DINExp.woff2`, `D-DINExp-Bold.woff2` | Drawing name and selected object name |
| Helvetica, then Arial | System | Default diagram labels |

| Size and leading | Family and weight | Use |
| --- | --- | --- |
| 10 px | Condensed 400 | Ruler numbers |
| 11/13 px | Condensed 400 | Title block field labels |
| 11 px | Condensed 700 | Measurement chips |
| 12 px | Condensed 400 | Shortcut hints, counts, units |
| 13/18 px | Regular 400 and 700 | Interface text; 700 for section heads and values |
| 14 px | Condensed 400 | Numeric field values, with tabular figures |
| 14/20 px | Expanded 700 | Drawing name, selected object name |
| 18 px | Regular 400 | Command palette input |

Interface text uses sentence case everywhere. No label uses all caps.

D-DIN covers Basic Latin, Latin-1 Supplement, and ISO 8859-15. Text in other scripts falls back to the system font.

## Shape and space

| Item | Value |
| --- | --- |
| Radius, wells and chips | 2 px |
| Radius, controls and buttons | 3 px |
| Radius, popovers and palette | 6 px |
| Radius, stage top corners | 8 px |
| Radius, title block | 0 |
| Top bar height | 48 px |
| Library width | 240 px; 216 px at 1180 px and below; drawer at 960 px and below |
| Inspector width | 280 px; 256 px at 1180 px and below; bottom sheet at 720 px and below |
| Ruler thickness | 22 px |
| Title block inset | 14 px from the stage's bottom-right corner |
| Icons | 20 px grid, 1.5 px stroke, round caps and joins |
| Library tiles | 5 columns, 30 px line art at 1.25 px stroke |

Only floating layers cast a shadow: popovers, the palette, the library drawer, the bottom sheet, and toasts. Docked panels have no shadow and no border.

## Construction layer

The editor draws these marks in screen space, so their size does not change with zoom.

| Mark | Specification |
| --- | --- |
| Selection box | 1 px `--ink` |
| Resize handles | 7 px squares, `--sheet` fill, 1.5 px `--ink` stroke |
| Rotation handle | 4 px radius circle, offset 15 px up and right from the top-right corner, dashed stem |
| Quick-add button | 7 px radius circle with a plus, 22 px outside each side that has no connector |
| Hover outline | 1 px `--guide` |
| Alignment guide | 1 px `--guide`, dashed 4 3, extends 14 px past the aligned shapes |
| Dimension line | 1 px `--ink`, 8 px ticks at 45°, extension lines at 55% opacity |
| Dimension placement | 18 px right of the shapes for vertical gaps, 36 px below for horizontal gaps |
| Dimension label | Chip with Condensed 700 11 px; filled `--ink` when the gaps are equal |
| Size readout | Chip 16 px below the selection while it moves |
| Snapping | Edges, centers, and equal gaps within 6 screen px; otherwise the 10 pt grid |

## Motion

Motion only answers an action. Nothing moves on its own.

| Event | Animation |
| --- | --- |
| Popover opens | 120 ms, scale 0.97 to 1 and fade, from the anchor corner |
| Palette opens | 140 ms, 6 px drop and fade |
| Section expands | Chevron rotates 90° in 140 ms |
| Library drawer opens | 180 ms slide |
| Bottom sheet expands | 200 ms height |

`prefers-reduced-motion: reduce` turns off every animation and transition.
