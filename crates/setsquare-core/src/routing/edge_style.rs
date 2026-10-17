// Ported from draw.io at commit 9034053fba: mxgraph/src/view/mxEdgeStyle.js, the isometric
// edge style in js/grapheditor/Shapes.js, and mxgraph/src/util/mxUtils.js (getPortConstraints,
// reversePortConstraints, getBoundingBox). Copyright (c) JGraph Ltd, Apache License 2.0.

//! Edge styles: the routers that add bends between a connector's two ends.
//!
//! Each router appends to `result`, which starts with the fixed source point or `None`,
//! exactly as draw.io's routers receive it. Several routers read that first entry or
//! count the entries, so it stays part of the shape.

use super::{Terminal, js_round, rotate, round_scaled, tenth, to_radians, unscale};
use crate::geometry::{Point, Rect};
use crate::style::Style;

/// A router from draw.io's style registry.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum EdgeStyle {
    Elbow,
    EntityRelation,
    Loop,
    SideToSide,
    TopToBottom,
    Orthogonal,
    Segment,
    Isometric,
}

/// What a router reads of the connector: its style and the ends that connection points
/// or loose points already fixed.
pub(super) struct EdgeState<'a> {
    pub style: &'a Style,
    pub p0: Option<Point>,
    pub pe: Option<Point>,
}

/// Port sides as draw.io's direction masks.
mod side {
    pub const NONE: u32 = 0;
    pub const WEST: u32 = 1;
    pub const NORTH: u32 = 2;
    pub const SOUTH: u32 = 4;
    pub const EAST: u32 = 8;
    pub const ALL: u32 = 15;
}

impl EdgeStyle {
    /// Returns the router registered under `name`, such as `orthogonalEdgeStyle`.
    pub(super) fn parse(name: &str) -> Option<EdgeStyle> {
        Some(match name {
            "elbowEdgeStyle" => EdgeStyle::Elbow,
            "entityRelationEdgeStyle" => EdgeStyle::EntityRelation,
            "loopEdgeStyle" => EdgeStyle::Loop,
            "sideToSideEdgeStyle" => EdgeStyle::SideToSide,
            "topToBottomEdgeStyle" => EdgeStyle::TopToBottom,
            "orthogonalEdgeStyle" => EdgeStyle::Orthogonal,
            "segmentEdgeStyle" => EdgeStyle::Segment,
            "isometricEdgeStyle" => EdgeStyle::Isometric,
            _ => return None,
        })
    }

    /// Reports whether the router draws only horizontal and vertical segments, which
    /// makes floating ends orthogonal unless the style says otherwise.
    pub(super) fn is_orthogonal(self) -> bool {
        match self {
            EdgeStyle::Segment
            | EdgeStyle::Elbow
            | EdgeStyle::SideToSide
            | EdgeStyle::TopToBottom
            | EdgeStyle::EntityRelation
            | EdgeStyle::Orthogonal => true,
            EdgeStyle::Loop | EdgeStyle::Isometric => false,
        }
    }

    /// Reports whether draw.io drops repeated waypoints from this router's routes: the
    /// routers that compute every bend themselves.
    pub(super) fn removes_duplicates(self, has_points: bool) -> bool {
        match self {
            EdgeStyle::Orthogonal => !has_points,
            EdgeStyle::Elbow
            | EdgeStyle::SideToSide
            | EdgeStyle::TopToBottom
            | EdgeStyle::EntityRelation
            | EdgeStyle::Isometric => true,
            EdgeStyle::Loop | EdgeStyle::Segment => false,
        }
    }

    /// Appends the bends of the route to `result`. `points` are the connector's control
    /// points in page coordinates.
    pub(super) fn route(
        self,
        edge: &EdgeState,
        source: Option<&Terminal>,
        target: Option<&Terminal>,
        points: &[Point],
        result: &mut Vec<Option<Point>>,
    ) {
        match self {
            EdgeStyle::Elbow => elbow(edge, source, target, points, result),
            EdgeStyle::EntityRelation => entity_relation(edge, source, target, result),
            EdgeStyle::Loop => loop_route(edge, source, points, result),
            EdgeStyle::SideToSide => side_to_side(edge, source, target, points, result),
            EdgeStyle::TopToBottom => top_to_bottom(edge, source, target, points, result),
            EdgeStyle::Orthogonal => orthogonal(edge, source, target, points, result),
            EdgeStyle::Segment => segment(edge, source, target, points, result),
            EdgeStyle::Isometric => isometric(edge, source, target, points, result),
        }
    }
}

/// A terminal's bounds and routing center, or a fixed end as an empty box at its point,
/// which is how draw.io's routers stand in for a terminal when the end is fixed.
#[derive(Clone, Copy)]
struct Area {
    rect: Rect,
    center: Point,
}

impl Area {
    fn of(t: &Terminal) -> Area {
        Area {
            rect: t.bounds,
            center: t.routing_center(),
        }
    }

    fn at(p: Point) -> Area {
        Area {
            rect: Rect::new(p.x, p.y, 0.0, 0.0),
            center: p,
        }
    }

    fn contains(&self, x: f64, y: f64) -> bool {
        self.rect.contains(Point::new(x, y))
    }
}

