// Ported from draw.io at commit 9034053fba: mxgraph/src/view/mxPerimeter.js, the perimeters
// that js/grapheditor/Shapes.js registers, and mxgraph/src/util/mxUtils.js (getPerimeterPoint,
// intersection, getDirectedBounds). Copyright (c) JGraph Ltd, Apache License 2.0.

//! Perimeters: where a connector that points at a shape meets its outline.

use std::f64::consts::PI;

use super::{Direction, js_round, unscale};
use crate::geometry::{Point, Rect};
use crate::style::Style;

/// How far the slanted sides of a parallelogram, trapezoid, step, or hexagon cut in.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum Inset {
    /// A fraction of the side, from the style's `size`.
    Relative(f64),
    /// A length in diagram units, when the style sets `fixedSize`.
    Fixed(f64),
}

impl Inset {
    fn parse(style: &Style, relative: f64, fixed: f64) -> Inset {
        // draw.io tests `fixedSize != '0'`, so any value but zero turns it on.
        let is_fixed = style
            .get("fixedSize")
            .is_some_and(|v| v.parse::<f64>() != Ok(0.0));
        match is_fixed {
            true => Inset::Fixed(style.number("size").unwrap_or(fixed)),
            false => Inset::Relative(style.number("size").unwrap_or(relative)),
        }
    }

    /// Returns the inset along a side of `length`. A fixed inset is capped at `cap` times
    /// the side, as each draw.io shape caps it differently.
    fn along(self, length: f64, cap: f64) -> f64 {
        match self {
            Inset::Fixed(size) => (length * cap).min(size).max(0.0),
            Inset::Relative(f) => length * f.clamp(0.0, 1.0),
        }
    }
}

/// A perimeter function from draw.io's style registry, with the style values it reads.
#[derive(Clone, Debug, PartialEq)]
pub(super) enum Perimeter {
    Rectangle,
    Ellipse,
    Rhombus,
    Triangle(Direction),
    /// The legacy `hexagonPerimeter`.
    Hexagon(Direction),
    Hexagon2 {
        inset: Inset,
        vertical: bool,
    },
    Parallelogram {
        inset: Inset,
        vertical: bool,
    },
    Trapezoid {
        inset: Inset,
        direction: Direction,
    },
    Step {
        inset: Inset,
        direction: Direction,
    },
    Callout {
        size: f64,
        direction: Direction,
        flip_h: bool,
        flip_v: bool,
    },
    /// A UML lifeline: connectors attach to the dashed line below the head.
    Lifeline {
        head: f64,
        mirror: bool,
        stroke: f64,
    },
    /// A rectangle whose connectors always end orthogonally, such as an activation bar.
    Orthogonal,
    /// A line shape: connectors attach to either side of the line.
    Backbone {
        stroke: f64,
        vertical: bool,
    },
    Center,
}

/// The pixel size draw.io uses when the view is not in model coordinates.
const PIXEL: f64 = 1.0;

impl Perimeter {
    /// Parses the `perimeter` key of a vertex's effective style. Returns `None` when it is
    /// missing or names no perimeter that draw.io registers, which makes connectors end at
    /// the shape's center.
    pub(super) fn parse(style: &Style) -> Option<Perimeter> {
        let direction = Direction::parse(style);
        let vertical = direction.is_vertical();
        let stroke = style.number("strokeWidth").unwrap_or(1.0) / 2.0 - PIXEL;
        let perimeter = match style.get("perimeter")? {
            "rectanglePerimeter" => Perimeter::Rectangle,
            "ellipsePerimeter" => Perimeter::Ellipse,
            "rhombusPerimeter" => Perimeter::Rhombus,
            "trianglePerimeter" => Perimeter::Triangle(direction),
            "hexagonPerimeter" => Perimeter::Hexagon(direction),
            "hexagonPerimeter2" => Perimeter::Hexagon2 {
                inset: Inset::parse(style, 0.25, 20.0),
                vertical,
            },
            "parallelogramPerimeter" => Perimeter::Parallelogram {
                inset: Inset::parse(style, 0.2, 20.0),
                vertical,
            },
            "trapezoidPerimeter" => Perimeter::Trapezoid {
                inset: Inset::parse(style, 0.2, 20.0),
                direction,
            },
            "stepPerimeter" => Perimeter::Step {
                inset: Inset::parse(style, 0.2, 20.0),
                direction,
            },
            "calloutPerimeter" => Perimeter::Callout {
                size: style.number("size").unwrap_or(30.0),
                direction,
                flip_h: style.flag("flipH"),
                flip_v: style.flag("flipV"),
            },
            "lifelinePerimeter" => Perimeter::Lifeline {
                head: style.number("size").unwrap_or(40.0),
                mirror: style.number("lifelineMirror") == Some(1.0),
                stroke,
            },
            "orthogonalPerimeter" => Perimeter::Orthogonal,
            "backbonePerimeter" => Perimeter::Backbone {
                stroke: stroke
                    + style
                        .number("backboneSize")
                        .map_or(0.0, |size| size / 2.0 - PIXEL),
                vertical,
            },
            "centerPerimeter" => Perimeter::Center,
            _ => return None,
        };
        Some(perimeter)
    }

