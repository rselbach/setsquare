// Ported from draw.io at commit 9034053fba: mxgraph/src/view/mxGraphView.js (updateEdgeState and
// the functions it calls), mxgraph/src/view/mxGraph.js (getConnectionConstraint, isOrthogonal),
// mxgraph/src/view/mxCellState.js (getPerimeterBounds, setAbsoluteTerminalPoint),
// mxgraph/src/util/mxUtils.js (getRotatedPoint, unscale), and the overrides in
// js/grapheditor/Graph.js (getLegacyConnectionPoint, centerPerimeter).
// Copyright (c) JGraph Ltd, Apache License 2.0.

//! Connector routing: where an edge leaves and enters its terminals and which points it
//! passes through. This follows draw.io's edge pipeline in `mxGraphView.updateEdgeState`:
//! fixed connection points, then the edge style, then floating points on each terminal's
//! perimeter.

mod edge_style;
mod perimeter;

use std::f64::consts::PI;

use edge_style::{EdgeState, EdgeStyle};
use perimeter::Perimeter;

use crate::geometry::{Point, Rect};
use crate::model::{CellId, CellKind, Edge, Model, VertexGeometry};
use crate::style::Style;

/// Which way a shape faces, from its `direction` style. Anything else counts as east.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum Direction {
    #[default]
    East,
    West,
    North,
    South,
}

impl Direction {
    fn parse(style: &Style) -> Direction {
        match style.get("direction") {
            Some("west") => Direction::West,
            Some("north") => Direction::North,
            Some("south") => Direction::South,
            _ => Direction::East,
        }
    }

    fn is_vertical(self) -> bool {
        matches!(self, Direction::North | Direction::South)
    }
}

/// A connected shape as routing sees it: its bounds in page coordinates and the parts of
/// its effective style that routing reads, parsed once.
#[derive(Clone, Debug)]
struct Terminal {
    id: CellId,
    bounds: Rect,
    style: Style,
    perimeter: Option<Perimeter>,
    direction: Direction,
    /// Degrees clockwise.
    rotation: f64,
    flip_h: bool,
    flip_v: bool,
    /// The x of a relative geometry, which places a port along its parent's width.
    relative_x: Option<f64>,
}

impl Terminal {
    /// Returns the terminal for a vertex, or `None` when `id` is not a vertex with bounds.
    fn new(model: &Model, id: &CellId) -> Option<Terminal> {
        let CellKind::Vertex(vertex) = &model.cell(id)?.kind else {
            return None;
        };
        let style = model.style(id)?;
        Some(Terminal {
            id: id.clone(),
            bounds: model.bounds(id)?,
            perimeter: Perimeter::parse(&style),
            direction: Direction::parse(&style),
            rotation: style.number("rotation").unwrap_or(0.0),
            flip_h: style.flag("flipH"),
            flip_v: style.flag("flipV"),
            relative_x: match vertex.geometry {
                VertexGeometry::Relative { anchor, .. } => Some(anchor.x),
                VertexGeometry::Bounds(_) => None,
            },
            style,
        })
    }

    fn center(&self) -> Point {
        self.bounds.center()
    }

    /// The center that automatic routing aims for, moved by the fractions in
    /// `routingCenterX` and `routingCenterY`.
    fn routing_center(&self) -> Point {
        let c = self.bounds.center();
        let fx = self.style.number("routingCenterX").unwrap_or(0.0);
        let fy = self.style.number("routingCenterY").unwrap_or(0.0);
        Point::new(c.x + fx * self.bounds.width, c.y + fy * self.bounds.height)
    }

    /// The bounds connectors attach to: grown by the terminal's `perimeterSpacing` and by
    /// `border`.
    fn perimeter_bounds(&self, border: f64) -> Rect {
        let grow = border + self.style.number("perimeterSpacing").unwrap_or(0.0);
        let b = self.bounds;
        Rect::new(
            b.x - grow,
            b.y - grow,
            b.width + 2.0 * grow,
            b.height + 2.0 * grow,
        )
    }
}

/// A connection point from the edge's `exitX` and `exitY`, or `entryX` and `entryY`: a
/// fraction of the terminal's bounds plus an offset, projected onto the perimeter unless
/// `exitPerimeter` or `entryPerimeter` is 0.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Constraint {
    point: Point,
    perimeter: bool,
    dx: f64,
    dy: f64,
}