/// `mxUtils.getPortConstraints`: the sides a terminal allows, from its `portConstraint`
/// or the edge's source or target port constraint, turned with the shape when
/// `portConstraintRotation` is set.
fn port_constraints(terminal: &Terminal, edge: &Style, source: bool, default: u32) -> u32 {
    let key = if source {
        "sourcePortConstraint"
    } else {
        "targetPortConstraint"
    };
    let Some(directions) = terminal
        .style
        .get("portConstraint")
        .or_else(|| edge.get(key))
    else {
        return default;
    };
    let rotation = match terminal.style.number("portConstraintRotation") == Some(1.0) {
        true => terminal.rotation,
        false => 0.0,
    };
    let quad = match rotation {
        r if r >= 135.0 || r <= -135.0 => 2,
        r if r > 45.0 => 1,
        r if r < -45.0 => 3,
        _ => 0,
    };
    // Each side in turn order, so turning by a quarter moves one place along.
    let order = [side::NORTH, side::EAST, side::SOUTH, side::WEST];
    let mut mask = side::NONE;
    for (name, start) in [("north", 0), ("west", 3), ("south", 2), ("east", 1)] {
        if directions.contains(name) {
            mask |= order[(start + quad) % 4];
        }
    }
    mask
}

/// `mxUtils.reversePortConstraints`: swaps west with east and north with south.
fn reverse_sides(mask: u32) -> u32 {
    ((mask & side::WEST) << 3)
        | ((mask & side::NORTH) << 1)
        | ((mask & side::SOUTH) >> 1)
        | ((mask & side::EAST) >> 3)
}

/// The terminal with its bounds rounded to a tenth of a unit, as draw.io's orthogonal and
/// segment routers compute in model units.
fn scaled(t: &Terminal) -> Terminal {
    Terminal {
        bounds: Rect::new(
            tenth(t.bounds.x),
            tenth(t.bounds.y),
            tenth(t.bounds.width),
            tenth(t.bounds.height),
        ),
        ..t.clone()
    }
}

fn scaled_point(p: Point) -> Point {
    Point::new(tenth(p.x), tenth(p.y))
}

fn elbow(
    edge: &EdgeState,
    source: Option<&Terminal>,
    target: Option<&Terminal>,
    points: &[Point],
    result: &mut Vec<Option<Point>>,
) {
    let mut vertical = false;
    let mut horizontal = false;
    if let (Some(s), Some(t)) = (source, target) {
        let (s, t) = (s.bounds, t.bounds);
        match points.first() {
            Some(pt) => {
                let left = s.x.min(t.x);
                let right = s.right().max(t.right());
                let top = s.y.min(t.y);
                let bottom = s.bottom().max(t.bottom());
                vertical = pt.y < top || pt.y > bottom;
                horizontal = pt.x < left || pt.x > right;
            }
            None => {
                let left = s.x.max(t.x);
                let right = s.right().min(t.right());
                vertical = left == right;
                if !vertical {
                    let top = s.y.max(t.y);
                    let bottom = s.bottom().min(t.bottom());
                    horizontal = top == bottom;
                }
            }
        }
    }
    if !horizontal && (vertical || edge.style.get("elbow") == Some("vertical")) {
        top_to_bottom(edge, source, target, points, result);
    } else {
        side_to_side(edge, source, target, points, result);
    }
}

fn side_to_side(
    edge: &EdgeState,
    source: Option<&Terminal>,
    target: Option<&Terminal>,
    points: &[Point],
    result: &mut Vec<Option<Point>>,
) {
    let pt = points.first().copied();
    let source = edge.p0.map(Area::at).or(source.map(Area::of));
    let target = edge.pe.map(Area::at).or(target.map(Area::of));
    let (Some(s), Some(t)) = (source, target) else {
        return;
    };
    let l = s.rect.x.max(t.rect.x);
    let r = s.rect.right().min(t.rect.right());
    let x = pt.map_or_else(|| round_scaled(r + (l - r) / 2.0), |p| p.x);
    let mut y1 = s.center.y;
    let mut y2 = t.center.y;
    if let Some(pt) = pt {
        if pt.y >= s.rect.y && pt.y <= s.rect.bottom() {
            y1 = pt.y;
        }
        if pt.y >= t.rect.y && pt.y <= t.rect.bottom() {
            y2 = pt.y;
        }
    }
    let outside = |x: f64, y: f64| !t.contains(x, y) && !s.contains(x, y);
    if outside(x, y1) {
        result.push(Some(Point::new(x, y1)));
    }
    if outside(x, y2) {
        result.push(Some(Point::new(x, y2)));
    }
    if result.len() == 1 {
        match pt {
            Some(pt) if outside(x, pt.y) => result.push(Some(Point::new(x, pt.y))),
            Some(_) => {}
            None => {
                let top = s.rect.y.max(t.rect.y);
                let bottom = s.rect.bottom().min(t.rect.bottom());
                result.push(Some(Point::new(x, top + (bottom - top) / 2.0)));
            }
        }
    }
}

