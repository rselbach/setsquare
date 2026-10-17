//! Built-in shapes: which one a style asks for, its outline, and where its label goes.

use std::fmt::Write;

use crate::geometry::Rect;
use crate::style::Style;

/// A built-in shape. Styles that name a shape this crate does not draw yet fall back to
/// [`Shape::Rectangle`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shape {
    Rectangle,
    RoundedRectangle,
    Ellipse,
    Rhombus,
    Triangle,
    Hexagon,
    Parallelogram,
    Trapezoid,
    Step,
    Cylinder,
    /// A cylinder lying on its side, as in a message queue.
    HorizontalCylinder,
    Document,
    Note,
    Cloud,
    Actor,
    Process,
    Swimlane,
    /// A line through the middle of the bounds, as in UML class dividers.
    Line,
    /// A line shape turned upright by `direction=north` or `south`, as in activity bars.
    VerticalLine,
}

impl Shape {
    /// Returns the shape an effective style asks for. Pass the style from
    /// [`Model::style`](crate::Model::style), where named styles such as `ellipse` have
    /// already set the `shape` key.
    pub fn of(style: &Style) -> Shape {
        let sideways = matches!(style.get("direction"), Some("north" | "south"));
        let shape = style.get("shape").and_then(|name| match name {
            "ellipse" => Some(Shape::Ellipse),
            "rhombus" => Some(Shape::Rhombus),
            "triangle" => Some(Shape::Triangle),
            "hexagon" => Some(Shape::Hexagon),
            "parallelogram" => Some(Shape::Parallelogram),
            "trapezoid" => Some(Shape::Trapezoid),
            "step" => Some(Shape::Step),
            "cylinder" | "cylinder3" if sideways => Some(Shape::HorizontalCylinder),
            "cylinder" | "cylinder3" => Some(Shape::Cylinder),
            "document" => Some(Shape::Document),
            "note" => Some(Shape::Note),
            "cloud" => Some(Shape::Cloud),
            "umlActor" => Some(Shape::Actor),
            "startState" | "endState" => Some(Shape::Ellipse),
            "line" if sideways => Some(Shape::VerticalLine),
            "line" => Some(Shape::Line),
            "process" => Some(Shape::Process),
            "swimlane" => Some(Shape::Swimlane),
            _ => None,
        });
        match shape {
            Some(shape) => shape,
            None if style.flag("rounded") => Shape::RoundedRectangle,
            None => Shape::Rectangle,
        }
    }