    /// Returns where the line from `next` toward the center of `bounds` crosses the
    /// outline. With `orthogonal`, the point keeps `next`'s x or y where it can, so the
    /// last segment stays horizontal or vertical. `None` means the line misses the
    /// outline, and draw.io then uses the center.
    pub(super) fn project(&self, bounds: Rect, next: Point, orthogonal: bool) -> Option<Point> {
        match self {
            Perimeter::Rectangle => Some(rectangle(bounds, next, orthogonal)),
            Perimeter::Ellipse => Some(ellipse(bounds, next, orthogonal)),
            Perimeter::Rhombus => rhombus(bounds, next, orthogonal),
            Perimeter::Triangle(direction) => Some(triangle(bounds, *direction, next, orthogonal)),
            Perimeter::Hexagon(direction) => Some(hexagon(bounds, *direction, next, orthogonal)),
            Perimeter::Hexagon2 { inset, vertical } => polygon(
                bounds,
                &hexagon2(bounds, *inset, *vertical),
                next,
                orthogonal,
            ),
            Perimeter::Parallelogram { inset, vertical } => polygon(
                bounds,
                &parallelogram(bounds, *inset, *vertical),
                next,
                orthogonal,
            ),
            Perimeter::Trapezoid { inset, direction } => polygon(
                bounds,
                &trapezoid(bounds, *inset, *direction),
                next,
                orthogonal,
            ),
            Perimeter::Step { inset, direction } => {
                polygon(bounds, &step(bounds, *inset, *direction), next, orthogonal)
            }
            Perimeter::Callout {
                size,
                direction,
                flip_h,
                flip_v,
            } => {
                let body = [0.0, 0.0, 0.0, size.min(bounds.height).max(0.0)];
                let bounds = directed_bounds(bounds, body, *direction, *flip_h, *flip_v);
                Some(rectangle(bounds, next, orthogonal))
            }
            Perimeter::Lifeline {
                head,
                mirror,
                stroke,
            } => {
                let max = match mirror {
                    true => bounds.bottom() - head,
                    false => bounds.bottom(),
                };
                let cx = bounds.center().x;
                let offset = side_offset(*stroke, next.x < cx);
                Some(Point::new(
                    cx + offset,
                    max.min((bounds.y + head).max(next.y)),
                ))
            }
            // draw.io sets `orthogonal = true` and passes `arguments` on, which carries the
            // change in sloppy-mode JavaScript, so these ends are always orthogonal.
            Perimeter::Orthogonal => Some(rectangle(bounds, next, true)),
            Perimeter::Backbone { stroke, vertical } => {
                let c = bounds.center();
                match vertical {
                    true => Some(Point::new(
                        c.x + side_offset(*stroke, next.x < c.x),
                        bounds.bottom().min(bounds.y.max(next.y)),
                    )),
                    false => Some(Point::new(
                        bounds.right().min(bounds.x.max(next.x)),
                        c.y + side_offset(*stroke, next.y < c.y),
                    )),
                }
            }
            Perimeter::Center => Some(bounds.center()),
        }
    }
}