impl Constraint {
    fn parse(style: &Style, source: bool) -> Option<Constraint> {
        let [x, y, perimeter, dx, dy] = match source {
            true => ["exitX", "exitY", "exitPerimeter", "exitDx", "exitDy"],
            false => ["entryX", "entryY", "entryPerimeter", "entryDx", "entryDy"],
        };
        let offset = |key: &str| style.number(key).filter(|v| v.is_finite()).unwrap_or(0.0);
        Some(Constraint {
            point: Point::new(style.number(x)?, style.number(y)?),
            perimeter: style.get(perimeter).is_none_or(truthy),
            dx: offset(dx),
            dy: offset(dy),
        })
    }
}

/// Returns the route of edge `id` in page coordinates, or `None` when draw.io would not
/// draw it: it is not an edge, or an end has neither a visible terminal nor a loose point.
pub(crate) fn route(model: &Model, id: &CellId) -> Option<Vec<Point>> {
    let CellKind::Edge(edge) = &model.cell(id)?.kind else {
        return None;
    };
    let style = model.style(id)?;
    let origin = model.origin_of(&edge.parent);
    let geometry = &edge.geometry;
    let source = end_terminal(model, edge.source.as_ref())?;
    let target = end_terminal(model, edge.target.as_ref())?;
    if (source.is_none() && geometry.source_point.is_none())
        || (target.is_none() && geometry.target_point.is_none())
    {
        return None;
    }

    let source_constraint = Constraint::parse(&style, true);
    let target_constraint = Constraint::parse(&style, false);
    let p0 = fixed_point(
        source.as_ref(),
        source_constraint,
        geometry.source_point.map(|p| p + origin),
    );
    let pe = fixed_point(
        target.as_ref(),
        target_constraint,
        geometry.target_point.map(|p| p + origin),
    );

    let points: Vec<Point> = match collapsed_points_ignored(model, &style, edge) {
        true => Vec::new(),
        false => geometry.points.iter().map(|p| *p + origin).collect(),
    };
    let ends = (source.as_ref(), target.as_ref());
    let constraints = (source_constraint, target_constraint);
    let source_port = terminal_port(model, &style, true);
    let target_port = terminal_port(model, &style, false);
    let src = source_port.as_ref().or(source.as_ref());
    let trg = target_port.as_ref().or(target.as_ref());

    let mut pts = vec![p0];
    match edge_style(&style, points.len(), ends, constraints) {
        Some(router) => {
            let state = EdgeState {
                style: &style,
                p0,
                pe,
            };
            router.route(&state, src, trg, &points, &mut pts);
        }
        None => pts.extend(points.iter().copied().map(Some)),
    }
    pts.push(pe);

    let orthogonal = is_orthogonal(&style);
    let (first, last) = (pts[0], pts[pts.len() - 1]);
    if last.is_none()
        && target.is_some()
        && let Some(start) = trg
    {
        let next = next_point(&pts, source.as_ref(), false);
        let point = floating_point(&style, start, next, orthogonal, false);
        set_terminal_point(&mut pts, point, false);
    }
    if first.is_none()
        && source.is_some()
        && let Some(start) = src
    {
        let next = next_point(&pts, target.as_ref(), true);
        let point = floating_point(&style, start, next, orthogonal, true);
        set_terminal_point(&mut pts, point, true);
    }
    if style.number("fixedPointSpacing") == Some(1.0) {
        fixed_point_spacing(
            &mut pts,
            &style,
            first.is_some() && source.is_some(),
            last.is_some() && target.is_some(),
        );
    }

    let duplicates_router = edge_style(&style, geometry.points.len(), ends, constraints);
    let removes =
        duplicates_router.is_some_and(|r| r.removes_duplicates(!geometry.points.is_empty()));
    remove_duplicate_points(&mut pts, removes);

    match pts.as_slice() {
        [Some(_), .., Some(_)] => pts.into_iter().collect(),
        _ => None,
    }
}

/// Resolves one end's terminal to the shape draw.io shows it on: the terminal itself, or
/// its outermost collapsed or hidden ancestor below the layer. Returns `Some(None)` for an
/// end without a terminal and `None` when the terminal cannot be shown.
fn end_terminal(model: &Model, terminal: Option<&CellId>) -> Option<Option<Terminal>> {
    let Some(terminal) = terminal else {
        return Some(None);
    };
    let visible = visible_terminal(model, terminal)?;
    Terminal::new(model, &visible).map(Some)
}

