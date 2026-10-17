// Ported from draw.io at commit 9034053fba, Copyright (c) JGraph Ltd, under the Apache
// License, Version 2.0: src/main/webapp/mxgraph/src/shape/mxConnector.js, mxPolyline.js,
// and mxShape.js, and src/main/webapp/mxgraph/src/util/mxAbstractCanvas2D.js and
// mxSvgCanvas2D.js.

//! How a connector is painted: its line, with rounded or curved corners and dashes, and its
//! arrowheads. This follows draw.io's `mxConnector`, `mxShape.addPoints`, and `mxMarker`.

mod marker;

use crate::geometry::Point;
use crate::style::Style;
use marker::{End, Marker};

/// draw.io's `mxConstants.LINE_ARCSIZE`: the default `arcSize` of rounded corners.
const LINE_ARCSIZE: f64 = 20.0;

/// The paint for one connector, as SVG path data in page coordinates.
#[derive(Clone, Debug, PartialEq)]
pub struct EdgeShape {
    /// The line, shortened at each end that has an arrowhead.
    pub line: String,
    /// The arrowhead elements, in the order draw.io paints them: the start's, then the end's.
    pub markers: Vec<MarkerPaint>,
    /// The stroke width of the line and its arrowheads.
    pub stroke_width: f64,
    /// The line's SVG `stroke-dasharray`, already scaled by the stroke width. Arrowheads are
    /// never dashed.
    pub dash: Option<String>,
}

/// One element of an arrowhead.
#[derive(Clone, Debug, PartialEq)]
pub struct MarkerPaint {
    pub geometry: MarkerGeometry,
    pub fill: MarkerFill,
}

/// How an arrowhead element is filled. Every element is outlined with the stroke color.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MarkerFill {
    /// Not filled.
    None,
    /// Filled with the stroke color.
    Stroke,
    /// Filled white, as draw.io fills the circle of a filled `ERzeroToOne` or
    /// `ERzeroToMany` arrowhead.
    White,
}

/// The shape of an arrowhead element.
#[derive(Clone, Debug, PartialEq)]
pub enum MarkerGeometry {
    /// SVG path data.
    Path(String),
    /// An ellipse, which draw.io uses for the `oval` and `circle` arrowheads.
    Ellipse { cx: f64, cy: f64, rx: f64, ry: f64 },
}

/// Returns the paint for a connector that follows `points`, using its effective `style`.
/// Returns `None` when the points do not span two distinct positions, because draw.io then
/// paints nothing.
pub fn edge_shape(points: &[Point], style: &Style) -> Option<EdgeShape> {
    let mut pts = waypoints(points);
    if pts.len() < 2 {
        return None;
    }
    let stroke_width = style.number("strokeWidth").unwrap_or(1.0);
    // Each arrowhead pulls its end of the line back before the line is painted. The source
    // goes first, so a two-point target arrowhead aims from the shortened start.
    let mut markers = arrowhead(style, End::Source, &mut pts, stroke_width);
    markers.extend(arrowhead(style, End::Target, &mut pts, stroke_width));
    Some(EdgeShape {
        line: line(&pts, style),
        markers,
        stroke_width,
        dash: dash(style, stroke_width),
    })
}

/// Drops each point that lies within one unit of the point before it, as draw.io's
/// `mxShape.getWaypoints` does at scale 1.
fn waypoints(points: &[Point]) -> Vec<Point> {
    let Some(&first) = points.first() else {
        return Vec::new();
    };
    let mut out = vec![first];
    for pair in points.windows(2) {
        let (prev, p) = (pair[0], pair[1]);
        if (prev.x - p.x).abs() >= 1.0 || (prev.y - p.y).abs() >= 1.0 {
            out.push(p);
        }
    }
    out
}

/// Moves the `end` of `pts` back to make room for that end's arrowhead and returns the
/// arrowhead's elements, or nothing when the style names no arrowhead draw.io knows. This is
/// `mxConnector.createMarker`.
fn arrowhead(style: &Style, end: End, pts: &mut [Point], stroke_width: f64) -> Vec<MarkerPaint> {
    let Some(marker) = Marker::from_style(style, end) else {
        return Vec::new();
    };
    let n = pts.len();
    let (from, tip) = match end {
        End::Source => (1, 0),
        End::Target => (n - 2, n - 1),
    };
    let d = pts[tip] - pts[from];
    let dist = (d.x * d.x + d.y * d.y).sqrt();
    let unit = Point::new(d.x / dist, d.y / dist);
    marker.draw(&mut pts[tip], unit, stroke_width)
}

/// Returns the line's path data, choosing the painter as `mxPolyline.paintEdgeShape` does.
fn line(pts: &[Point], style: &Style) -> String {
    if style.flag("bezier") {
        return bezier_line(pts);
    }
    if style.flag("curved") {
        return curved_line(pts);
    }
    let arc = style
        .flag("rounded")
        .then(|| style.number("arcSize").unwrap_or(LINE_ARCSIZE) / 2.0);
    polyline(pts, arc)
}