/// Returns where a connector attaches to a line shape, relative to its center line, on
/// the side it comes from. `stroke` is half the stroke width less a pixel; draw.io adds the
/// pixel back on the left or top side.
fn side_offset(stroke: f64, before: bool) -> f64 {
    match before {
        true => -(stroke + PIXEL),
        false => stroke,
    }
}

fn rectangle(bounds: Rect, next: Point, orthogonal: bool) -> Point {
    let c = bounds.center();
    let alpha = (next.y - c.y).atan2(next.x - c.x);
    let beta = PI / 2.0 - alpha;
    let t = bounds.height.atan2(bounds.width);
    let mut p = match () {
        _ if alpha < -PI + t || alpha > PI - t => {
            Point::new(bounds.x, c.y - bounds.width * alpha.tan() / 2.0)
        }
        _ if alpha < -t => Point::new(c.x - bounds.height * beta.tan() / 2.0, bounds.y),
        _ if alpha < t => Point::new(bounds.right(), c.y + bounds.width * alpha.tan() / 2.0),
        _ => Point::new(c.x + bounds.height * beta.tan() / 2.0, bounds.bottom()),
    };
    if orthogonal {
        if next.x >= bounds.x && next.x <= bounds.right() {
            p.x = next.x;
        } else if next.y >= bounds.y && next.y <= bounds.bottom() {
            p.y = next.y;
        }
        if next.x < bounds.x {
            p.x = bounds.x;
        } else if next.x > bounds.right() {
            p.x = bounds.right();
        }
        if next.y < bounds.y {
            p.y = bounds.y;
        } else if next.y > bounds.bottom() {
            p.y = bounds.bottom();
        }
    }
    p
}

fn ellipse(bounds: Rect, next: Point, orthogonal: bool) -> Point {
    let (x, y) = (bounds.x, bounds.y);
    let (a, b) = (bounds.width / 2.0, bounds.height / 2.0);
    let (cx, cy) = (x + a, y + b);
    let (px, py) = (next.x, next.y);
    // draw.io truncates the direction to whole model units.
    let dx = unscale(px - cx).trunc();
    let dy = unscale(py - cy).trunc();
    if dx == 0.0 && dy != 0.0 {
        return Point::new(cx, cy + b * dy / dy.abs());
    }
    if dx == 0.0 && dy == 0.0 {
        return Point::new(px, py);
    }
    if orthogonal {
        if py >= y && py <= y + bounds.height {
            let ty = py - cy;
            let tx = zero_if_nan((a * a * (1.0 - (ty * ty) / (b * b))).sqrt());
            let tx = if px <= x { -tx } else { tx };
            return Point::new(cx + tx, py);
        }
        if px >= x && px <= x + bounds.width {
            let tx = px - cx;
            let ty = zero_if_nan((b * b * (1.0 - (tx * tx) / (a * a))).sqrt());
            let ty = if py <= y { -ty } else { ty };
            return Point::new(px, cy + ty);
        }
    }
    let t = a * b / (b * b * dx * dx + a * a * dy * dy).sqrt();
    Point::new(cx + t * dx, cy + t * dy)
}

/// draw.io writes `Math.sqrt(v) || 0`, which turns NaN into zero.
fn zero_if_nan(v: f64) -> f64 {
    if v.is_nan() { 0.0 } else { v }
}

fn rhombus(bounds: Rect, next: Point, orthogonal: bool) -> Option<Point> {
    let Rect {
        x,
        y,
        width: w,
        height: h,
    } = bounds;
    let (cx, cy) = (x + w / 2.0, y + h / 2.0);
    let (px, py) = (next.x, next.y);
    if cx == px {
        return Some(match cy > py {
            true => Point::new(cx, y),
            false => Point::new(cx, y + h),
        });
    }
    if cy == py {
        return Some(match cx > px {
            true => Point::new(x, cy),
            false => Point::new(x + w, cy),
        });
    }
    let (mut tx, mut ty) = (cx, cy);
    if orthogonal {
        if px >= x && px <= x + w {
            tx = px;
        } else if py >= y && py <= y + h {
            ty = py;
        }
    }
    match (px < cx, py < cy) {
        (true, true) => intersection(px, py, tx, ty, cx, y, x, cy),
        (true, false) => intersection(px, py, tx, ty, cx, y + h, x, cy),
        (false, true) => intersection(px, py, tx, ty, cx, y, x + w, cy),
        (false, false) => intersection(px, py, tx, ty, cx, y + h, x + w, cy),
    }
}