fn top_to_bottom(
    edge: &EdgeState,
    source: Option<&Terminal>,
    target: Option<&Terminal>,
    points: &[Point],
    result: &mut Vec<Option<Point>>,
) {
    let pt = points.first().copied();
    let source = edge.p0.map(Area::at).or(source.map(Area::of));
    let target = edge.pe.map(Area::at).or(target.map(Area::of));
    let (Some(s), Some(t)) = (source, target) else {
        return;
    };
    let top = s.rect.y.max(t.rect.y);
    let bottom = s.rect.bottom().min(t.rect.bottom());
    let within = |area: &Area, x: f64| x >= area.rect.x && x <= area.rect.right();
    let mut x = match pt {
        Some(pt) if within(&s, pt.x) => pt.x,
        _ => s.center.x,
    };
    let y = pt.map_or_else(|| round_scaled(bottom + (top - bottom) / 2.0), |p| p.y);
    let outside = |x: f64, y: f64| !t.contains(x, y) && !s.contains(x, y);
    if outside(x, y) {
        result.push(Some(Point::new(x, y)));
    }
    x = match pt {
        Some(pt) if within(&t, pt.x) => pt.x,
        _ => t.center.x,
    };
    if outside(x, y) {
        result.push(Some(Point::new(x, y)));
    }
    if result.len() == 1 {
        match pt {
            Some(pt) if outside(pt.x, y) => result.push(Some(Point::new(pt.x, y))),
            Some(_) => {}
            None => {
                let l = s.rect.x.max(t.rect.x);
                let r = s.rect.right().min(t.rect.right());
                result.push(Some(Point::new(l + (r - l) / 2.0, y)));
            }
        }
    }
}

fn entity_relation(
    edge: &EdgeState,
    source: Option<&Terminal>,
    target: Option<&Terminal>,
    result: &mut Vec<Option<Point>>,
) {
    let segment = edge.style.number("segment").unwrap_or(30.0);
    let (p0, pe) = (edge.p0, edge.pe);
    let is_less = |a: f64, b: f64| unscale(a) < unscale(b);

    let mut source_left = false;
    if let Some(s) = source {
        match (s.relative_x, target) {
            (Some(x), _) => source_left = x <= 0.5,
            (None, Some(t)) => {
                source_left = is_less(
                    pe.map_or(t.bounds.right(), |p| p.x),
                    p0.map_or(s.bounds.x, |p| p.x),
                );
            }
            (None, None) => {}
        }
    }
    let source_area = match (p0, source) {
        (Some(p), _) => Area::at(p),
        (None, Some(s)) => {
            let constraint = port_constraints(s, edge.style, true, side::NONE);
            if constraint != side::NONE && constraint != side::WEST + side::EAST {
                source_left = constraint == side::WEST;
            }
            Area::of(s)
        }
        (None, None) => return,
    };

    // A fixed source end is an empty box at its point, so its right side is its x.
    let mut target_left = true;
    if let Some(t) = target {
        target_left = match t.relative_x {
            Some(x) => x <= 0.5,
            None => is_less(source_area.rect.right(), pe.map_or(t.bounds.x, |p| p.x)),
        };
    }
    let target_area = match (pe, target) {
        (Some(p), _) => Area::at(p),
        (None, Some(t)) => {
            let constraint = port_constraints(t, edge.style, false, side::NONE);
            if constraint != side::NONE && constraint != side::WEST + side::EAST {
                target_left = constraint == side::WEST;
            }
            Area::of(t)
        }
        (None, None) => return,
    };

    let (s, t) = (source_area, target_area);
    let x0 = if source_left {
        s.rect.x
    } else {
        s.rect.right()
    };
    let y0 = s.center.y;
    let xe = if target_left {
        t.rect.x
    } else {
        t.rect.right()
    };
    let ye = t.center.y;
    let dep = Point::new(x0 + if source_left { -segment } else { segment }, y0);
    let arr = Point::new(xe + if target_left { -segment } else { segment }, ye);
    if source_left == target_left {
        let x = match source_left {
            true => x0.min(xe) - segment,
            false => x0.max(xe) + segment,
        };
        result.push(Some(Point::new(x, y0)));
        result.push(Some(Point::new(x, ye)));
    } else if is_less(dep.x, arr.x) == source_left {
        let mid_y = y0 + (ye - y0) / 2.0;
        result.push(Some(dep));
        result.push(Some(Point::new(dep.x, mid_y)));
        result.push(Some(Point::new(arr.x, mid_y)));
        result.push(Some(arr));
    } else {
        result.push(Some(dep));
        result.push(Some(arr));
    }
}

/// The grid size draw.io uses for a loop's default segment. The oracle's graph keeps
/// mxGraph's default, and the model does not carry the page grid.
const GRID_SIZE: f64 = 10.0;

fn loop_route(
    edge: &EdgeState,
    source: Option<&Terminal>,
    points: &[Point],
    result: &mut Vec<Option<Point>>,
) {
    if edge.p0.is_some() && edge.pe.is_some() {
        result.extend(points.iter().copied().map(Some));
        return;
    }
    let Some(source) = source else {
        return;
    };
    let s = source.bounds;
    let center = source.routing_center();
    let pt = points.first().copied().filter(|p| !s.contains(*p));
    let seg = edge.style.number("segment").unwrap_or(GRID_SIZE);
    let dir = edge.style.get("direction").unwrap_or("west");
    let (mut x, mut dx, mut y, mut dy) = (0.0, 0.0, 0.0, 0.0);
    if dir == "north" || dir == "south" {
        x = center.x;
        dx = seg;
    } else {
        y = center.y;
        dy = seg;
    }
    match pt {
        Some(pt) if pt.x >= s.x && pt.x <= s.right() => {
            x = center.x;
            dx = (x - pt.x).abs().max(dy);
            y = pt.y;
            dy = 0.0;
        }
        Some(pt) => {
            x = pt.x;
            dy = (y - pt.y).abs().max(dy);
        }
        None => match dir {
            "north" => y = s.y - 2.0 * dx,
            "south" => y = s.bottom() + 2.0 * dx,
            "east" => x = s.x - 2.0 * dy,
            _ => x = s.right() + 2.0 * dy,
        },
    }
    result.push(Some(Point::new(x - dx, y - dy)));
    result.push(Some(Point::new(x + dx, y + dy)));
}

