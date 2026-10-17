# Third-party notices

Setsquare includes material from [draw.io](https://github.com/jgraph/drawio) and
mxGraph, Copyright (c) JGraph Ltd, licensed under the Apache License, Version 2.0.
A copy of the license is in [`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt).

| Setsquare file | draw.io source at commit `9034053fba` | Changes |
| --- | --- | --- |
| `crates/setsquare-core/assets/drawio-default.xml` | `src/main/webapp/styles/default.xml` | None, apart from a header comment |
| `crates/setsquare-core/src/edge_shape/mod.rs` | `src/main/webapp/mxgraph/src/shape/mxConnector.js` | Translated to Rust: `paintEdgeShape` and `createMarker`, returning SVG path data instead of drawing on a canvas |
| `crates/setsquare-core/src/edge_shape/mod.rs` | `src/main/webapp/mxgraph/src/shape/mxPolyline.js` | Translated to Rust: `paintEdgeShape`, `paintLine`, `paintCurvedLine`, and `paintBezierLine` |
| `crates/setsquare-core/src/edge_shape/mod.rs` | `src/main/webapp/mxgraph/src/shape/mxShape.js` | Translated to Rust: `getWaypoints` at scale 1 and `addPoints` for open paths |
| `crates/setsquare-core/src/edge_shape/mod.rs` | `src/main/webapp/mxgraph/src/util/mxAbstractCanvas2D.js` | Translated to Rust: the default dash pattern and how path commands are recorded |
| `crates/setsquare-core/src/edge_shape/mod.rs` | `src/main/webapp/mxgraph/src/util/mxSvgCanvas2D.js` | Translated to Rust: `format` and `createDashPattern` |
| `crates/setsquare-core/src/edge_shape/marker.rs` | `src/main/webapp/mxgraph/src/shape/mxMarker.js` | Translated to Rust: every built-in marker |
| `crates/setsquare-core/src/edge_shape/marker.rs` | `src/main/webapp/js/grapheditor/Shapes.js` | Translated to Rust: the markers draw.io adds to `mxMarker` |
| `crates/setsquare-core/src/edge_shape/marker.rs` | `src/main/webapp/shapes/er/mxER.js` | Translated to Rust: the ER markers |
| `crates/setsquare-core/src/routing/mod.rs` | `src/main/webapp/mxgraph/src/view/mxGraphView.js`, `src/main/webapp/mxgraph/src/view/mxGraph.js`, `src/main/webapp/mxgraph/src/view/mxCellState.js`, `src/main/webapp/mxgraph/src/util/mxUtils.js`, `src/main/webapp/js/grapheditor/Graph.js` | Translated to Rust: the connector routing pipeline only |
| `crates/setsquare-core/src/routing/perimeter.rs` | `src/main/webapp/mxgraph/src/view/mxPerimeter.js`, `src/main/webapp/js/grapheditor/Shapes.js`, `src/main/webapp/mxgraph/src/util/mxUtils.js` | Translated to Rust: the perimeters only |
| `crates/setsquare-core/src/routing/edge_style.rs` | `src/main/webapp/mxgraph/src/view/mxEdgeStyle.js`, `src/main/webapp/js/grapheditor/Shapes.js`, `src/main/webapp/mxgraph/src/util/mxUtils.js` | Translated to Rust: the edge styles only |

Test fixtures in `crates/setsquare-core/tests/fixtures/templates` are draw.io templates
licensed under CC BY 4.0. Their README lists the sources.
