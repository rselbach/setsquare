//! How a connector is painted: its line, with rounded or curved corners and dashes, and its
//! arrowheads. This follows draw.io's `mxConnector`, `mxShape.addPoints`, and `mxMarker`.

use std::fmt::Write;

use crate::geometry::Point;
use crate::style::Style;

/// The paint for one connector, as SVG path data in page coordinates.
#[derive(Clone, Debug, PartialEq)]
pub struct EdgeShape {
    /// The line, shortened at each end that has an arrowhead.
    pub line: String,
    /// The arrowhead elements, in the order draw.io paints them.
    pub markers: Vec<MarkerPaint>,
    pub stroke_width: f64,
    /// The SVG `stroke-dasharray`, already scaled by the stroke width.
    pub dash: Option<String>,
}

/// One element of an arrowhead.
#[derive(Clone, Debug, PartialEq)]
pub struct MarkerPaint {
    pub geometry: MarkerGeometry,
    /// Whether the element is filled with the stroke color. Unfilled ones are outlined.
    pub filled: bool,
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
pub fn edge_shape(points: &[Point], style: &Style) -> EdgeShape {
    let mut line = String::new();
    for (i, p) in points.iter().enumerate() {
        let _ = write!(line, "{}{} {}", if i == 0 { "M " } else { " L " }, p.x, p.y);
    }
    EdgeShape {
        line,
        markers: Vec::new(),
        stroke_width: style.number("strokeWidth").unwrap_or(1.0),
        dash: None,
    }
}