fn triangle(bounds: Rect, direction: Direction, next: Point, orthogonal: bool) -> Point {
    let vertical = direction.is_vertical();
    let Rect {
        x,
        y,
        width: w,
        height: h,
    } = bounds;
    let (mut cx, mut cy) = (x + w / 2.0, y + h / 2.0);
    let (start, corner, end) = match direction {
        Direction::North => (
            Point::new(x, y + h),
            Point::new(cx, y),
            Point::new(x + w, y + h),
        ),
        Direction::South => (
            Point::new(x, y),
            Point::new(cx, y + h),
            Point::new(x + w, y),
        ),
        Direction::West => (
            Point::new(x + w, y),
            Point::new(x, cy),
            Point::new(x + w, y + h),
        ),
        Direction::East => (
            Point::new(x, y),
            Point::new(x + w, cy),
            Point::new(x, y + h),
        ),
    };
    let (dx, dy) = (next.x - cx, next.y - cy);
    let alpha = if vertical { dx.atan2(dy) } else { dy.atan2(dx) };
    let t = if vertical { w.atan2(h) } else { h.atan2(w) };
    let base = match direction {
        Direction::North | Direction::West => alpha > -t && alpha < t,
        Direction::South | Direction::East => alpha < -PI + t || alpha > PI - t,
    };
    let result = if base {
        let along_base = match vertical {
            true => next.x >= start.x && next.x <= end.x,
            false => next.y >= start.y && next.y <= end.y,
        };
        match (orthogonal && along_base, vertical, direction) {
            (true, true, _) => Some(Point::new(next.x, start.y)),
            (true, false, _) => Some(Point::new(start.x, next.y)),
            (false, _, Direction::North) => {
                Some(Point::new(x + w / 2.0 + h * alpha.tan() / 2.0, y + h))
            }
            (false, _, Direction::South) => {
                Some(Point::new(x + w / 2.0 - h * alpha.tan() / 2.0, y))
            }
            (false, _, Direction::West) => {
                Some(Point::new(x + w, y + h / 2.0 + w * alpha.tan() / 2.0))
            }
            (false, _, Direction::East) => Some(Point::new(x, y + h / 2.0 - w * alpha.tan() / 2.0)),
        }
    } else {
        if orthogonal {
            let mut pt = Point::new(cx, cy);
            if next.y >= y && next.y <= y + h {
                pt.x = match (vertical, direction) {
                    (true, _) => cx,
                    (false, Direction::West) => x + w,
                    (false, _) => x,
                };
                pt.y = next.y;
            } else if next.x >= x && next.x <= x + w {
                pt.x = next.x;
                pt.y = match (vertical, direction) {
                    (false, _) => cy,
                    (true, Direction::North) => y + h,
                    (true, _) => y,
                };
            }
            cx = pt.x;
            cy = pt.y;
        }
        let first_half = match vertical {
            true => next.x <= x + w / 2.0,
            false => next.y <= y + h / 2.0,
        };
        match first_half {
            true => intersection(next.x, next.y, cx, cy, start.x, start.y, corner.x, corner.y),
            false => intersection(next.x, next.y, cx, cy, corner.x, corner.y, end.x, end.y),
        }
    };
    result.unwrap_or(Point::new(cx, cy))
}

/// The legacy hexagon perimeter, computed in model units as draw.io does.
fn hexagon(bounds: Rect, direction: Direction, next: Point, orthogonal: bool) -> Point {
    let bounds = Rect::new(
        unscale(bounds.x),
        unscale(bounds.y),
        unscale(bounds.width),
        unscale(bounds.height),
    );
    let next = Point::new(unscale(next.x), unscale(next.y));
    hexagon_point(bounds, direction, next, orthogonal)
}

