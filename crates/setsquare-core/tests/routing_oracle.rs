//! Compares Setsquare's connector routing and painting with draw.io's.
//!
//! Each fixture drawing has a `.oracle.tsv` file that `tools/drawio-oracle/oracle.sh`
//! writes by rendering the drawing with draw.io itself. Route rows hold the points draw.io
//! computed for a connector, and label rows where it centers the connector's label. Path
//! rows hold each SVG element draw.io painted for it: the line first, then the arrowheads.
//! Bounds rows hold every shape's position and size in page coordinates.

use std::fmt::Write;
use std::fs;
use std::path::{Path, PathBuf};

use setsquare_core::{CellId, Document, MarkerFill, MarkerGeometry, Point, drawio, edge_shape};

/// draw.io prints path numbers with at most two decimals.
const PATH_TOLERANCE: f64 = 0.02;
const POINT_TOLERANCE: f64 = 0.01;

struct Route {
    page: usize,
    edge: String,
    points: Vec<Option<Point>>,
}

struct Painted {
    page: usize,
    edge: String,
    fill: String,
    dash: Option<String>,
    geometry: String,
}

struct Placed {
    page: usize,
    cell: String,
    values: Vec<f64>,
}

struct Oracle {
    doc: Document,
    routes: Vec<Route>,
    paths: Vec<Painted>,
    labels: Vec<Placed>,
    bounds: Vec<Placed>,
}

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

fn load(name: &str) -> Oracle {
    let drawing = fs::read_to_string(fixture(&format!("{name}.drawio")))
        .unwrap_or_else(|e| panic!("{name}: {e}"));
    let doc = drawio::read(&drawing).unwrap_or_else(|e| panic!("{name}: {e}"));
    let golden = fs::read_to_string(fixture(&format!("{name}.oracle.tsv")))
        .unwrap_or_else(|e| panic!("{name}: {e}"));
    let (mut routes, mut paths, mut labels, mut bounds) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let numbers = |s: &str| -> Vec<f64> {
        s.split([' ', ','])
            .map(|n| n.parse().expect("number"))
            .collect()
    };
    for line in golden.lines().filter(|l| !l.starts_with('#')) {
        let cols: Vec<&str> = line.split('\t').collect();
        let page = cols[1].parse().expect("page index");
        match cols[0] {
            "route" => routes.push(Route {
                page,
                edge: cols[2].to_owned(),
                points: cols[3]
                    .split(' ')
                    .map(|p| {
                        p.split_once(',')
                            .map(|(x, y)| Point::new(x.parse().expect("x"), y.parse().expect("y")))
                    })
                    .collect(),
            }),
            "path" => paths.push(Painted {
                page,
                edge: cols[2].to_owned(),
                fill: cols[4].to_owned(),
                dash: Some(cols[5]).filter(|d| *d != "-").map(str::to_owned),
                geometry: cols[7].to_owned(),
            }),
            "label" => labels.push(Placed {
                page,
                cell: cols[2].to_owned(),
                values: numbers(cols[3]),
            }),
            "bounds" => bounds.push(Placed {
                page,
                cell: cols[2].to_owned(),
                values: numbers(cols[3]),
            }),
            other => panic!("{name}: unknown row kind {other}"),
        }
    }
    Oracle {
        doc,
        routes,
        paths,
        labels,
        bounds,
    }
}

/// Splits path data or an element description into words and numbers.
fn tokens(geometry: &str) -> Vec<&str> {
    geometry
        .split([' ', ','])
        .filter(|t| !t.is_empty())
        .collect()
}

fn same_geometry(want: &str, got: &str) -> bool {
    let (want, got) = (tokens(want), tokens(got));
    want.len() == got.len()
        && want
            .iter()
            .zip(&got)
            .all(|(w, g)| match (w.parse::<f64>(), g.parse::<f64>()) {
                (Ok(w), Ok(g)) => (w - g).abs() <= PATH_TOLERANCE,
                _ => w == g,
            })
}