/// `mxGraphView.getVisibleTerminal`.
fn visible_terminal(model: &Model, terminal: &CellId) -> Option<CellId> {
    let mut best = terminal.clone();
    let mut current = Some(terminal.clone());
    while let Some(id) = current {
        let cell = model.cell(&id)?;
        let best_visible = model.cell(&best).is_some_and(|c| c.visible);
        if !best_visible || cell.collapsed {
            best = id.clone();
        }
        current = cell.parent().cloned();
    }
    match model.cell(&best)?.kind {
        CellKind::Layer => None,
        _ => Some(best),
    }
}

/// `mxGraphView.isCollapsedPointsIgnored`: with `collapsedPoints=0`, an edge drops its
/// control points while a collapsed ancestor stands in for one of its terminals.
fn collapsed_points_ignored(model: &Model, style: &Style, edge: &Edge) -> bool {
    if style.number("collapsedPoints") != Some(0.0) {
        return false;
    }
    [&edge.source, &edge.target]
        .into_iter()
        .flatten()
        .any(|t| visible_terminal(model, t).is_some_and(|v| &v != t))
}

/// `mxGraphView.getTerminalPort`: the cell named by the edge's `sourcePort` or
/// `targetPort`, which then stands in for the terminal.
fn terminal_port(model: &Model, style: &Style, source: bool) -> Option<Terminal> {
    let key = if source { "sourcePort" } else { "targetPort" };
    Terminal::new(model, &CellId::new(style.get(key)?))
}

/// `mxGraphView.getEdgeStyle`: the loop style for a loop without enough control points,
/// else the edge style, unless `noEdgeStyle` is set.
fn edge_style(
    style: &Style,
    point_count: usize,
    (source, target): (Option<&Terminal>, Option<&Terminal>),
    (source_constraint, target_constraint): (Option<Constraint>, Option<Constraint>),
) -> Option<EdgeStyle> {
    let is_loop = matches!((source, target), (Some(s), Some(t)) if s.id == t.id);
    let constrained = source_constraint.is_some() || target_constraint.is_some();
    let orthogonal_loop = style.get("orthogonalLoop").is_some_and(truthy);
    if is_loop && point_count < 2 && (!orthogonal_loop || !constrained) {
        return match style.get("loopStyle") {
            Some(name) => EdgeStyle::parse(name),
            None => Some(EdgeStyle::Loop),
        };
    }
    if style.get("noEdgeStyle").is_some_and(truthy) {
        return None;
    }
    EdgeStyle::parse(style.get("edgeStyle")?)
}

/// `mxGraph.isOrthogonal`: whether floating ends keep the last segment horizontal or
/// vertical. The `orthogonal` style decides, else whether the edge style is orthogonal.
fn is_orthogonal(style: &Style) -> bool {
    match style.get("orthogonal") {
        Some(value) => truthy(value),
        None => {
            edge_style(style, 0, (None, None), (None, None)).is_some_and(EdgeStyle::is_orthogonal)
        }
    }
}

/// `mxGraphView.getFixedTerminalPoint`: the end fixed by a connection point, the center of
/// a `centerPerimeter` shape, or the loose point of an end without a terminal.
fn fixed_point(
    terminal: Option<&Terminal>,
    constraint: Option<Constraint>,
    loose: Option<Point>,
) -> Option<Point> {
    match (terminal, constraint) {
        (Some(t), _) if t.style.get("perimeter") == Some("centerPerimeter") => Some(t.center()),
        (Some(t), Some(c)) => Some(connection_point(t, c)),
        (Some(_), None) => None,
        (None, _) => loose,
    }
}