fn isometric(
    edge: &EdgeState,
    source: Option<&Terminal>,
    target: Option<&Terminal>,
    points: &[Point],
    result: &mut Vec<Option<Point>>,
) {
    let Some(p0) = edge.p0.or(source.map(|s| s.bounds.center())) else {
        return;
    };
    let Some(pe) = edge.pe.or(target.map(|t| t.bounds.center())) else {
        return;
    };
    // The isometric axes: the x axis turned by -30 and -150 degrees.
    let axis = |deg: f64| {
        rotate(
            Point::new(1.0, 0.0),
            to_radians(deg).cos(),
            to_radians(deg).sin(),
            Point::default(),
        )
    };
    let (a, b) = (axis(-30.0), axis(-150.0));
    let elbow = edge.style.get("elbow").unwrap_or("horizontal") == "horizontal";
    let mut last = p0;
    let mut line_to = |to: Point, ignore_first: bool| {
        let (c1, c2) = (to.x - last.x, to.y - last.y);
        let h = (b.y * c1 - b.x * c2) / (a.x * b.y - a.y * b.x);
        let v = (a.y * c1 - a.x * c2) / (a.y * b.x - a.x * b.y);
        let (first, second) = match elbow {
            true => ((a, h), (b, v)),
            false => ((b, v), (a, h)),
        };
        if ignore_first {
            last = Point::new(last.x + first.0.x * first.1, last.y + first.0.y * first.1);
            result.push(Some(last));
        }
        last = Point::new(
            last.x + second.0.x * second.1,
            last.y + second.0.y * second.1,
        );
        result.push(Some(last));
    };
    let pt = points.first().copied().unwrap_or(Point::new(
        p0.x + (pe.x - p0.x) / 2.0,
        p0.y + (pe.y - p0.y) / 2.0,
    ));
    line_to(pt, true);
    line_to(pe, false);
}

fn segment(
    edge: &EdgeState,
    source_terminal: Option<&Terminal>,
    target_terminal: Option<&Terminal>,
    control_hints: &[Point],
    result: &mut Vec<Option<Point>>,
) {
    let pts = [edge.p0.map(scaled_point), edge.pe.map(scaled_point)];
    let source = source_terminal.map(scaled);
    let target = target_terminal.map(scaled);
    let tol = 1.0;
    let mut temp_points: Vec<Point> = Vec::new();
    let mut last_pushed = result
        .first()
        .copied()
        .flatten()
        .map(|p| Point::new(unscale(p.x), unscale(p.y)));
    let start = match pts[0] {
        None => source.as_ref().map(Terminal::routing_center),
        some => some,
    };
    // The last hint, the orientation of the segment through it, and the fixed target end,
    // which draw.io only reads for the final clean-up when there are hints.
    let (hint, horizontal, fixed_end) = match control_hints.is_empty() {
        true => (start, true, None),
        false => {
            let Some(start) = start else {
                return;
            };
            let ends = (source.as_ref(), target.as_ref());
            let (hint, horizontal) =
                follow_hints(pts, ends, start, control_hints, &mut temp_points);
            (Some(hint), horizontal, pts[1])
        }
    };

    let last = match pts[1] {
        None => target.as_ref().map(Terminal::routing_center),
        some => some,
    };
    if let (Some(last), Some(hint)) = (last, hint)
        && bends(horizontal, pts[1], target.as_ref(), hint)
    {
        temp_points.push(match horizontal {
            true => Point::new(last.x, hint.y),
            false => Point::new(hint.x, last.y),
        });
    }

    let same_terminal = match (source_terminal, target_terminal) {
        (Some(s), Some(t)) => s.id == t.id,
        _ => false,
    };
    let inner_loop = edge.style.number("innerLoopWaypoints") == Some(1.0);
    if !same_terminal || !inner_loop {
        if let (None, Some(s)) = (pts[0], &source) {
            while temp_points.first().is_some_and(|p| s.bounds.contains(*p)) {
                temp_points.remove(0);
            }
        }
        if let (None, Some(t)) = (pts[1], &target) {
            while temp_points.last().is_some_and(|p| t.bounds.contains(*p)) {
                temp_points.pop();
            }
        }
    }

    for p in temp_points {
        let p = Point::new(js_round(p.x * 10.0) / 10.0, js_round(p.y * 10.0) / 10.0);
        let far =
            last_pushed.is_none_or(|lp| (lp.x - p.x).abs() >= tol || (lp.y - p.y).abs() >= tol);
        if far {
            result.push(Some(p));
            last_pushed = Some(p);
        }
    }

    let Some(pe) = fixed_end else {
        return;
    };
    let near = |p: Point| (pe.x - unscale(p.x)).abs() <= tol && (pe.y - unscale(p.y)).abs() <= tol;
    if let Some(Some(last)) = result.last()
        && near(*last)
    {
        result.pop();
        if let Some(Some(last)) = result.last_mut() {
            if (unscale(last.x) - pe.x).abs() < tol {
                last.x = pe.x;
            }
            if (unscale(last.y) - pe.y).abs() < tol {
                last.y = pe.y;
            }
        }
    }
}