fn fmt_points(points: &[Point]) -> String {
    points
        .iter()
        .map(|p| format!("{:.3},{:.3}", p.x, p.y))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Fails with the first mismatches, so one failing test explains itself.
fn report(name: &str, what: &str, checked: usize, failures: Vec<String>) {
    if failures.is_empty() {
        return;
    }
    let mut msg = format!(
        "{name}: {} of {checked} {what} differ from draw.io\n",
        failures.len()
    );
    for f in failures.iter().take(15) {
        let _ = writeln!(msg, "  {f}");
    }
    panic!("{msg}");
}

fn check_routes(name: &str) {
    let oracle = load(name);
    let mut failures = Vec::new();
    for want in &oracle.routes {
        let model = &oracle.doc.pages()[want.page].model;
        let got = model.route(&CellId::new(&want.edge));
        let expected: Option<Vec<Point>> = want.points.iter().copied().collect();
        let ok = match (&expected, &got) {
            (Some(w), Some(g)) => {
                w.len() == g.len()
                    && w.iter().zip(g).all(|(a, b)| {
                        (a.x - b.x).abs() <= POINT_TOLERANCE && (a.y - b.y).abs() <= POINT_TOLERANCE
                    })
            }
            (None, None) => true,
            _ => false,
        };
        if !ok {
            let w = expected.as_deref().map_or("none".into(), fmt_points);
            let g = got.as_deref().map_or("none".into(), fmt_points);
            failures.push(format!(
                "{}\n      draw.io:   {w}\n      setsquare: {g}",
                want.edge
            ));
        }
    }
    report(name, "routes", oracle.routes.len(), failures);
}

fn close(want: &[f64], got: &[f64]) -> bool {
    want.len() == got.len()
        && want
            .iter()
            .zip(got)
            .all(|(w, g)| (w - g).abs() <= POINT_TOLERANCE)
}

fn check_placement(name: &str) {
    let oracle = load(name);
    let mut failures = Vec::new();
    for want in &oracle.bounds {
        let model = &oracle.doc.pages()[want.page].model;
        let got = model
            .bounds(&CellId::new(&want.cell))
            .map(|r| vec![r.x, r.y, r.width, r.height]);
        if !got.as_deref().is_some_and(|g| close(&want.values, g)) {
            failures.push(format!(
                "bounds of {}: draw.io {:?}, setsquare {got:?}",
                want.cell, want.values
            ));
        }
    }
    for want in &oracle.labels {
        let model = &oracle.doc.pages()[want.page].model;
        let got = model
            .edge_label_point(&CellId::new(&want.cell))
            .map(|p| vec![p.x, p.y]);
        if !got.as_deref().is_some_and(|g| close(&want.values, g)) {
            failures.push(format!(
                "label of {}: draw.io {:?}, setsquare {got:?}",
                want.cell, want.values
            ));
        }
    }
    report(
        name,
        "shape bounds and label points",
        oracle.bounds.len() + oracle.labels.len(),
        failures,
    );
}

fn check_paint(name: &str) {
    let oracle = load(name);
    let mut failures = Vec::new();
    for want in &oracle.routes {
        let Some(points) = want.points.iter().copied().collect::<Option<Vec<Point>>>() else {
            continue;
        };
        let model = &oracle.doc.pages()[want.page].model;
        let style = model.style(&CellId::new(&want.edge)).expect("edge style");
        let mut got = Vec::new();
        if let Some(shape) = edge_shape(&points, &style) {
            got.push((shape.line.clone(), "none".to_owned(), shape.dash.clone()));
            for m in &shape.markers {
                let geometry = match &m.geometry {
                    MarkerGeometry::Path(d) => d.clone(),
                    MarkerGeometry::Ellipse { cx, cy, rx, ry } => {
                        format!("ellipse {cx} {cy} {rx} {ry}")
                    }
                };
                let fill = match m.fill {
                    MarkerFill::None => "none",
                    MarkerFill::Stroke => "filled",
                    MarkerFill::White => "#ffffff",
                };
                got.push((geometry, fill.to_owned(), None));
            }
        }
        let painted: Vec<&Painted> = oracle
            .paths
            .iter()
            .filter(|p| p.page == want.page && p.edge == want.edge)
            .collect();
        // "filled" means the stroke color, which is never white in these fixtures.
        let fills_match = |want: &Painted, got: &str| match got {
            "none" => want.fill == "none",
            "#ffffff" => want.fill.eq_ignore_ascii_case("#ffffff"),
            _ => want.fill != "none" && !want.fill.eq_ignore_ascii_case("#ffffff"),
        };
        let ok = painted.len() == got.len()
            && painted
                .iter()
                .zip(&got)
                .enumerate()
                .all(|(i, (w, (g, fill, dash)))| {
                    same_geometry(&w.geometry, g)
                        && (i == 0 || fills_match(w, fill))
                        && (i > 0 || w.dash == *dash)
                });
        if !ok {
            let mut detail = want.edge.clone();
            for (i, w) in painted.iter().enumerate() {
                let _ = write!(
                    detail,
                    "\n      draw.io   [{i}] fill={} dash={:?} {}",
                    w.fill, w.dash, w.geometry
                );
            }
            for (i, (g, fill, dash)) in got.iter().enumerate() {
                let _ = write!(
                    detail,
                    "\n      setsquare [{i}] fill={fill} dash={dash:?} {g}"
                );
            }
            failures.push(detail);
        }
    }
    report(name, "painted connectors", oracle.routes.len(), failures);
}

#[test]
fn routes_match_drawio_on_perimeters() {
    check_routes("routing/perimeters");
}

#[test]
fn routes_match_drawio_on_constraints() {
    check_routes("routing/constraints");
}

#[test]
fn routes_match_drawio_on_edge_styles() {
    check_routes("routing/styles");
}

#[test]
fn routes_match_drawio_on_markers_page() {
    check_routes("routing/markers");
}

#[test]
fn routes_match_drawio_on_templates() {
    for name in [
        "activity_diagram_1",
        "class_1",
        "cross_functional_flowchart_1",
    ] {
        check_routes(&format!("templates/{name}"));
    }
}

#[test]
fn paint_matches_drawio_on_markers() {
    check_paint("routing/markers");
}

#[test]
fn paint_matches_drawio_everywhere_else() {
    for name in [
        "routing/perimeters",
        "routing/constraints",
        "routing/styles",
        "templates/activity_diagram_1",
        "templates/class_1",
        "templates/cross_functional_flowchart_1",
    ] {
        check_paint(name);
    }
}

#[test]
fn shapes_and_labels_sit_where_drawio_puts_them() {
    for name in [
        "routing/labels",
        "routing/perimeters",
        "routing/constraints",
        "routing/styles",
        "templates/activity_diagram_1",
        "templates/class_1",
        "templates/cross_functional_flowchart_1",
        "templates/gantt_1",
    ] {
        check_placement(name);
    }
}

#[test]
fn routes_match_drawio_on_labels_page() {
    check_routes("routing/labels");
}