/// `Graph.getLegacyConnectionPoint`, which draw.io uses by default: the constraint's
/// point in the terminal's bounds, turned for the shape's direction, then either projected
/// onto the perimeter or flipped like the shape, and finally rotated with it.
fn connection_point(vertex: &Terminal, c: Constraint) -> Point {
    let mut bounds = vertex.perimeter_bounds(0.0);
    let center = bounds.center();
    let anchor_direction = vertex
        .style
        .get("anchorPointDirection")
        .is_none_or(|v| v.parse::<f64>() == Ok(1.0));
    let turned = vertex.style.get("direction").is_some() && anchor_direction;
    // The direction turns the point by quarter turns, with exact cosine and sine.
    let (r1, quarter) = match (turned, vertex.direction) {
        (true, Direction::South) => (90.0, Some((0.0, 1.0))),
        (true, Direction::West) => (180.0, Some((-1.0, 0.0))),
        (true, Direction::North) => (270.0, Some((0.0, -1.0))),
        _ => (0.0, None),
    };
    if turned && vertex.direction.is_vertical() {
        bounds = rotate90(bounds);
    }
    let mut point = Point::new(
        bounds.x + c.point.x * bounds.width + c.dx,
        bounds.y + c.point.y * bounds.height + c.dy,
    );
    let mut r2 = vertex.rotation;
    if c.perimeter {
        if let Some((cos, sin)) = quarter {
            point = rotate(point, cos, sin, center);
        }
        point = perimeter_point(vertex, point, false, 0.0);
    } else {
        r2 += r1;
        let (flip_h, flip_v) = match vertex.direction.is_vertical() {
            true => (vertex.flip_v, vertex.flip_h),
            false => (vertex.flip_h, vertex.flip_v),
        };
        let c = bounds.center();
        if flip_h {
            point.x = 2.0 * c.x - point.x;
        }
        if flip_v {
            point.y = 2.0 * c.y - point.y;
        }
    }
    if r2 != 0.0 {
        let rad = to_radians(r2);
        point = rotate(point, rad.cos(), rad.sin(), center);
    }
    point
}

/// `mxRectangle.rotate90`: swaps width and height about the center.
fn rotate90(r: Rect) -> Rect {
    let t = (r.width - r.height) / 2.0;
    Rect::new(r.x + t, r.y - t, r.height, r.width)
}

/// `mxGraphView.getPerimeterPoint`: where the line from `next` toward the terminal meets
/// its perimeter, honoring flips, or the terminal's center when it has no perimeter.
fn perimeter_point(terminal: &Terminal, next: Point, orthogonal: bool, border: f64) -> Point {
    let projected = terminal.perimeter.as_ref().and_then(|perimeter| {
        let bounds = terminal.perimeter_bounds(border);
        if !(bounds.width > 0.0 || bounds.height > 0.0) {
            return None;
        }
        let c = bounds.center();
        let flip = |p: Point| {
            Point::new(
                if terminal.flip_h {
                    2.0 * c.x - p.x
                } else {
                    p.x
                },
                if terminal.flip_v {
                    2.0 * c.y - p.y
                } else {
                    p.y
                },
            )
        };
        perimeter.project(bounds, flip(next), orthogonal).map(flip)
    });
    projected.unwrap_or_else(|| terminal.center())
}

/// `mxGraphView.getNextPoint`: the route's point beside the end, or the opposite
/// terminal's center when that is not known yet.
fn next_point(pts: &[Option<Point>], opposite: Option<&Terminal>, source: bool) -> Point {
    let n = pts.len();
    let beside = match (n >= 2, source) {
        (false, _) => None,
        (true, true) => pts[1.min(n - 1)],
        (true, false) => pts[n - 2],
    };
    beside
        .or(opposite.map(Terminal::center))
        .unwrap_or_default()
}

/// `mxGraphView.getFloatingTerminalPoint`: the end on `start`'s perimeter facing `next`,
/// computed in the shape's unrotated frame and kept clear by the edge's perimeter spacing.
fn floating_point(
    edge: &Style,
    start: &Terminal,
    next: Point,
    orthogonal: bool,
    source: bool,
) -> Point {
    let alpha = to_radians(start.rotation);
    let center = start.center();
    let next = match alpha != 0.0 {
        true => rotate(next, (-alpha).cos(), (-alpha).sin(), center),
        false => next,
    };
    let spacing = if source {
        "sourcePerimeterSpacing"
    } else {
        "targetPerimeterSpacing"
    };
    let border =
        edge.number("perimeterSpacing").unwrap_or(0.0) + edge.number(spacing).unwrap_or(0.0);
    let point = perimeter_point(start, next, alpha == 0.0 && orthogonal, border);
    match alpha != 0.0 {
        true => rotate(point, alpha.cos(), alpha.sin(), center),
        false => point,
    }
}