    /// Returns the outline of the shape within `r` as SVG path data.
    pub fn outline(self, r: Rect) -> String {
        let Rect {
            x,
            y,
            width: w,
            height: h,
        } = r;
        let p = |u: f64, v: f64| format!("{} {}", x + u * w, y + v * h);
        match self {
            Shape::Rectangle | Shape::Process => {
                format!("M{x} {y}H{}V{}H{x}Z", x + w, y + h)
            }
            Shape::RoundedRectangle => rounded(r, 10.0_f64.min(w / 4.0).min(h / 4.0)),
            Shape::Swimlane => format!("M{x} {y}H{}V{}H{x}Z", x + w, y + h),
            Shape::Line => format!("M{x} {}H{}", y + h / 2.0, x + w),
            // draw.io turns the shape a quarter around its center, so the line keeps the
            // length of the bounds' width.
            Shape::VerticalLine => format!(
                "M{} {}V{}",
                x + w / 2.0,
                y + h / 2.0 - w / 2.0,
                y + h / 2.0 + w / 2.0
            ),
            Shape::Ellipse => ellipse(r),
            Shape::Rhombus => format!(
                "M{}L{}L{}L{}Z",
                p(0.5, 0.0),
                p(1.0, 0.5),
                p(0.5, 1.0),
                p(0.0, 0.5)
            ),
            Shape::Triangle => format!("M{}L{}L{}Z", p(0.5, 0.0), p(1.0, 1.0), p(0.0, 1.0)),
            Shape::Hexagon => {
                let s = (w / 4.0).min(h / 2.0);
                format!(
                    "M{} {y}H{}L{} {}L{} {}H{}L{x} {}Z",
                    x + s,
                    x + w - s,
                    x + w,
                    y + h / 2.0,
                    x + w - s,
                    y + h,
                    x + s,
                    y + h / 2.0
                )
            }
            Shape::Parallelogram => {
                let s = (w * 0.2).min(20.0);
                format!("M{} {y}H{}L{} {}H{x}Z", x + s, x + w, x + w - s, y + h)
            }
            Shape::Trapezoid => {
                let s = (w * 0.2).min(20.0);
                format!("M{} {y}H{}L{} {}H{x}Z", x + s, x + w - s, x + w, y + h)
            }
            Shape::Step => {
                let s = (w * 0.2).min(h / 2.0);
                format!(
                    "M{x} {y}H{}L{} {}L{} {}H{x}L{} {}Z",
                    x + w - s,
                    x + w,
                    y + h / 2.0,
                    x + w - s,
                    y + h,
                    x + s,
                    y + h / 2.0
                )
            }
            Shape::Cylinder => {
                let k = (h * 0.12).min(10.0);
                format!(
                    "M{x} {}a{} {k} 0 0 1 {w} 0V{}a{} {k} 0 0 1 {} 0Z",
                    y + k,
                    w / 2.0,
                    y + h - k,
                    w / 2.0,
                    -w
                )
            }
            Shape::HorizontalCylinder => {
                let k = (w * 0.08).min(10.0);
                format!(
                    "M{} {y}H{}a{k} {} 0 0 1 0 {h}H{}a{k} {} 0 0 1 0 {}Z",
                    x + k,
                    x + w - k,
                    h / 2.0,
                    x + k,
                    h / 2.0,
                    -h
                )
            }
            Shape::Document => {
                let a = (h * 0.1).min(7.0);
                format!(
                    "M{x} {y}H{}V{}Q{} {} {} {}T{x} {}Z",
                    x + w,
                    y + h - a,
                    x + w * 0.75,
                    y + h - 3.0 * a,
                    x + w / 2.0,
                    y + h - a,
                    y + h - a
                )
            }
            Shape::Note => {
                let f = 14.0_f64.min(w / 5.0).min(h / 4.0);
                format!("M{x} {y}H{}L{} {}V{}H{x}Z", x + w - f, x + w, y + f, y + h)
            }
            Shape::Cloud => format!(
                "M{}C{} {} {}C{} {} {}C{} {} {}C{} {} {}Z",
                p(0.25, 0.9),
                p(0.03, 0.9),
                p(0.0, 0.56),
                p(0.18, 0.5),
                p(0.12, 0.2),
                p(0.45, 0.08),
                p(0.55, 0.3),
                p(0.65, 0.06),
                p(0.97, 0.14),
                p(0.88, 0.47),
                p(1.03, 0.55),
                p(1.0, 0.9),
                p(0.78, 0.9),
            ),
            Shape::Actor => {
                let (cx, k) = (x + w / 2.0, w.min(h) * 0.18);
                let mut d = format!(
                    "M{} {}a{k} {k} 0 1 0 {} 0a{k} {k} 0 1 0 {} 0Z",
                    cx - k,
                    y + k,
                    2.0 * k,
                    -2.0 * k
                );
                let (neck, hips, arms) = (y + 2.0 * k, y + h * 0.62, y + h * 0.38);
                let _ = write!(
                    d,
                    "M{cx} {neck}V{hips}M{x} {arms}H{}M{cx} {hips}L{x} {}M{cx} {hips}L{} {}",
                    x + w,
                    y + h,
                    x + w,
                    y + h
                );
                d
            }
        }
    }