/// Joins the points with straight segments. With an `arc`, each corner is cut back by up to
/// `arc` along both segments and joined with a quadratic curve. This is `mxShape.addPoints`
/// for an open path.
fn polyline(pts: &[Point], arc: Option<f64>) -> String {
    let mut d = Path::default();
    let n = pts.len();
    let mut pt = pts[0];
    d.move_to(pt.x, pt.y);
    let mut i = 1;
    while i < n - 1 {
        let mut tmp = pts[i];
        let (dx, dy) = (pt.x - tmp.x, pt.y - tmp.y);
        match arc {
            Some(arc) if dx != 0.0 || dy != 0.0 => {
                let dist = (dx * dx + dy * dy).sqrt();
                let k = arc.min(dist / 2.0) / dist;
                d.line_to(tmp.x + dx * k, tmp.y + dy * k);
                // Skips points that round to the corner itself.
                let mut next = pts[i + 1];
                while i < n - 2
                    && js_round(next.x - tmp.x) == 0.0
                    && js_round(next.y - tmp.y) == 0.0
                {
                    next = pts[i + 2];
                    i += 1;
                }
                let (dx, dy) = (next.x - tmp.x, next.y - tmp.y);
                let dist = (dx * dx + dy * dy).sqrt().max(1.0);
                let k = arc.min(dist / 2.0) / dist;
                let end = Point::new(tmp.x + dx * k, tmp.y + dy * k);
                d.quad_to(tmp.x, tmp.y, end.x, end.y);
                tmp = end;
            }
            _ => d.line_to(tmp.x, tmp.y),
        }
        pt = tmp;
        i += 1;
    }
    let last = pts[n - 1];
    d.line_to(last.x, last.y);
    d.0
}

/// Curves through the midpoints between the inner points, using each inner point as a
/// control point. This is `mxPolyline.paintCurvedLine`.
fn curved_line(pts: &[Point]) -> String {
    let mut d = Path::default();
    let n = pts.len();
    d.move_to(pts[0].x, pts[0].y);
    for pair in pts[1..n - 1].windows(2) {
        let (p0, p1) = (pair[0], pair[1]);
        d.quad_to(p0.x, p0.y, (p0.x + p1.x) / 2.0, (p0.y + p1.y) / 2.0);
    }
    let (p0, p1) = (pts[n - 2], pts[n - 1]);
    d.quad_to(p0.x, p0.y, p1.x, p1.y);
    d.0
}