/// `mxCellState.setAbsoluteTerminalPoint`.
fn set_terminal_point(pts: &mut Vec<Option<Point>>, point: Point, source: bool) {
    match (source, pts.len()) {
        (true, 0) | (false, 1) => pts.push(Some(point)),
        (true, _) => pts[0] = Some(point),
        (false, 0) => pts.extend([None, Some(point)]),
        (false, n) => pts[n - 1] = Some(point),
    }
}

/// `mxGraphView.updateFixedPointSpacing`: with `fixedPointSpacing=1`, moves ends fixed by
/// connection points along their first segment by the edge's source or target perimeter
/// spacing, never past the neighboring point.
fn fixed_point_spacing(pts: &mut [Option<Point>], style: &Style, source: bool, target: bool) {
    let n = pts.len();
    if n < 2 {
        return;
    }
    let (Some(p0), Some(pe)) = (pts[0], pts[n - 1]) else {
        return;
    };
    let spacing = |key: &str, on: bool| match on {
        true => style.number(key).filter(|v| v.is_finite()).unwrap_or(0.0),
        false => 0.0,
    };
    let neighbor = |index: usize, forward: bool| -> Option<usize> {
        let pt = pts[index]?;
        let mut i = index;
        loop {
            i = match forward {
                true => i + 1,
                false => i.checked_sub(1)?,
            };
            let candidate = pts.get(i)?;
            if candidate.is_some_and(|c| c.x != pt.x || c.y != pt.y) {
                return Some(i);
            }
        }
    };
    let mut ds = spacing("sourcePerimeterSpacing", source);
    let mut dt = spacing("targetPerimeterSpacing", target);
    let ns = (ds != 0.0).then(|| neighbor(0, true)).flatten();
    let nt = (dt != 0.0).then(|| neighbor(n - 1, false)).flatten();
    let qs = ns.and_then(|i| pts[i]);
    let qt = nt.and_then(|i| pts[i]);
    let length = |a: Point, b: Option<Point>| b.map_or(0.0, |b| (b.x - a.x).hypot(b.y - a.y));
    let (ls, lt) = (length(p0, qs), length(pe, qt));
    // Keeps 1 unit of the segment so the direction of an arrowhead stays defined.
    let ms = (ls - 1.0).max(0.0);
    ds = ds.min(ms);
    dt = dt.min((lt - 1.0).max(0.0));
    if ns == Some(n - 1) && nt == Some(0) && ds > 0.0 && dt > 0.0 && ds + dt > ms {
        let f = ms / (ds + dt);
        ds *= f;
        dt *= f;
    }
    if let Some(qs) = qs
        && ds != 0.0
    {
        pts[0] = Some(Point::new(
            p0.x + (qs.x - p0.x) * ds / ls,
            p0.y + (qs.y - p0.y) * ds / ls,
        ));
    }
    if let Some(qt) = qt
        && dt != 0.0
    {
        pts[n - 1] = Some(Point::new(
            pe.x + (qt.x - pe.x) * dt / lt,
            pe.y + (qt.y - pe.y) * dt / lt,
        ));
    }
}

/// `mxGraphView.removeDuplicatePoints`: drops waypoints that repeat their neighbor, which
/// happens when a computed route ends inside a terminal. Only for routers that compute
/// every bend themselves; the ends always stay.
fn remove_duplicate_points(pts: &mut Vec<Option<Point>>, removes: bool) {
    if pts.len() <= 2 {
        return;
    }
    let same = |a: Option<Point>, b: Option<Point>| match (a, b) {
        (Some(a), Some(b)) => (a.x - b.x).abs() < 0.01 && (a.y - b.y).abs() < 0.01,
        _ => false,
    };
    let duplicates = pts.windows(2).any(|w| same(w[0], w[1]));
    if !duplicates || !removes {
        return;
    }
    let mut i = pts.len() - 2;
    while i > 0 && pts.len() > 2 {
        if same(pts[i], pts[i + 1]) || same(pts[i], pts[i - 1]) {
            pts.remove(i);
        }
        i -= 1;
    }
}

/// `mxUtils.getRotatedPoint`: `p` turned about `c` by the angle with `cos` and `sin`.
fn rotate(p: Point, cos: f64, sin: f64, c: Point) -> Point {
    let (x, y) = (p.x - c.x, p.y - c.y);
    Point::new(x * cos - y * sin + c.x, y * cos + x * sin + c.y)
}