/// Whether the segment from an end toward `hint` must bend first: a fixed end off the
/// hint's row (or column when vertical), or a floating end whose terminal does not span it.
fn bends(horizontal: bool, fixed: Option<Point>, terminal: Option<&Terminal>, hint: Point) -> bool {
    match (horizontal, fixed) {
        (true, Some(p)) => p.y != hint.y,
        (false, Some(p)) => p.x != hint.x,
        (true, None) => terminal.is_some_and(|t| hint.y < t.bounds.y || hint.y > t.bounds.bottom()),
        (false, None) => terminal.is_some_and(|t| hint.x < t.bounds.x || hint.x > t.bounds.right()),
    }
}

/// Lays the segment connector's bends through the hints from `start`. The first
/// segment's orientation comes from how the hints line up with the ends; after that the
/// segments alternate. Returns the last hint and the orientation of the last segment.
fn follow_hints(
    pts: [Option<Point>; 2],
    (source, target): (Option<&Terminal>, Option<&Terminal>),
    start: Point,
    control_hints: &[Point],
    temp_points: &mut Vec<Point>,
) -> (Point, bool) {
    let tol = 1.0;
    let mut hints: Vec<Point> = control_hints
        .iter()
        .map(|h| Point::new(unscale(h.x), unscale(h.y)))
        .collect();
    let snap = |hint: &mut Point, to: Point| {
        if (hint.x - to.x).abs() < tol {
            hint.x = to.x;
        }
        if (hint.y - to.y).abs() < tol {
            hint.y = to.y;
        }
    };
    snap(&mut hints[0], start);
    if let Some(pe) = pts[1] {
        let last = hints.len() - 1;
        snap(&mut hints[last], pe);
    }
    let first = hints[0];

    let mut horizontal = true;
    let mut current = (pts[0], source);
    let mut current_hint = first;
    for i in 0..2 {
        let (fixed, terminal) = current;
        let terminal = terminal.filter(|_| fixed.is_none());
        let fixed_vert_align = fixed.is_some_and(|p| p.x == current_hint.x);
        let fixed_hoz_align = fixed.is_some_and(|p| p.y == current_hint.y);
        let in_hoz_chan = terminal
            .is_some_and(|t| current_hint.y >= t.bounds.y && current_hint.y <= t.bounds.bottom());
        let in_vert_chan = terminal
            .is_some_and(|t| current_hint.x >= t.bounds.x && current_hint.x <= t.bounds.right());
        let hoz_chan = fixed_hoz_align || (fixed.is_none() && in_hoz_chan);
        let vert_chan = fixed_vert_align || (fixed.is_none() && in_vert_chan);
        // A hint in both channels, or on a fixed end, says nothing: try the target end.
        let ambiguous = (hoz_chan && vert_chan) || (fixed_vert_align && fixed_hoz_align);
        if i != 0 || !ambiguous {
            if fixed.is_some()
                && !fixed_hoz_align
                && !fixed_vert_align
                && (in_hoz_chan || in_vert_chan)
            {
                horizontal = !in_hoz_chan;
                break;
            }
            if vert_chan || hoz_chan {
                horizontal = match i {
                    1 if hints.len() % 2 == 1 => vert_chan,
                    _ => hoz_chan,
                };
                break;
            }
        }
        current = (pts[1], target);
        if let Some(&last) = hints.last() {
            current_hint = last;
        }
        if fixed_vert_align && fixed_hoz_align && !hints.is_empty() {
            hints.remove(0);
        }
    }

    let mut at = start;
    if bends(horizontal, pts[0], source, first) {
        temp_points.push(match horizontal {
            true => Point::new(at.x, first.y),
            false => Point::new(first.x, at.y),
        });
    }
    if horizontal {
        at.y = first.y;
    } else {
        at.x = first.x;
    }
    let mut hint = first;
    for h in hints {
        horizontal = !horizontal;
        hint = h;
        if horizontal {
            at.y = h.y;
        } else {
            at.x = h.x;
        }
        temp_points.push(at);
    }
    (hint, horizontal)
}

/// The jetty draw.io leaves before an orthogonal connector turns: the edge's
/// `sourceJettySize` or `targetJettySize`, else `jettySize`, else 10. `auto` makes room
/// for the arrowhead.
fn jetty_size(style: &Style, source: bool) -> f64 {
    const BUFFER: f64 = 10.0;
    let (key, arrow, size) = match source {
        true => ("sourceJettySize", "startArrow", "startSize"),
        false => ("targetJettySize", "endArrow", "endSize"),
    };
    let value = style.get(key).or_else(|| style.get("jettySize"));
    match value {
        Some("auto") if style.get(arrow).is_some_and(|a| a != "none") => {
            let size = style.number(size).unwrap_or(6.0);
            ((size + BUFFER) / BUFFER).ceil().max(2.0) * BUFFER
        }
        Some("auto") => 2.0 * BUFFER,
        Some(v) => v.parse().unwrap_or(BUFFER),
        None => BUFFER,
    }
}