fn hexagon_point(bounds: Rect, direction: Direction, next: Point, orthogonal: bool) -> Point {
    let Rect {
        x,
        y,
        width: w,
        height: h,
    } = bounds;
    let (cx, cy) = (bounds.center().x, bounds.center().y);
    let (px, py) = (next.x, next.y);
    let alpha = -(py - cy).atan2(px - cx);
    let (pi, pi2) = (PI, PI / 2.0);
    let vertical = direction.is_vertical();
    let p = Point::new;
    let fl = f64::floor;
    let mut a = Point::default();
    let mut b = Point::default();

    // Only the quadrants beside the sides allow an orthogonal end.
    let corner = (px < x && py < y)
        || (px < x && py > y + h)
        || (px > x + w && py < y)
        || (px > x + w && py > y + h);
    let orthogonal = orthogonal && !corner;

    if orthogonal {
        if vertical {
            if px == cx {
                if py <= y {
                    return p(cx, y);
                } else if py >= y + h {
                    return p(cx, y + h);
                }
            } else if px < x {
                if py == y + h / 4.0 {
                    return p(x, y + h / 4.0);
                } else if py == y + 3.0 * h / 4.0 {
                    return p(x, y + 3.0 * h / 4.0);
                }
            } else if px > x + w {
                if py == y + h / 4.0 {
                    return p(x + w, y + h / 4.0);
                } else if py == y + 3.0 * h / 4.0 {
                    return p(x + w, y + 3.0 * h / 4.0);
                }
            } else if px == x {
                if py < cy {
                    return p(x, y + h / 4.0);
                } else if py > cy {
                    return p(x, y + 3.0 * h / 4.0);
                }
            } else if px == x + w {
                if py < cy {
                    return p(x + w, y + h / 4.0);
                } else if py > cy {
                    return p(x + w, y + 3.0 * h / 4.0);
                }
            }
            if py == y {
                return p(cx, y);
            } else if py == y + h {
                return p(cx, y + h);
            }
            if px < cx {
                if py > y + h / 4.0 && py < y + 3.0 * h / 4.0 {
                    a = p(x, y);
                    b = p(x, y + h);
                } else if py < y + h / 4.0 {
                    a = p(x - fl(0.5 * w), y + fl(0.5 * h));
                    b = p(x + w, y - fl(0.25 * h));
                } else if py > y + 3.0 * h / 4.0 {
                    a = p(x - fl(0.5 * w), y + fl(0.5 * h));
                    b = p(x + w, y + fl(1.25 * h));
                }
            } else if px > cx {
                if py > y + h / 4.0 && py < y + 3.0 * h / 4.0 {
                    a = p(x + w, y);
                    b = p(x + w, y + h);
                } else if py < y + h / 4.0 {
                    a = p(x, y - fl(0.25 * h));
                    b = p(x + fl(1.5 * w), y + fl(0.5 * h));
                } else if py > y + 3.0 * h / 4.0 {
                    a = p(x + fl(1.5 * w), y + fl(0.5 * h));
                    b = p(x, y + fl(1.25 * h));
                }
            }
        } else {
            if py == cy {
                if px <= x {
                    return p(x, y + h / 2.0);
                } else if px >= x + w {
                    return p(x + w, y + h / 2.0);
                }
            } else if py < y {
                if px == x + w / 4.0 {
                    return p(x + w / 4.0, y);
                } else if px == x + 3.0 * w / 4.0 {
                    return p(x + 3.0 * w / 4.0, y);
                }
            } else if py > y + h {
                if px == x + w / 4.0 {
                    return p(x + w / 4.0, y + h);
                } else if px == x + 3.0 * w / 4.0 {
                    return p(x + 3.0 * w / 4.0, y + h);
                }
            } else if py == y {
                if px < cx {
                    return p(x + w / 4.0, y);
                } else if px > cx {
                    return p(x + 3.0 * w / 4.0, y);
                }
            } else if py == y + h {
                if px < cx {
                    return p(x + w / 4.0, y + h);
                } else if py > cy {
                    return p(x + 3.0 * w / 4.0, y + h);
                }
            }
            if px == x {
                return p(x, cy);
            } else if px == x + w {
                return p(x + w, cy);
            }
            if py < cy {
                if px > x + w / 4.0 && px < x + 3.0 * w / 4.0 {
                    a = p(x, y);
                    b = p(x + w, y);
                } else if px < x + w / 4.0 {
                    a = p(x - fl(0.25 * w), y + h);
                    b = p(x + fl(0.5 * w), y - fl(0.5 * h));
                } else if px > x + 3.0 * w / 4.0 {
                    a = p(x + fl(0.5 * w), y - fl(0.5 * h));
                    b = p(x + fl(1.25 * w), y + h);
                }
            } else if py > cy {
                if px > x + w / 4.0 && px < x + 3.0 * w / 4.0 {
                    a = p(x, y + h);
                    b = p(x + w, y + h);
                } else if px < x + w / 4.0 {
                    a = p(x - fl(0.25 * w), y);
                    b = p(x + fl(0.5 * w), y + fl(1.5 * h));
                } else if px > x + 3.0 * w / 4.0 {
                    a = p(x + fl(0.5 * w), y + fl(1.5 * h));
                    b = p(x + fl(1.25 * w), y);
                }
            }
        }
        let (mut tx, mut ty) = (cx, cy);
        if px >= x && px <= x + w {
            tx = px;
            ty = if py < cy { y + h } else { y };
        } else if py >= y && py <= y + h {
            ty = py;
            tx = if px < cx { x + w } else { x };
        }
        return intersection(tx, ty, next.x, next.y, a.x, a.y, b.x, b.y).unwrap_or(p(cx, cy));
    }

    if vertical {
        let beta = (h / 4.0).atan2(w / 2.0);
        if alpha == beta {
            return p(x + w, y + fl(0.25 * h));
        } else if alpha == pi2 {
            return p(x + fl(0.5 * w), y);
        } else if alpha == pi - beta {
            return p(x, y + fl(0.25 * h));
        } else if alpha == -beta {
            return p(x + w, y + fl(0.75 * h));
        } else if alpha == -pi2 {
            return p(x + fl(0.5 * w), y + h);
        } else if alpha == -pi + beta {
            return p(x, y + fl(0.75 * h));
        }
        if alpha < beta && alpha > -beta {
            a = p(x + w, y);
            b = p(x + w, y + h);
        } else if alpha > beta && alpha < pi2 {
            a = p(x, y - fl(0.25 * h));
            b = p(x + fl(1.5 * w), y + fl(0.5 * h));
        } else if alpha > pi2 && alpha < pi - beta {
            a = p(x - fl(0.5 * w), y + fl(0.5 * h));
            b = p(x + w, y - fl(0.25 * h));
        } else if (alpha > pi - beta && alpha <= pi) || (alpha < -pi + beta && alpha >= -pi) {
            a = p(x, y);
            b = p(x, y + h);
        } else if alpha < -beta && alpha > -pi2 {
            a = p(x + fl(1.5 * w), y + fl(0.5 * h));
            b = p(x, y + fl(1.25 * h));
        } else if alpha < -pi2 && alpha > -pi + beta {
            a = p(x - fl(0.5 * w), y + fl(0.5 * h));
            b = p(x + w, y + fl(1.25 * h));
        }
    } else {
        let beta = (h / 2.0).atan2(w / 4.0);
        if alpha == beta {
            return p(x + fl(0.75 * w), y);
        } else if alpha == pi - beta {
            return p(x + fl(0.25 * w), y);
        } else if alpha == pi || alpha == -pi {
            return p(x, y + fl(0.5 * h));
        } else if alpha == 0.0 {
            return p(x + w, y + fl(0.5 * h));
        } else if alpha == -beta {
            return p(x + fl(0.75 * w), y + h);
        } else if alpha == -pi + beta {
            return p(x + fl(0.25 * w), y + h);
        }
        if alpha > 0.0 && alpha < beta {
            a = p(x + fl(0.5 * w), y - fl(0.5 * h));
            b = p(x + fl(1.25 * w), y + h);
        } else if alpha > beta && alpha < pi - beta {
            a = p(x, y);
            b = p(x + w, y);
        } else if alpha > pi - beta && alpha < pi {
            a = p(x - fl(0.25 * w), y + h);
            b = p(x + fl(0.5 * w), y - fl(0.5 * h));
        } else if alpha < 0.0 && alpha > -beta {
            a = p(x + fl(0.5 * w), y + fl(1.5 * h));
            b = p(x + fl(1.25 * w), y);
        } else if alpha < -beta && alpha > -pi + beta {
            a = p(x, y + h);
            b = p(x + w, y + h);
        } else if alpha < -pi + beta && alpha > -pi {
            a = p(x - fl(0.25 * w), y);
            b = p(x + fl(0.5 * w), y + fl(1.5 * h));
        }
    }
    intersection(cx, cy, next.x, next.y, a.x, a.y, b.x, b.y).unwrap_or(p(cx, cy))
}

