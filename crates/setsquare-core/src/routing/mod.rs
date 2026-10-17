//! Connector routing: where an edge leaves and enters its terminals and which points it
//! passes through. This follows draw.io's edge pipeline in `mxGraphView.updateEdgeState`:
//! fixed connection points, then the edge style, then floating points on each terminal's
//! perimeter.

use crate::geometry::{Point, Rect, route_orthogonal};
use crate::model::{CellId, CellKind, Model};

/// Returns the route of edge `id` in page coordinates, or `None` when it is not an edge or
/// an end has neither a terminal nor a loose point.
pub(crate) fn route(model: &Model, id: &CellId) -> Option<Vec<Point>> {
    let CellKind::Edge(e) = &model.cell(id)?.kind else {
        return None;
    };
    let origin = model.origin_of(&e.parent);
    let end = |terminal: &Option<CellId>, loose: Option<Point>| -> Option<Result<Rect, Point>> {
        match terminal {
            Some(t) => model.bounds(t).map(Ok),
            None => loose.map(|p| Err(p + origin)),
        }
    };
    let source = end(&e.source, e.geometry.source_point)?;
    let target = end(&e.target, e.geometry.target_point)?;
    if let (Ok(s), Ok(t), true) = (source, target, e.geometry.points.is_empty()) {
        return Some(route_orthogonal(s, t));
    }
    let anchor = |end: Result<Rect, Point>| end.map_or_else(|p| p, |r| r.center());
    let mut points = vec![anchor(source)];
    points.extend(e.geometry.points.iter().map(|p| *p + origin));
    points.push(anchor(target));
    Some(points)
}