/// draw.io's orthogonal route patterns, indexed by source and target side relative to the
/// quadrant the target lies in. Each entry packs a direction, a side, and flags.
const ROUTE_PATTERNS: [[&[u32]; 4]; 4] = [
    [
        &[513, 2308, 2081, 2562],
        &[513, 1090, 514, 2184, 2114, 2561],
        &[513, 1090, 514, 2564, 2184, 2562],
        &[513, 2308, 2561, 1090, 514, 2568, 2308],
    ],
    [
        &[514, 1057, 513, 2308, 2081, 2562],
        &[514, 2184, 2114, 2561],
        &[514, 2184, 2562, 1057, 513, 2564, 2184],
        &[514, 1057, 513, 2568, 2308, 2561],
    ],
    [
        &[1090, 514, 1057, 513, 2308, 2081, 2562],
        &[2114, 2561],
        &[1090, 2562, 1057, 513, 2564, 2184],
        &[1090, 514, 1057, 513, 2308, 2561, 2568],
    ],
    [
        &[2081, 2562],
        &[1057, 513, 1090, 514, 2184, 2114, 2561],
        &[1057, 513, 1090, 514, 2184, 2562, 2564],
        &[1057, 2561, 1090, 514, 2568, 2308],
    ],
];
const DIR_VECTORS: [[f64; 2]; 7] = [
    [-1.0, 0.0],
    [0.0, -1.0],
    [1.0, 0.0],
    [0.0, 1.0],
    [-1.0, 0.0],
    [0.0, -1.0],
    [1.0, 0.0],
];
const SIDE_MASK: u32 = 480;
const CENTER_MASK: u32 = 512;
const SOURCE_MASK: u32 = 1024;
const TARGET_MASK: u32 = 2048;

/// `mxUtils.getBoundingBox`: the bounds of `rect` turned by `degrees` about its center.
fn rotated_bounds(rect: Rect, degrees: f64) -> Rect {
    let rad = to_radians(degrees);
    let (cos, sin) = (rad.cos(), rad.sin());
    let c = rect.center();
    let corners = [
        Point::new(rect.x, rect.y),
        Point::new(rect.right(), rect.y),
        Point::new(rect.right(), rect.bottom()),
        Point::new(rect.x, rect.bottom()),
    ]
    .map(|p| rotate(p, cos, sin, c));
    let x = corners.iter().map(|p| p.x).fold(f64::INFINITY, f64::min);
    let y = corners.iter().map(|p| p.y).fold(f64::INFINITY, f64::min);
    let right = corners
        .iter()
        .map(|p| p.x)
        .fold(f64::NEG_INFINITY, f64::max);
    let bottom = corners
        .iter()
        .map(|p| p.y)
        .fold(f64::NEG_INFINITY, f64::max);
    Rect::new(x, y, right - x, bottom - y)
}