    /// Returns extra interior lines, such as a cylinder's front rim, as SVG path data.
    pub fn detail(self, r: Rect, style: &Style) -> Option<String> {
        let Rect {
            x,
            y,
            width: w,
            height: h,
        } = r;
        match self {
            Shape::Cylinder => {
                let k = (h * 0.12).min(10.0);
                Some(format!("M{x} {}a{} {k} 0 0 0 {w} 0", y + k, w / 2.0))
            }
            Shape::HorizontalCylinder => {
                let k = (w * 0.08).min(10.0);
                Some(format!("M{} {y}a{k} {} 0 0 0 0 {h}", x + w - k, h / 2.0))
            }
            Shape::Note => {
                let f = 14.0_f64.min(w / 5.0).min(h / 4.0);
                Some(format!("M{} {y}V{}H{}", x + w - f, y + f, x + w))
            }
            Shape::Process => {
                let b = (w * 0.1).min(12.0);
                Some(format!(
                    "M{} {y}V{}M{} {y}V{}",
                    x + b,
                    y + h,
                    x + w - b,
                    y + h
                ))
            }
            Shape::Swimlane if horizontal(style) => {
                Some(format!("M{x} {}H{}", y + header(style), x + w))
            }
            Shape::Swimlane => Some(format!("M{} {y}V{}", x + header(style), y + h)),
            _ => None,
        }
    }

    /// Reports whether the shape is drawn with strokes only.
    pub fn is_open(self) -> bool {
        matches!(self, Shape::Actor | Shape::Line | Shape::VerticalLine)
    }

    /// Returns a container's header, which draw.io fills with `fillColor` while the body
    /// takes `swimlaneFillColor`.
    pub fn header(self, r: Rect, style: &Style) -> Option<Rect> {
        match self {
            Shape::Swimlane if horizontal(style) => {
                Some(Rect::new(r.x, r.y, r.width, header(style).min(r.height)))
            }
            Shape::Swimlane => Some(Rect::new(r.x, r.y, header(style).min(r.width), r.height)),
            _ => None,
        }
    }

    /// Returns the box the label is laid out in, following draw.io's label position keys.
    pub fn label_area(self, r: Rect, style: &Style) -> Rect {
        match (
            style.get("verticalLabelPosition"),
            style.get("labelPosition"),
        ) {
            (Some("bottom"), _) => {
                return Rect::new(r.x - r.width, r.bottom(), r.width * 3.0, 20.0);
            }
            (Some("top"), _) => return Rect::new(r.x - r.width, r.y - 20.0, r.width * 3.0, 20.0),
            (_, Some("left")) => return Rect::new(r.x - 120.0, r.y, 116.0, r.height),
            (_, Some("right")) => return Rect::new(r.right() + 4.0, r.y, 116.0, r.height),
            _ => {}
        }
        match self {
            Shape::Actor => Rect::new(r.x - r.width, r.bottom(), r.width * 3.0, 20.0),
            Shape::Swimlane => self.header(r, style).unwrap_or(r),
            Shape::Document => Rect::new(
                r.x,
                r.y,
                r.width,
                r.height - (r.height * 0.1).min(7.0) * 2.0,
            ),
            _ => r,
        }
    }
}

/// Returns a swimlane's header size from `startSize`, defaulting to draw.io's 23.
fn header(style: &Style) -> f64 {
    style.number("startSize").unwrap_or(23.0)
}

/// Reports whether a swimlane's header runs across the top. `horizontal=0` puts it on the
/// left.
fn horizontal(style: &Style) -> bool {
    style.get("horizontal") != Some("0")
}

fn rounded(r: Rect, k: f64) -> String {
    let Rect {
        x,
        y,
        width: w,
        height: h,
    } = r;
    format!(
        "M{} {y}H{}a{k} {k} 0 0 1 {k} {k}V{}a{k} {k} 0 0 1 {} {k}H{}a{k} {k} 0 0 1 {} {}V{}a{k} {k} 0 0 1 {k} {}Z",
        x + k,
        x + w - k,
        y + h - k,
        -k,
        x + k,
        -k,
        -k,
        y + k,
        -k
    )
}