/// The outline of draw.io's hexagon shape.
fn hexagon2(bounds: Rect, inset: Inset, vertical: bool) -> Vec<Point> {
    let Rect {
        x,
        y,
        width: w,
        height: h,
    } = bounds;
    let Point { x: cx, y: cy } = bounds.center();
    let p = Point::new;
    match vertical {
        true => {
            let dy = inset.along(h, 1.0);
            vec![
                p(cx, y),
                p(x + w, y + dy),
                p(x + w, y + h - dy),
                p(cx, y + h),
                p(x, y + h - dy),
                p(x, y + dy),
                p(cx, y),
            ]
        }
        false => {
            let dx = inset.along(w, 1.0);
            vec![
                p(x + dx, y),
                p(x + w - dx, y),
                p(x + w, cy),
                p(x + w - dx, y + h),
                p(x + dx, y + h),
                p(x, cy),
                p(x + dx, y),
            ]
        }
    }
}

/// The outline of draw.io's parallelogram shape.
fn parallelogram(bounds: Rect, inset: Inset, vertical: bool) -> Vec<Point> {
    let Rect {
        x,
        y,
        width: w,
        height: h,
    } = bounds;
    let p = Point::new;
    match vertical {
        true => {
            let dy = inset.along(h, 1.0);
            vec![
                p(x, y),
                p(x + w, y + dy),
                p(x + w, y + h),
                p(x, y + h - dy),
                p(x, y),
            ]
        }
        false => {
            let dx = inset.along(w, 0.5);
            vec![
                p(x + dx, y),
                p(x + w, y),
                p(x + w - dx, y + h),
                p(x, y + h),
                p(x + dx, y),
            ]
        }
    }
}