fn orthogonal(
    edge: &EdgeState,
    source_terminal: Option<&Terminal>,
    target_terminal: Option<&Terminal>,
    control_hints: &[Point],
    result: &mut Vec<Option<Point>>,
) {
    let p0 = edge.p0.map(scaled_point);
    let pe = edge.pe.map(scaled_point);
    let source = source_terminal.map(scaled);
    let target = target_terminal.map(scaled);
    let unit = |p: Point| Rect::new(p.x, p.y, 1.0, 1.0);
    let Some(mut source_rect) = source.as_ref().map(|s| s.bounds).or(p0.map(unit)) else {
        return;
    };
    let Some(mut target_rect) = target.as_ref().map(|t| t.bounds).or(pe.map(unit)) else {
        return;
    };
    // draw.io widens both jetties for loops by comparing two fresh copies of the source,
    // which never match, so that branch is left out.
    let source_buffer = jetty_size(edge.style, true);
    let target_buffer = jetty_size(edge.style, false);
    let total_buffer = target_buffer + source_buffer;

    let too_short = match (p0, pe) {
        (Some(a), Some(b)) => {
            let (dx, dy) = (b.x - a.x, b.y - a.y);
            dx * dx + dy * dy < total_buffer * total_buffer
        }
        _ => false,
    };
    if too_short || !control_hints.is_empty() {
        segment(
            edge,
            source_terminal,
            target_terminal,
            control_hints,
            result,
        );
        return;
    }

    let mut port_constraint = [side::ALL, side::ALL];
    if let Some(s) = &source {
        port_constraint[0] = port_constraints(s, edge.style, true, side::ALL);
        if s.rotation != 0.0 {
            source_rect = rotated_bounds(source_rect, s.rotation);
        }
    }
    if let Some(t) = &target {
        port_constraint[1] = port_constraints(t, edge.style, false, side::ALL);
        if t.rotation != 0.0 {
            target_rect = rotated_bounds(target_rect, t.rotation);
        }
    }
    if source_rect.width == 0.0
        || source_rect.height == 0.0
        || target_rect.width == 0.0
        || target_rect.height == 0.0
    {
        return;
    }

    let mut dir = [0u32, 0u32];
    let geo = [
        [
            source_rect.x,
            source_rect.y,
            source_rect.width,
            source_rect.height,
        ],
        [
            target_rect.x,
            target_rect.y,
            target_rect.width,
            target_rect.height,
        ],
    ];
    let buffer = [source_buffer, target_buffer];
    let mut limits = [[0.0f64; 9]; 2];
    for i in 0..2 {
        limits[i][1] = geo[i][0] - buffer[i];
        limits[i][2] = geo[i][1] - buffer[i];
        limits[i][4] = geo[i][0] + geo[i][2] + buffer[i];
        limits[i][8] = geo[i][1] + geo[i][3] + buffer[i];
    }

    let source_cen_x = geo[0][0] + geo[0][2] / 2.0;
    let source_cen_y = geo[0][1] + geo[0][3] / 2.0;
    let target_cen_x = geo[1][0] + geo[1][2] / 2.0;
    let target_cen_y = geo[1][1] + geo[1][3] / 2.0;
    let dx = source_cen_x - target_cen_x;
    let dy = source_cen_y - target_cen_y;
    // 0 | 1
    // -----
    // 3 | 2
    let quad: u32 = match (dx < 0.0, dy < 0.0) {
        (true, true) => 2,
        (true, false) => 1,
        (false, _) if dy <= 0.0 && dx == 0.0 => 2,
        (false, _) if dy <= 0.0 => 3,
        (false, _) => 0,
    };

    let mut constraint = [[0.5f64, 0.5f64], [0.5, 0.5]];
    if source.is_none() {
        constraint[0] = [0.0, 0.0];
    }
    if target.is_none() {
        constraint[1] = [0.0, 0.0];
    }
    let fixed = [
        p0.filter(|_| source.is_some()),
        pe.filter(|_| target.is_some()),
    ];
    for i in 0..2 {
        let Some(term) = fixed[i] else {
            continue;
        };
        constraint[i][0] = (term.x - geo[i][0]) / geo[i][2];
        if (term.x - geo[i][0]).abs() <= 1.0 {
            dir[i] = side::WEST;
        } else if (term.x - geo[i][0] - geo[i][2]).abs() <= 1.0 {
            dir[i] = side::EAST;
        }
        constraint[i][1] = (term.y - geo[i][1]) / geo[i][3];
        if (term.y - geo[i][1]).abs() <= 1.0 {
            dir[i] = side::NORTH;
        } else if (term.y - geo[i][1] - geo[i][3]).abs() <= 1.0 {
            dir[i] = side::SOUTH;
        }
    }

    let source_top_dist = geo[0][1] - (geo[1][1] + geo[1][3]);
    let source_left_dist = geo[0][0] - (geo[1][0] + geo[1][2]);
    let source_bottom_dist = geo[1][1] - (geo[0][1] + geo[0][3]);
    let source_right_dist = geo[1][0] - (geo[0][0] + geo[0][2]);
    let mut separations = [0.0f64; 5];
    separations[1] = (source_left_dist - total_buffer).max(0.0);
    separations[2] = (source_top_dist - total_buffer).max(0.0);
    separations[4] = (source_bottom_dist - total_buffer).max(0.0);
    separations[3] = (source_right_dist - total_buffer).max(0.0);

    // Orders each end's sides by preference given where the terminals sit.
    let mut hor_pref = [0u32; 2];
    let mut vert_pref = [0u32; 2];
    hor_pref[0] = match source_left_dist >= source_right_dist {
        true => side::WEST,
        false => side::EAST,
    };
    vert_pref[0] = match source_top_dist >= source_bottom_dist {
        true => side::NORTH,
        false => side::SOUTH,
    };
    hor_pref[1] = reverse_sides(hor_pref[0]);
    vert_pref[1] = reverse_sides(vert_pref[0]);
    let preferred_horiz_dist = source_left_dist.max(source_right_dist);
    let preferred_vert_dist = source_top_dist.max(source_bottom_dist);
    let mut pref_ordering = [[0u32; 2]; 2];
    let mut preferred_order_set = false;

    for i in 0..2 {
        if dir[i] != 0 {
            continue;
        }
        if hor_pref[i] & port_constraint[i] == 0 {
            hor_pref[i] = reverse_sides(hor_pref[i]);
        }
        if vert_pref[i] & port_constraint[i] == 0 {
            vert_pref[i] = reverse_sides(vert_pref[i]);
        }
        pref_ordering[i] = [vert_pref[i], hor_pref[i]];
    }

    if preferred_vert_dist > 0.0 && preferred_horiz_dist > 0.0 {
        if hor_pref[0] & port_constraint[0] > 0 && vert_pref[1] & port_constraint[1] > 0 {
            pref_ordering = [[hor_pref[0], vert_pref[0]], [vert_pref[1], hor_pref[1]]];
            preferred_order_set = true;
        } else if vert_pref[0] & port_constraint[0] > 0 && hor_pref[1] & port_constraint[1] > 0 {
            pref_ordering = [[vert_pref[0], hor_pref[0]], [hor_pref[1], vert_pref[1]]];
            preferred_order_set = true;
        }
    }
    if preferred_vert_dist > 0.0 && !preferred_order_set {
        pref_ordering = [[vert_pref[0], hor_pref[0]], [vert_pref[1], hor_pref[1]]];
        preferred_order_set = true;
    }
    if preferred_horiz_dist > 0.0 && !preferred_order_set {
        pref_ordering = [[hor_pref[0], vert_pref[0]], [hor_pref[1], vert_pref[1]]];
    }

    for i in 0..2 {
        if dir[i] != 0 {
            continue;
        }
        if pref_ordering[i][0] & port_constraint[i] == 0 {
            pref_ordering[i][0] = pref_ordering[i][1];
        }
        let mut dir_pref = pref_ordering[i][0] & port_constraint[i];
        dir_pref |= (pref_ordering[i][1] & port_constraint[i]) << 8;
        dir_pref |= (pref_ordering[1 - i][i] & port_constraint[i]) << 16;
        dir_pref |= (pref_ordering[1 - i][1 - i] & port_constraint[i]) << 24;
        if dir_pref & 0xF == 0 {
            dir_pref <<= 8;
        }
        if dir_pref & 0xF00 == 0 {
            dir_pref = (dir_pref & 0xF) | (dir_pref >> 8);
        }
        if dir_pref & 0xF0000 == 0 {
            dir_pref = (dir_pref & 0xFFFF) | ((dir_pref & 0xF000000) >> 8);
        }
        dir[i] = dir_pref & 0xF;
        if matches!(
            port_constraint[i],
            side::WEST | side::NORTH | side::EAST | side::SOUTH
        ) {
            dir[i] = port_constraint[i];
        }
    }

    let side_index = |d: u32| if d == side::EAST { 3 } else { d as i64 };
    let mut source_index = side_index(dir[0]) - quad as i64;
    let mut target_index = side_index(dir[1]) - quad as i64;
    if source_index < 1 {
        source_index += 4;
    }
    if target_index < 1 {
        target_index += 4;
    }
    let Some(route_pattern) = usize::try_from(source_index - 1)
        .ok()
        .zip(usize::try_from(target_index - 1).ok())
        .and_then(|(s, t)| ROUTE_PATTERNS.get(s)?.get(t))
    else {
        return;
    };

    let mut way_points = [[0.0f64; 2]; 12];
    way_points[0] = [geo[0][0], geo[0][1]];
    match dir[0] {
        side::WEST => {
            way_points[0][0] -= source_buffer;
            way_points[0][1] += constraint[0][1] * geo[0][3];
        }
        side::SOUTH => {
            way_points[0][0] += constraint[0][0] * geo[0][2];
            way_points[0][1] += geo[0][3] + source_buffer;
        }
        side::EAST => {
            way_points[0][0] += geo[0][2] + source_buffer;
            way_points[0][1] += constraint[0][1] * geo[0][3];
        }
        side::NORTH => {
            way_points[0][0] += constraint[0][0] * geo[0][2];
            way_points[0][1] -= source_buffer;
        }
        _ => {}
    }

    let mut current_index = 0usize;
    // Orientation: 0 horizontal, 1 vertical.
    let horizontal_side = |d: u32| d & (side::EAST | side::WEST) > 0;
    let mut last_orientation = if horizontal_side(dir[0]) { 0 } else { 1 };
    let initial_orientation = last_orientation;
    for &step in route_pattern.iter() {
        let next_direction = step & 0xF;
        let mut direction_index = if next_direction == side::EAST {
            3
        } else {
            next_direction
        };
        direction_index += quad;
        if direction_index > 4 {
            direction_index -= 4;
        }
        let direction = DIR_VECTORS[direction_index as usize - 1];
        let current_orientation = if direction_index % 2 > 0 { 0 } else { 1 };
        if current_orientation != last_orientation {
            current_index += 1;
            way_points[current_index] = way_points[current_index - 1];
        }
        let tar = step & TARGET_MASK > 0;
        let sou = step & SOURCE_MASK > 0;
        let mut side = (step & SIDE_MASK) >> 5;
        side <<= quad;
        if side > 0xF {
            side >>= 4;
        }
        let center = step & CENTER_MASK > 0;
        if (sou || tar) && side < 9 {
            let sou_tar = if sou { 0 } else { 1 };
            let limit = match (center, current_orientation) {
                (true, 0) => geo[sou_tar][0] + constraint[sou_tar][0] * geo[sou_tar][2],
                (true, _) => geo[sou_tar][1] + constraint[sou_tar][1] * geo[sou_tar][3],
                (false, _) => limits[sou_tar][side as usize],
            };
            let axis = current_orientation;
            let delta = (limit - way_points[current_index][axis]) * direction[axis];
            if delta > 0.0 {
                way_points[current_index][axis] += direction[axis] * delta;
            }
        } else if center {
            let half = (separations[direction_index as usize] / 2.0).abs();
            way_points[current_index][0] += direction[0] * half;
            way_points[current_index][1] += direction[1] * half;
        }
        if current_index > 0
            && way_points[current_index][current_orientation]
                == way_points[current_index - 1][current_orientation]
        {
            current_index -= 1;
        } else {
            last_orientation = current_orientation;
        }
    }

    for (i, wp) in way_points.iter().enumerate().take(current_index + 1) {
        if i == current_index {
            // The last bend may only continue the approach to the target: keep it only
            // when the number of bends fits the two ends' orientations.
            let target_orientation = if horizontal_side(dir[1]) { 0 } else { 1 };
            let same_orient = if target_orientation == initial_orientation {
                0
            } else {
                1
            };
            if same_orient != (current_index + 1) % 2 {
                break;
            }
        }
        result.push(Some(Point::new(
            js_round(wp[0] * 10.0) / 10.0,
            js_round(wp[1] * 10.0) / 10.0,
        )));
    }

    let mut index = 1;
    while index < result.len() {
        match (result[index - 1], result[index]) {
            (Some(a), Some(b)) if a.x == b.x && a.y == b.y => {
                result.remove(index);
            }
            _ => index += 1,
        }
    }
}