fn ellipse(r: Rect) -> String {
    let (rx, ry) = (r.width / 2.0, r.height / 2.0);
    format!(
        "M{} {}a{rx} {ry} 0 1 0 {} 0a{rx} {ry} 0 1 0 {} 0Z",
        r.x,
        r.y + ry,
        r.width,
        -r.width
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stylesheet::Stylesheet;

    #[test]
    fn of_reads_draw_io_styles() {
        let tests = [
            ("default", "whiteSpace=wrap;html=1;", Shape::Rectangle),
            (
                "rounded",
                "rounded=1;whiteSpace=wrap;",
                Shape::RoundedRectangle,
            ),
            ("bare ellipse", "ellipse;whiteSpace=wrap;", Shape::Ellipse),
            (
                "shape key wins over bare name",
                "ellipse;shape=cloud;",
                Shape::Cloud,
            ),
            ("decision", "rhombus;whiteSpace=wrap;", Shape::Rhombus),
            (
                "database",
                "shape=cylinder3;whiteSpace=wrap;",
                Shape::Cylinder,
            ),
            (
                "queue",
                "shape=cylinder3;direction=south;",
                Shape::HorizontalCylinder,
            ),
            ("container", "swimlane;startSize=30;", Shape::Swimlane),
            (
                "text is a rectangle without paint",
                "text;html=1;",
                Shape::Rectangle,
            ),
            (
                "class divider",
                "line;strokeWidth=1;fillColor=none;",
                Shape::Line,
            ),
            (
                "activity bar",
                "line;html=1;strokeWidth=6;direction=south;",
                Shape::VerticalLine,
            ),
            (
                "start node",
                "ellipse;html=1;shape=startState;",
                Shape::Ellipse,
            ),
            (
                "actor",
                "shape=umlActor;verticalLabelPosition=bottom;",
                Shape::Actor,
            ),
            (
                "unknown stencil",
                "shape=mxgraph.aws4.lambda;",
                Shape::Rectangle,
            ),
        ];
        for (name, style, want) in tests {
            let resolved = Stylesheet::drawio().resolve(&Style::parse(style), false);
            assert_eq!(Shape::of(&resolved), want, "{name}");
        }
    }

    #[test]
    fn outlines_start_inside_their_bounds() {
        let r = Rect::new(10.0, 20.0, 120.0, 60.0);
        let shapes = [
            Shape::Rectangle,
            Shape::RoundedRectangle,
            Shape::Ellipse,
            Shape::Rhombus,
            Shape::Cylinder,
            Shape::HorizontalCylinder,
            Shape::Document,
            Shape::Note,
            Shape::Cloud,
            Shape::Actor,
            Shape::Swimlane,
        ];
        for shape in shapes {
            let d = shape.outline(r);
            let mut nums = d
                .trim_start_matches('M')
                .split([' ', 'L', 'H', 'V', 'a', 'Q', 'C', 'Z']);
            let x: f64 = nums
                .next()
                .and_then(|n| n.parse().ok())
                .unwrap_or_else(|| panic!("{shape:?}: {d}"));
            assert!(
                (r.x..=r.right()).contains(&x),
                "{shape:?} starts at x={x}: {d}"
            );
            assert!(
                d.ends_with('Z') || shape == Shape::Actor,
                "{shape:?} is not closed: {d}"
            );
        }
    }

    #[test]
    fn label_area_follows_position_keys() {
        let r = Rect::new(0.0, 0.0, 40.0, 70.0);
        let below = Shape::Actor.label_area(r, &Style::default());
        assert_eq!(below.y, 70.0);
        let header = Shape::Swimlane.label_area(
            Rect::new(0.0, 0.0, 200.0, 300.0),
            &Style::parse("swimlane;startSize=30;"),
        );
        assert_eq!(header.height, 30.0);
    }

    #[test]
    fn swimlane_header_follows_orientation() {
        let r = Rect::new(0.0, 0.0, 200.0, 300.0);
        let tests = [
            (
                "across the top",
                "swimlane;startSize=30;",
                Rect::new(0.0, 0.0, 200.0, 30.0),
            ),
            (
                "down the left",
                "swimlane;startSize=40;horizontal=0;",
                Rect::new(0.0, 0.0, 40.0, 300.0),
            ),
            (
                "draw.io default size",
                "swimlane;",
                Rect::new(0.0, 0.0, 200.0, 23.0),
            ),
        ];
        for (name, style, want) in tests {
            let style = Stylesheet::drawio().resolve(&Style::parse(style), false);
            assert_eq!(Shape::Swimlane.header(r, &style), Some(want), "{name}");
        }
        assert_eq!(Shape::Rectangle.header(r, &Style::default()), None);
    }
}