/// The outline of draw.io's trapezoid shape.
fn trapezoid(bounds: Rect, inset: Inset, direction: Direction) -> Vec<Point> {
    let Rect {
        x,
        y,
        width: w,
        height: h,
    } = bounds;
    let p = Point::new;
    match direction {
        Direction::East => {
            let dx = inset.along(w, 0.5);
            vec![
                p(x + dx, y),
                p(x + w - dx, y),
                p(x + w, y + h),
                p(x, y + h),
                p(x + dx, y),
            ]
        }
        Direction::West => {
            let dx = inset.along(w, 1.0);
            vec![
                p(x, y),
                p(x + w, y),
                p(x + w - dx, y + h),
                p(x + dx, y + h),
                p(x, y),
            ]
        }
        Direction::North => {
            let dy = inset.along(h, 1.0);
            vec![
                p(x, y + dy),
                p(x + w, y),
                p(x + w, y + h),
                p(x, y + h - dy),
                p(x, y + dy),
            ]
        }
        Direction::South => {
            let dy = inset.along(h, 1.0);
            vec![
                p(x, y),
                p(x + w, y + dy),
                p(x + w, y + h - dy),
                p(x, y + h),
                p(x, y),
            ]
        }
    }
}

/// The outline of draw.io's step shape.
fn step(bounds: Rect, inset: Inset, direction: Direction) -> Vec<Point> {
    let Rect {
        x,
        y,
        width: w,
        height: h,
    } = bounds;
    let Point { x: cx, y: cy } = bounds.center();
    let p = Point::new;
    match direction {
        Direction::East => {
            let dx = inset.along(w, 1.0);
            vec![
                p(x, y),
                p(x + w - dx, y),
                p(x + w, cy),
                p(x + w - dx, y + h),
                p(x, y + h),
                p(x + dx, cy),
                p(x, y),
            ]
        }
        Direction::West => {
            let dx = inset.along(w, 1.0);
            vec![
                p(x + dx, y),
                p(x + w, y),
                p(x + w - dx, cy),
                p(x + w, y + h),
                p(x + dx, y + h),
                p(x, cy),
                p(x + dx, y),
            ]
        }
        Direction::North => {
            let dy = inset.along(h, 1.0);
            vec![
                p(x, y + dy),
                p(cx, y),
                p(x + w, y + dy),
                p(x + w, y + h),
                p(cx, y + h - dy),
                p(x, y + h),
                p(x, y + dy),
            ]
        }
        Direction::South => {
            let dy = inset.along(h, 1.0);
            vec![
                p(x, y),
                p(cx, y + dy),
                p(x + w, y),
                p(x + w, y + h - dy),
                p(cx, y + h),
                p(x, y + h - dy),
                p(x, y),
            ]
        }
    }
}

