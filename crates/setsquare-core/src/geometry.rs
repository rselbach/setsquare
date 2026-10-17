//! Points, sizes, rectangles, and the geometric rules the editor applies to them.

use std::ops::{Add, Neg, Sub};

/// A point or offset in diagram units.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    /// Creates a point.
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

impl Add for Point {
    type Output = Point;

    fn add(self, rhs: Point) -> Point {
        Point::new(self.x + rhs.x, self.y + rhs.y)
    }
}

impl Sub for Point {
    type Output = Point;

    fn sub(self, rhs: Point) -> Point {
        Point::new(self.x - rhs.x, self.y - rhs.y)
    }
}

impl Neg for Point {
    type Output = Point;

    fn neg(self) -> Point {
        Point::new(-self.x, -self.y)
    }
}

/// A width and height in diagram units.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Size {
    pub width: f64,
    pub height: f64,
}

impl Size {
    /// Creates a size.
    pub const fn new(width: f64, height: f64) -> Self {
        Self { width, height }
    }
}

/// An axis-aligned rectangle given by its top-left corner and size.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Rect {
    /// Creates a rectangle.
    pub const fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    /// Returns the top-left corner.
    pub const fn origin(&self) -> Point {
        Point::new(self.x, self.y)
    }

    /// Returns the size.
    pub const fn size(&self) -> Size {
        Size::new(self.width, self.height)
    }

    /// Returns the right edge.
    pub fn right(&self) -> f64 {
        self.x + self.width
    }

    /// Returns the bottom edge.
    pub fn bottom(&self) -> f64 {
        self.y + self.height
    }

    /// Returns the center point.
    pub fn center(&self) -> Point {
        Point::new(self.x + self.width / 2.0, self.y + self.height / 2.0)
    }

    /// Returns the rectangle moved by `by`.
    pub fn translate(&self, by: Point) -> Rect {
        Rect::new(self.x + by.x, self.y + by.y, self.width, self.height)
    }

    /// Reports whether `p` lies inside or on the edge.
    pub fn contains(&self, p: Point) -> bool {
        p.x >= self.x && p.x <= self.right() && p.y >= self.y && p.y <= self.bottom()
    }

    /// Returns the smallest rectangle that covers both.
    pub fn union(&self, other: &Rect) -> Rect {
        let x = self.x.min(other.x);
        let y = self.y.min(other.y);
        Rect::new(
            x,
            y,
            self.right().max(other.right()) - x,
            self.bottom().max(other.bottom()) - y,
        )
    }

    fn xs(&self) -> [f64; 3] {
        [self.x, self.x + self.width / 2.0, self.right()]
    }

    fn ys(&self) -> [f64; 3] {
        [self.y, self.y + self.height / 2.0, self.bottom()]
    }
}

/// An alignment guide from `from` to `to`, drawn while a shape snaps to its neighbors.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Guide {
    pub from: Point,
    pub to: Point,
}

/// The result of snapping a moving rectangle to its neighbors.
#[derive(Clone, Debug, PartialEq)]
pub struct Snap {
    /// Where the rectangle lands after snapping.
    pub rect: Rect,
    /// One guide per edge or center line the rectangle now shares with a neighbor.
    pub guides: Vec<Guide>,
}

/// Snaps `moving` to the edges and centers of `others` within `threshold`, or to the
/// `grid` when no neighbor is close enough. A `grid` of zero turns grid snapping off.
pub fn snap(moving: Rect, others: &[Rect], threshold: f64, grid: f64) -> Snap {
    let nearest = |own: [f64; 3], lines: &dyn Fn(&Rect) -> [f64; 3]| {
        let mut best: Option<f64> = None;
        for o in others {
            for line in lines(o) {
                for a in own {
                    let d = line - a;
                    if d.abs() <= threshold && best.is_none_or(|b| d.abs() < b.abs()) {
                        best = Some(d);
                    }
                }
            }
        }
        best
    };
    let to_grid = |v: f64| {
        if grid > 0.0 {
            (v / grid).round() * grid - v
        } else {
            0.0
        }
    };

    let dx = nearest(moving.xs(), &Rect::xs);
    let dy = nearest(moving.ys(), &Rect::ys);
    let rect = moving.translate(Point::new(
        dx.unwrap_or_else(|| to_grid(moving.x)),
        dy.unwrap_or_else(|| to_grid(moving.y)),
    ));

    let mut guides = Vec::new();
    if dx.is_some() {
        for line in rect.xs() {
            let hits: Vec<&Rect> = others
                .iter()
                .filter(|o| o.xs().iter().any(|l| (l - line).abs() < 1e-6))
                .collect();
            if let Some(span) = hits.iter().map(|o| **o).reduce(|a, b| a.union(&b)) {
                let span = span.union(&rect);
                guides.push(Guide {
                    from: Point::new(line, span.y),
                    to: Point::new(line, span.bottom()),
                });
            }
        }
    }
    if dy.is_some() {
        for line in rect.ys() {
            let hits: Vec<&Rect> = others
                .iter()
                .filter(|o| o.ys().iter().any(|l| (l - line).abs() < 1e-6))
                .collect();
            if let Some(span) = hits.iter().map(|o| **o).reduce(|a, b| a.union(&b)) {
                let span = span.union(&rect);
                guides.push(Guide {
                    from: Point::new(span.x, line),
                    to: Point::new(span.right(), line),
                });
            }
        }
    }
    Snap { rect, guides }
}