/// `mxUtils.toRadians`, kept to draw.io's operation order.
fn to_radians(degrees: f64) -> f64 {
    PI * degrees / 180.0
}

/// JavaScript's `Math.round`: halves round up, toward positive infinity.
fn js_round(v: f64) -> f64 {
    let floor = v.floor();
    if v - floor >= 0.5 { floor + 1.0 } else { floor }
}

/// `mxUtils.unscale` at draw.io's scale 1 and no translation: rounds to a millionth.
fn unscale(v: f64) -> f64 {
    js_round(v * 1e6) / 1e6
}

/// `mxEdgeStyle.roundScaled`: rounds to a whole model unit.
fn round_scaled(v: f64) -> f64 {
    js_round(unscale(v))
}

/// Rounds to a tenth of a model unit, as the orthogonal and segment routers do.
fn tenth(v: f64) -> f64 {
    js_round(unscale(v) * 10.0) / 10.0
}

/// JavaScript truthiness of a style value, which draw.io parses as a number when it can.
fn truthy(value: &str) -> bool {
    match value.parse::<f64>() {
        Ok(n) => n != 0.0,
        Err(_) => !value.is_empty(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::change::Change;
    use crate::model::Cell;

    fn model(cells: Vec<Cell>) -> Model {
        let mut m = Model::new();
        m.apply(Change::Insert {
            cells: cells.into_iter().map(|c| (c, usize::MAX)).collect(),
        })
        .expect("insert cells");
        m
    }

    fn assert_route(m: &Model, edge: &str, want: &[Point], name: &str) {
        let got = route(m, &CellId::new(edge)).expect("route");
        let close = got.len() == want.len()
            && got
                .iter()
                .zip(want)
                .all(|(g, w)| (g.x - w.x).abs() < 1e-9 && (g.y - w.y).abs() < 1e-9);
        assert!(close, "{name}: got {got:?}, want {want:?}");
    }

    #[test]
    fn fixed_point_spacing_moves_fixed_ends_along_their_segment() {
        let layer = CellId::new("1");
        let fixed = "exitX=1;exitY=0.5;entryX=0;entryY=0.5;sourcePerimeterSpacing=5;\
                     targetPerimeterSpacing=10;";
        let tests = [
            (
                "fixed ends ignore perimeter spacing by default",
                fixed.to_owned(),
                [Point::new(100.0, 20.0), Point::new(200.0, 20.0)],
            ),
            (
                "fixedPointSpacing applies it",
                format!("{fixed}fixedPointSpacing=1;"),
                [Point::new(105.0, 20.0), Point::new(190.0, 20.0)],
            ),
        ];
        for (name, style, want) in tests {
            let m = model(vec![
                Cell::vertex(
                    CellId::new("greendale"),
                    layer.clone(),
                    Rect::new(0.0, 0.0, 100.0, 40.0),
                ),
                Cell::vertex(
                    CellId::new("study-room"),
                    layer.clone(),
                    Rect::new(200.0, 0.0, 100.0, 40.0),
                ),
                Cell::edge(
                    CellId::new("e"),
                    layer.clone(),
                    CellId::new("greendale"),
                    CellId::new("study-room"),
                )
                .with_style(&style),
            ]);
            assert_route(&m, "e", &want, name);
        }
    }

    #[test]
    fn edges_to_a_hidden_child_end_on_its_collapsed_container() {
        let layer = CellId::new("1");
        let mut study_group = Cell::vertex(
            CellId::new("study-group"),
            layer.clone(),
            Rect::new(0.0, 0.0, 100.0, 40.0),
        );
        study_group.collapsed = true;
        let m = model(vec![
            study_group,
            Cell::vertex(
                CellId::new("troy"),
                CellId::new("study-group"),
                Rect::new(10.0, 10.0, 20.0, 20.0),
            ),
            Cell::vertex(
                CellId::new("abed"),
                layer.clone(),
                Rect::new(200.0, 0.0, 100.0, 40.0),
            ),
            Cell::edge(
                CellId::new("e"),
                layer,
                CellId::new("troy"),
                CellId::new("abed"),
            ),
        ]);
        let want = [Point::new(100.0, 20.0), Point::new(200.0, 20.0)];
        assert_route(&m, "e", &want, "ends on the container, not the child");
    }
}