/// Treats the points as cubic Bézier control points when there are 3k + 1 of them, and
/// otherwise curves through them as `curved_line` does. This is
/// `mxPolyline.paintBezierLine`.
fn bezier_line(pts: &[Point]) -> String {
    let n = pts.len();
    if n == 2 {
        return polyline(pts, None);
    }
    if !(n - 1).is_multiple_of(3) {
        return curved_line(pts);
    }
    let mut d = Path::default();
    d.move_to(pts[0].x, pts[0].y);
    for [c1, c2, end] in pts[1..].as_chunks::<3>().0 {
        d.curve_to(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
    }
    d.0
}

/// Returns the line's SVG dash array when the style sets `dashed`: draw.io's `dashPattern`,
/// by default `3 3`, scaled by the stroke width unless `fixDash` is set. This is
/// `mxSvgCanvas2D.createDashPattern`.
fn dash(style: &Style, stroke_width: f64) -> Option<String> {
    if !style.flag("dashed") {
        return None;
    }
    let scale = if style.flag("fixDash") {
        1.0
    } else {
        stroke_width
    };
    let pattern: Vec<String> = style
        .get("dashPattern")
        .unwrap_or("3 3")
        .split(' ')
        // JavaScript's Number reads an empty string, as between two spaces, as 0.
        .map(|t| match t.trim() {
            "" => 0.0,
            t => t.parse().unwrap_or(f64::NAN),
        })
        .filter(|v| v.is_finite())
        .map(|v| round2(v * scale).to_string())
        .collect();
    (!pattern.is_empty()).then(|| pattern.join(" "))
}

/// SVG path data written as draw.io's `mxSvgCanvas2D` writes it: command letters and
/// numbers rounded to two decimals, all separated by spaces.
#[derive(Default)]
struct Path(String);

impl Path {
    fn move_to(&mut self, x: f64, y: f64) {
        self.op('M', &[x, y]);
    }

    fn line_to(&mut self, x: f64, y: f64) {
        self.op('L', &[x, y]);
    }

    fn quad_to(&mut self, x1: f64, y1: f64, x2: f64, y2: f64) {
        self.op('Q', &[x1, y1, x2, y2]);
    }

    fn curve_to(&mut self, x1: f64, y1: f64, x2: f64, y2: f64, x3: f64, y3: f64) {
        self.op('C', &[x1, y1, x2, y2, x3, y3]);
    }

    fn close(&mut self) {
        self.op('Z', &[]);
    }

    fn op(&mut self, command: char, numbers: &[f64]) {
        if !self.0.is_empty() {
            self.0.push(' ');
        }
        self.0.push(command);
        for &v in numbers {
            self.0.push(' ');
            self.0.push_str(&round2(v).to_string());
        }
    }
}

/// Rounds to two decimals, as draw.io does before writing a number into SVG.
fn round2(v: f64) -> f64 {
    // Adding zero turns -0 into 0, which is how JavaScript prints it.
    js_round(v * 100.0) / 100.0 + 0.0
}

/// Rounds to the nearest integer with ties towards positive infinity, as JavaScript's
/// `Math.round` does.
fn js_round(v: f64) -> f64 {
    let r = v.round();
    if v - r == 0.5 { r + 1.0 } else { r }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paint(points: &[(f64, f64)], style: &str) -> Option<EdgeShape> {
        let points: Vec<Point> = points.iter().map(|&(x, y)| Point::new(x, y)).collect();
        edge_shape(&points, &Style::parse(style))
    }

    #[test]
    fn a_route_without_two_distinct_points_paints_nothing() {
        assert_eq!(
            paint(&[(10.0, 10.0), (10.5, 10.9)], "endArrow=classic;"),
            None
        );
    }

    #[test]
    fn lines_follow_drawio_painters() {
        let tests = [
            (
                "bezier through control points",
                vec![(0.0, 0.0), (10.0, 0.0), (20.0, 10.0), (30.0, 10.0)],
                "bezier=1;",
                "M 0 0 C 10 0 20 10 30 10",
            ),
            (
                "bezier through other points curves",
                vec![(0.0, 0.0), (10.0, 0.0), (20.0, 10.0)],
                "bezier=1;",
                "M 0 0 Q 10 0 20 10",
            ),
            (
                "bezier with two points is straight",
                vec![(0.0, 0.0), (10.0, 0.0)],
                "bezier=1;",
                "M 0 0 L 10 0",
            ),
            (
                "rounded corner skips a point that rounds onto it",
                vec![
                    (0.0, 0.0),
                    (100.0, 0.0),
                    (100.75, 0.0),
                    (99.75, 0.0),
                    (100.0, 100.0),
                ],
                "rounded=1;",
                "M 0 0 L 90 0 Q 100 0 100 10 L 100 100",
            ),
        ];
        for (name, points, style, want) in tests {
            let got = paint(&points, style).expect(name);
            assert_eq!(got.line, want, "{name}");
        }
    }

    #[test]
    fn dash_arrays_follow_drawio() {
        let tests = [
            ("not dashed", "", None),
            ("default pattern", "dashed=1;strokeWidth=2;", Some("6 6")),
            (
                "fixed pattern",
                "dashed=1;strokeWidth=2;fixDash=1;",
                Some("3 3"),
            ),
            (
                "double space reads as zero",
                "dashed=1;dashPattern=8  8;",
                Some("8 0 8"),
            ),
            ("no numbers is solid", "dashed=1;dashPattern=none;", None),
        ];
        for (name, style, want) in tests {
            let got = paint(&[(0.0, 0.0), (100.0, 0.0)], style).expect(name);
            assert_eq!(got.dash.as_deref(), want, "{name}");
        }
    }

    #[test]
    fn mermaid_arrowheads_put_their_tip_on_the_end_point() {
        let tests = [
            ("mermaidExtension", "M 100 0 L 93 2.47 L 93 -2.47 Z"),
            (
                "mermaidDiamond",
                "M 100 0 L 96.5 2.47 L 93 0 L 96.5 -2.47 Z",
            ),
        ];
        for (arrow, want) in tests {
            let got =
                paint(&[(0.0, 0.0), (100.0, 0.0)], &format!("endArrow={arrow};")).expect(arrow);
            assert_eq!(got.line, "M 0 0 L 93 0", "{arrow}");
            assert_eq!(
                got.markers,
                vec![MarkerPaint {
                    geometry: MarkerGeometry::Path(want.to_owned()),
                    fill: MarkerFill::Stroke,
                }],
                "{arrow}"
            );
        }
    }

    #[test]
    fn filled_er_circles_are_white() {
        for arrow in ["ERzeroToOne", "ERzeroToMany"] {
            let got =
                paint(&[(0.0, 0.0), (100.0, 0.0)], &format!("endArrow={arrow};")).expect(arrow);
            let fills: Vec<MarkerFill> = got.markers.iter().map(|m| m.fill).collect();
            assert_eq!(fills, [MarkerFill::White, MarkerFill::None], "{arrow}");
        }
    }
}