/// Routes an orthogonal connector between two terminal rectangles with at most two bends.
/// The connector leaves and enters through the sides that face each other.
pub fn route_orthogonal(source: Rect, target: Rect) -> Vec<Point> {
    let (a, b) = (source.center(), target.center());
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    if dx.abs() >= dy.abs() {
        let sx = if dx > 0.0 { source.right() } else { source.x };
        let tx = if dx > 0.0 { target.x } else { target.right() };
        if (a.y - b.y).abs() < 1e-6 {
            return vec![Point::new(sx, a.y), Point::new(tx, b.y)];
        }
        let mx = (sx + tx) / 2.0;
        return vec![
            Point::new(sx, a.y),
            Point::new(mx, a.y),
            Point::new(mx, b.y),
            Point::new(tx, b.y),
        ];
    }
    let sy = if dy > 0.0 { source.bottom() } else { source.y };
    let ty = if dy > 0.0 { target.y } else { target.bottom() };
    if (a.x - b.x).abs() < 1e-6 {
        return vec![Point::new(a.x, sy), Point::new(b.x, ty)];
    }
    let my = (sy + ty) / 2.0;
    vec![
        Point::new(a.x, sy),
        Point::new(a.x, my),
        Point::new(b.x, my),
        Point::new(b.x, ty),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snap_prefers_the_nearest_neighbor_line() {
        let others = [Rect::new(100.0, 0.0, 50.0, 40.0)];
        let tests = [
            (
                "left edges align",
                Rect::new(101.0, 80.0, 20.0, 20.0),
                Rect::new(100.0, 80.0, 20.0, 20.0),
                1,
            ),
            (
                "centers align",
                Rect::new(113.0, 80.0, 20.0, 20.0),
                Rect::new(115.0, 80.0, 20.0, 20.0),
                1,
            ),
            (
                "too far falls back to the grid",
                Rect::new(173.0, 83.0, 20.0, 20.0),
                Rect::new(170.0, 80.0, 20.0, 20.0),
                0,
            ),
        ];
        for (name, moving, want, guides) in tests {
            let got = snap(moving, &others, 6.0, 10.0);
            assert_eq!(got.rect, want, "{name}");
            assert_eq!(got.guides.len(), guides, "{name}: guides");
        }
    }

    #[test]
    fn snap_without_grid_keeps_free_position() {
        let got = snap(Rect::new(3.0, 7.0, 10.0, 10.0), &[], 6.0, 0.0);
        assert_eq!(got.rect, Rect::new(3.0, 7.0, 10.0, 10.0));
    }

    #[test]
    fn route_orthogonal_bends_only_when_misaligned() {
        let a = Rect::new(0.0, 0.0, 100.0, 40.0);
        let tests = [
            (
                "same row",
                Rect::new(200.0, 0.0, 100.0, 40.0),
                vec![Point::new(100.0, 20.0), Point::new(200.0, 20.0)],
            ),
            (
                "offset row",
                Rect::new(200.0, 60.0, 100.0, 40.0),
                vec![
                    Point::new(100.0, 20.0),
                    Point::new(150.0, 20.0),
                    Point::new(150.0, 80.0),
                    Point::new(200.0, 80.0),
                ],
            ),
            (
                "below",
                Rect::new(0.0, 100.0, 100.0, 40.0),
                vec![Point::new(50.0, 40.0), Point::new(50.0, 100.0)],
            ),
        ];
        for (name, b, want) in tests {
            assert_eq!(route_orthogonal(a, b), want, "{name}");
        }
    }
}