/// Projects onto a closed outline, as draw.io's polygon perimeters do: the ray starts at
/// the center, or at `next`'s row or column when orthogonal.
fn polygon(bounds: Rect, outline: &[Point], next: Point, orthogonal: bool) -> Option<Point> {
    let mut from = bounds.center();
    if orthogonal {
        if next.x < bounds.x || next.x > bounds.right() {
            from.y = next.y;
        } else {
            from.x = next.x;
        }
    }
    nearest_crossing(outline, from, next)
}

/// `mxUtils.getPerimeterPoint`: the crossing of the segment from `center` to `point` with
/// the outline that lies nearest to `point`.
fn nearest_crossing(outline: &[Point], center: Point, point: Point) -> Option<Point> {
    let mut best: Option<(Point, f64)> = None;
    for side in outline.windows(2) {
        let Some(p) = intersection(
            side[0].x, side[0].y, side[1].x, side[1].y, center.x, center.y, point.x, point.y,
        ) else {
            continue;
        };
        let dist = (point.y - p.y).powi(2) + (point.x - p.x).powi(2);
        if best.is_none_or(|(_, d)| d > dist) {
            best = Some((p, dist));
        }
    }
    best.map(|(p, _)| p)
}

/// `mxUtils.intersection`: where segment 0-1 crosses segment 2-3, with a small tolerance.
#[allow(clippy::too_many_arguments)]
pub(super) fn intersection(
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
    x2: f64,
    y2: f64,
    x3: f64,
    y3: f64,
) -> Option<Point> {
    let denom = ((y3 - y2) * (x1 - x0)) - ((x3 - x2) * (y1 - y0));
    let nume_a = ((x3 - x2) * (y0 - y2)) - ((y3 - y2) * (x0 - x2));
    let nume_b = ((x1 - x0) * (y0 - y2)) - ((y1 - y0) * (x0 - x2));
    let ua = nume_a / denom;
    let ub = nume_b / denom;
    let eps = 0.000001;
    let within = |u: f64| u >= -eps && u <= 1.0 + eps;
    match within(ua) && within(ub) {
        true => Some(Point::new(x0 + ua * (x1 - x0), y0 + ua * (y1 - y0))),
        false => None,
    }
}

/// `mxUtils.getDirectedBounds`: `rect` shrunk by the insets `[left, top, right, bottom]`,
/// given for an east-facing shape, after turning and flipping them like the shape.
fn directed_bounds(
    rect: Rect,
    insets: [f64; 4],
    direction: Direction,
    flip_h: bool,
    flip_v: bool,
) -> Rect {
    let clamp = |v: f64, max: f64| js_round(v.min(max).max(0.0));
    let mut m = [
        clamp(insets[0], rect.width),
        clamp(insets[1], rect.height),
        clamp(insets[2], rect.width),
        clamp(insets[3], rect.height),
    ];
    let vertical = direction.is_vertical();
    if (flip_v && vertical) || (flip_h && !vertical) {
        m.swap(0, 2);
    }
    if (flip_h && vertical) || (flip_v && !vertical) {
        m.swap(1, 3);
    }
    let [left, top, right, bottom] = m;
    let (x, y, w, h) = match direction {
        Direction::East => (left, top, right, bottom),
        Direction::South => (bottom, left, top, right),
        Direction::West => (right, bottom, left, top),
        Direction::North => (top, right, bottom, left),
    };
    Rect::new(
        rect.x + x,
        rect.y + y,
        rect.width - w - x,
        rect.height - h - y,
    )
}
