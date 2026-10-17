// Ported from draw.io at commit 9034053fba, Copyright (c) JGraph Ltd, under the Apache
// License, Version 2.0: src/main/webapp/mxgraph/src/shape/mxMarker.js,
// src/main/webapp/js/grapheditor/Shapes.js, and src/main/webapp/shapes/er/mxER.js.

//! Arrowheads. Each drawing function ports one draw.io marker function and keeps its
//! variable names. `pe` is the end point, which the function may pull back to where the
//! line should stop.

use super::{MarkerFill, MarkerGeometry, MarkerPaint, Path, round2};
use crate::geometry::Point;
use crate::style::Style;

/// draw.io's `mxConstants.DEFAULT_MARKERSIZE`.
const DEFAULT_MARKERSIZE: f64 = 6.0;

/// The length over half width of mermaid's class-diagram markers, 17 to 6.
const MERMAID_WIDTH_FACTOR: f64 = 17.0 / 6.0;

/// The end of a connector an arrowhead sits on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum End {
    Source,
    Target,
}

/// An arrowhead as one end of a connector's style describes it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Marker {
    arrow: Arrow,
    size: f64,
    filled: bool,
    end: End,
}

/// The arrowhead kinds draw.io draws, named by `startArrow` and `endArrow`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Arrow {
    Classic,
    ClassicThin,
    Block,
    BlockThin,
    Open,
    OpenThin,
    Oval,
    BaseDash,
    DoubleBlock,
    Diamond,
    DiamondThin,
    ManyOptional,
    Dash,
    Box,
    Cross,
    Circle,
    CirclePlus,
    HalfCircle,
    Async,
    OpenAsync,
    MermaidExtension,
    MermaidDiamond,
    ErOne,
    ErMandOne,
    ErMany,
    ErOneToMany,
    ErZeroToMany,
    ErZeroToOne,
}

impl Arrow {
    fn parse(name: &str) -> Option<Arrow> {
        Some(match name {
            "classic" => Arrow::Classic,
            "classicThin" => Arrow::ClassicThin,
            "block" => Arrow::Block,
            "blockThin" => Arrow::BlockThin,
            "open" => Arrow::Open,
            "openThin" => Arrow::OpenThin,
            "oval" => Arrow::Oval,
            "baseDash" => Arrow::BaseDash,
            "doubleBlock" => Arrow::DoubleBlock,
            "diamond" => Arrow::Diamond,
            "diamondThin" => Arrow::DiamondThin,
            "manyOptional" => Arrow::ManyOptional,
            "dash" => Arrow::Dash,
            "box" => Arrow::Box,
            "cross" => Arrow::Cross,
            "circle" => Arrow::Circle,
            "circlePlus" => Arrow::CirclePlus,
            "halfCircle" => Arrow::HalfCircle,
            "async" => Arrow::Async,
            "openAsync" => Arrow::OpenAsync,
            "mermaidExtension" => Arrow::MermaidExtension,
            "mermaidDiamond" => Arrow::MermaidDiamond,
            "ERone" => Arrow::ErOne,
            "ERmandOne" => Arrow::ErMandOne,
            "ERmany" => Arrow::ErMany,
            "ERoneToMany" => Arrow::ErOneToMany,
            "ERzeroToMany" => Arrow::ErZeroToMany,
            "ERzeroToOne" => Arrow::ErZeroToOne,
            _ => return None,
        })
    }
}

/// What draw.io passes a marker function besides the end point.
#[derive(Clone, Copy)]
struct Args {
    /// The unit vector along the line towards the end point.
    ux: f64,
    uy: f64,
    size: f64,
    /// The stroke width.
    sw: f64,
    source: bool,
    filled: bool,
}

impl Marker {
    /// Reads the arrowhead at `end`, or `None` when the style names no arrowhead draw.io
    /// knows, in which case draw.io draws none and leaves the line at full length.
    pub(super) fn from_style(style: &Style, end: End) -> Option<Marker> {
        let (arrow, size, fill) = match end {
            End::Source => ("startArrow", "startSize", "startFill"),
            End::Target => ("endArrow", "endSize", "endFill"),
        };
        Some(Marker {
            arrow: Arrow::parse(style.get(arrow)?)?,
            size: style.number(size).unwrap_or(DEFAULT_MARKERSIZE),
            filled: style.number(fill) != Some(0.0),
            end,
        })
    }

    /// Pulls `pe` back to where the line should stop and returns the arrowhead's elements.
    /// `unit` points along the line towards `pe`, and `sw` is the stroke width.
    pub(super) fn draw(&self, pe: &mut Point, unit: Point, sw: f64) -> Vec<MarkerPaint> {
        let args = Args {
            ux: unit.x,
            uy: unit.y,
            size: self.size,
            sw,
            source: self.end == End::Source,
            filled: self.filled,
        };
        match self.arrow {
            Arrow::Classic => arrow(pe, args, 2.0, true),
            Arrow::ClassicThin => arrow(pe, args, 3.0, true),
            Arrow::Block => arrow(pe, args, 2.0, false),
            Arrow::BlockThin => arrow(pe, args, 3.0, false),
            Arrow::Open => open_arrow(pe, args, 2.0),
            Arrow::OpenThin => open_arrow(pe, args, 3.0),
            Arrow::Oval => oval(pe, args),
            Arrow::BaseDash => base_dash(pe, args),
            Arrow::DoubleBlock => double_block(pe, args),
            #[expect(clippy::approx_constant, reason = "draw.io truncates 1 / √2")]
            Arrow::Diamond => diamond(pe, args, 0.7071, 2.0),
            Arrow::DiamondThin => diamond(pe, args, 0.9862, 3.4),
            Arrow::ManyOptional => many_optional(pe, args),
            Arrow::Dash => dash(pe, args),
            Arrow::Box => box_marker(pe, args),
            Arrow::Cross => cross(pe, args),
            Arrow::Circle => circle(pe, args),
            Arrow::CirclePlus => circle_plus(pe, args),
            Arrow::HalfCircle => half_circle(pe, args),
            Arrow::Async => async_arrow(pe, args),
            Arrow::OpenAsync => open_async(pe, args),
            Arrow::MermaidExtension => mermaid_extension(pe, args),
            Arrow::MermaidDiamond => mermaid_diamond(pe, args),
            Arrow::ErOne => er_one(pe, args),
            Arrow::ErMandOne => er_mand_one(pe, args),
            Arrow::ErMany => er_many(pe, args),
            Arrow::ErOneToMany => er_one_to_many(pe, args),
            Arrow::ErZeroToMany => er_zero_to_many(pe, args),
            Arrow::ErZeroToOne => er_zero_to_one(pe, args),
        }
    }
}

/// The fill of an element that draw.io fills with the stroke color when `filled`.
fn fill(filled: bool) -> MarkerFill {
    if filled {
        MarkerFill::Stroke
    } else {
        MarkerFill::None
    }
}

fn path(d: Path, fill: MarkerFill) -> MarkerPaint {
    MarkerPaint {
        geometry: MarkerGeometry::Path(d.0),
        fill,
    }
}

/// The ellipse in the box at `x`, `y` of size `w`, `h`, as `mxSvgCanvas2D.ellipse` writes
/// it.
fn ellipse(x: f64, y: f64, w: f64, h: f64, fill: MarkerFill) -> MarkerPaint {
    MarkerPaint {
        geometry: MarkerGeometry::Ellipse {
            cx: round2(x + w / 2.0),
            cy: round2(y + h / 2.0),
            rx: round2(w / 2.0),
            ry: round2(h / 2.0),
        },
        fill,
    }
}

/// `mxMarker`'s `createArrow`, for `classic`, `classicThin`, `block`, and `blockThin`. A
/// notched head's back edge dents in by a quarter of its length.
fn arrow(pe: &mut Point, args: Args, width_factor: f64, notched: bool) -> Vec<MarkerPaint> {
    let Args {
        ux,
        uy,
        size,
        sw,
        filled,
        ..
    } = args;
    // 1.118 is half of 1 / sin(26.565°), the angle of the head's sides against the line.
    let (end_offset_x, end_offset_y) = (ux * sw * 1.118, uy * sw * 1.118);
    let (ux, uy) = (ux * (size + sw), uy * (size + sw));
    let pt = Point::new(pe.x - end_offset_x, pe.y - end_offset_y);
    let f = if notched { 3.0 / 4.0 } else { 1.0 };
    pe.x += -ux * f - end_offset_x;
    pe.y += -uy * f - end_offset_y;

    let wf = width_factor;
    let mut d = Path::default();
    d.move_to(pt.x, pt.y);
    d.line_to(pt.x - ux - uy / wf, pt.y - uy + ux / wf);
    if notched {
        d.line_to(pt.x - ux * 3.0 / 4.0, pt.y - uy * 3.0 / 4.0);
    }
    d.line_to(pt.x + uy / wf - ux, pt.y - uy - ux / wf);
    d.close();
    vec![path(d, fill(filled))]
}

/// `mxMarker`'s `createOpenArrow`, for `open` and `openThin`.
fn open_arrow(pe: &mut Point, args: Args, width_factor: f64) -> Vec<MarkerPaint> {
    let Args {
        ux, uy, size, sw, ..
    } = args;
    let (end_offset_x, end_offset_y) = (ux * sw * 1.118, uy * sw * 1.118);
    let (ux, uy) = (ux * (size + sw), uy * (size + sw));
    let pt = Point::new(pe.x - end_offset_x, pe.y - end_offset_y);
    pe.x += -end_offset_x * 2.0;
    pe.y += -end_offset_y * 2.0;

    let wf = width_factor;
    let mut d = Path::default();
    d.move_to(pt.x - ux - uy / wf, pt.y - uy + ux / wf);
    d.line_to(pt.x, pt.y);
    d.line_to(pt.x + uy / wf - ux, pt.y - uy - ux / wf);
    vec![path(d, MarkerFill::None)]
}

/// `mxMarker`'s `oval`: a circle centred on the end point.
fn oval(pe: &mut Point, args: Args) -> Vec<MarkerPaint> {
    let Args {
        ux,
        uy,
        size,
        filled,
        ..
    } = args;
    let a = size / 2.0;
    let pt = *pe;
    pe.x -= ux * a;
    pe.y -= uy * a;
    vec![ellipse(pt.x - a, pt.y - a, size, size, fill(filled))]
}

/// `mxMarker`'s `baseDash`: a bar across the end point.
fn base_dash(pe: &mut Point, args: Args) -> Vec<MarkerPaint> {
    let Args {
        ux, uy, size, sw, ..
    } = args;
    let (nx, ny) = (ux * (size + sw + 1.0), uy * (size + sw + 1.0));
    let mut d = Path::default();
    d.move_to(pe.x - ny / 2.0, pe.y + nx / 2.0);
    d.line_to(pe.x + ny / 2.0, pe.y - nx / 2.0);
    vec![path(d, MarkerFill::None)]
}

/// `mxMarker`'s `doubleBlock`: two `block` heads in a row.
fn double_block(pe: &mut Point, args: Args) -> Vec<MarkerPaint> {
    let Args {
        ux,
        uy,
        size,
        sw,
        filled,
        ..
    } = args;
    let wf = 2.0;
    let (end_offset_x, end_offset_y) = (ux * sw * 1.118, uy * sw * 1.118);
    let (ux, uy) = (ux * (size + sw), uy * (size + sw));
    let pt = Point::new(pe.x - end_offset_x, pe.y - end_offset_y);
    pe.x += -ux * 2.0 - end_offset_x;
    pe.y += -uy * 2.0 - end_offset_y;

    let mut d = Path::default();
    d.move_to(pt.x, pt.y);
    d.line_to(pt.x - ux - uy / wf, pt.y - uy + ux / wf);
    d.line_to(pt.x + uy / wf - ux, pt.y - uy - ux / wf);
    d.close();
    d.move_to(pt.x - ux, pt.y - uy);
    d.line_to(pt.x - 2.0 * ux - 0.5 * uy, pt.y + 0.5 * ux - 2.0 * uy);
    d.line_to(pt.x - 2.0 * ux + 0.5 * uy, pt.y - 0.5 * ux - 2.0 * uy);
    d.close();
    vec![path(d, fill(filled))]
}

/// `mxMarker`'s `diamond`, for `diamond` and `diamondThin`. `sw_factor` is half of
/// 1 / sin of the angle of the sides against the line, and `tk` sets the thickness. The two
/// depend on each other.
fn diamond(pe: &mut Point, args: Args, sw_factor: f64, tk: f64) -> Vec<MarkerPaint> {
    let Args {
        ux,
        uy,
        size,
        sw,
        filled,
        ..
    } = args;
    let (end_offset_x, end_offset_y) = (ux * sw * sw_factor, uy * sw * sw_factor);
    let (ux, uy) = (ux * (size + sw), uy * (size + sw));
    let pt = Point::new(pe.x - end_offset_x, pe.y - end_offset_y);
    pe.x += -ux - end_offset_x;
    pe.y += -uy - end_offset_y;

    let mut d = Path::default();
    d.move_to(pt.x, pt.y);
    d.line_to(pt.x - ux / 2.0 - uy / tk, pt.y + ux / tk - uy / 2.0);
    d.line_to(pt.x - ux, pt.y - uy);
    d.line_to(pt.x - ux / 2.0 + uy / tk, pt.y - uy / 2.0 - ux / tk);
    d.close();
    vec![path(d, fill(filled))]
}

/// `mxMarker`'s `manyOptional`: a crow's foot with a circle behind it.
fn many_optional(pe: &mut Point, args: Args) -> Vec<MarkerPaint> {
    let Args {
        ux,
        uy,
        size,
        sw,
        filled,
        ..
    } = args;
    let (nx, ny) = (ux * (size + sw + 1.0), uy * (size + sw + 1.0));
    let a = size / 2.0;
    let (px, py) = (pe.x, pe.y);
    pe.x -= 2.0 * nx - ux * sw / 2.0;
    pe.y -= 2.0 * ny - uy * sw / 2.0;

    let circle = ellipse(
        px - 1.5 * nx - a,
        py - 1.5 * ny - a,
        2.0 * a,
        2.0 * a,
        fill(filled),
    );
    let mut d = Path::default();
    d.move_to(px, py);
    d.line_to(px - nx, py - ny);
    d.move_to(px + ny / 2.0, py - nx / 2.0);
    d.line_to(px - nx, py - ny);
    d.line_to(px - ny / 2.0, py + nx / 2.0);
    vec![circle, path(d, MarkerFill::None)]
}

/// draw.io's `dash`: a slash across the line.
fn dash(pe: &mut Point, args: Args) -> Vec<MarkerPaint> {
    let Args {
        ux, uy, size, sw, ..
    } = args;
    let (nx, ny) = (ux * (size + sw + 1.0), uy * (size + sw + 1.0));
    let mut d = Path::default();
    d.move_to(pe.x - nx / 2.0 - ny / 2.0, pe.y - ny / 2.0 + nx / 2.0);
    d.line_to(
        pe.x + ny / 2.0 - 3.0 * nx / 2.0,
        pe.y - 3.0 * ny / 2.0 - nx / 2.0,
    );
    vec![path(d, MarkerFill::None)]
}

/// draw.io's `box`: a square that ends at the end point.
fn box_marker(pe: &mut Point, args: Args) -> Vec<MarkerPaint> {
    let Args {
        ux,
        uy,
        size,
        sw,
        filled,
        ..
    } = args;
    let (nx, ny) = (ux * (size + sw + 1.0), uy * (size + sw + 1.0));
    let (px, py) = (pe.x + nx / 2.0, pe.y + ny / 2.0);
    pe.x -= nx;
    pe.y -= ny;

    let mut d = Path::default();
    d.move_to(px - nx / 2.0 - ny / 2.0, py - ny / 2.0 + nx / 2.0);
    d.line_to(px - nx / 2.0 + ny / 2.0, py - ny / 2.0 - nx / 2.0);
    d.line_to(
        px + ny / 2.0 - 3.0 * nx / 2.0,
        py - 3.0 * ny / 2.0 - nx / 2.0,
    );
    d.line_to(
        px - ny / 2.0 - 3.0 * nx / 2.0,
        py - 3.0 * ny / 2.0 + nx / 2.0,
    );
    d.close();
    vec![path(d, fill(filled))]
}

/// draw.io's `cross`: an X across the line.
fn cross(pe: &mut Point, args: Args) -> Vec<MarkerPaint> {
    let Args {
        ux, uy, size, sw, ..
    } = args;
    let (nx, ny) = (ux * (size + sw + 1.0), uy * (size + sw + 1.0));
    let mut d = Path::default();
    d.move_to(pe.x - nx / 2.0 - ny / 2.0, pe.y - ny / 2.0 + nx / 2.0);
    d.line_to(
        pe.x + ny / 2.0 - 3.0 * nx / 2.0,
        pe.y - 3.0 * ny / 2.0 - nx / 2.0,
    );
    d.move_to(pe.x - nx / 2.0 + ny / 2.0, pe.y - ny / 2.0 - nx / 2.0);
    d.line_to(
        pe.x - ny / 2.0 - 3.0 * nx / 2.0,
        pe.y - 3.0 * ny / 2.0 + nx / 2.0,
    );
    vec![path(d, MarkerFill::None)]
}

/// draw.io's `circle`: a circle that touches the end point.
fn circle(pe: &mut Point, args: Args) -> Vec<MarkerPaint> {
    let Args {
        ux,
        uy,
        size,
        sw,
        filled,
        ..
    } = args;
    let size = size + sw;
    let pt = *pe;
    pe.x -= ux * (2.0 * size + sw);
    pe.y -= uy * (2.0 * size + sw);
    let (ux, uy) = (ux * (size + sw), uy * (size + sw));
    vec![ellipse(
        pt.x - ux - size,
        pt.y - uy - size,
        2.0 * size,
        2.0 * size,
        fill(filled),
    )]
}

/// draw.io's `circlePlus`: a `circle` with a cross inside.
fn circle_plus(pe: &mut Point, args: Args) -> Vec<MarkerPaint> {
    let Args {
        ux, uy, size, sw, ..
    } = args;
    let pt = *pe;
    let mut paint = circle(pe, args);
    let (nx, ny) = (ux * (size + 2.0 * sw), uy * (size + 2.0 * sw));

    let mut d = Path::default();
    d.move_to(pt.x - ux * sw, pt.y - uy * sw);
    d.line_to(pt.x - 2.0 * nx + ux * sw, pt.y - 2.0 * ny + uy * sw);
    d.move_to(pt.x - nx - ny + uy * sw, pt.y - ny + nx - ux * sw);
    d.line_to(pt.x + ny - nx - uy * sw, pt.y - ny - nx + ux * sw);
    paint.push(path(d, MarkerFill::None));
    paint
}

/// draw.io's `halfCircle`: an arc that opens towards the end point.
fn half_circle(pe: &mut Point, args: Args) -> Vec<MarkerPaint> {
    let Args {
        ux, uy, size, sw, ..
    } = args;
    let (nx, ny) = (ux * (size + sw + 1.0), uy * (size + sw + 1.0));
    let pt = *pe;
    pe.x -= nx;
    pe.y -= ny;

    let mut d = Path::default();
    d.move_to(pt.x - ny, pt.y + nx);
    d.quad_to(pe.x - ny, pe.y + nx, pe.x, pe.y);
    d.quad_to(pe.x + ny, pe.y - nx, pt.x + ny, pt.y - nx);
    vec![path(d, MarkerFill::None)]
}

/// draw.io's `async`: the half of a `block` head on one side of the line.
fn async_arrow(pe: &mut Point, args: Args) -> Vec<MarkerPaint> {
    let Args {
        ux,
        uy,
        size,
        sw,
        source,
        filled,
    } = args;
    let (end_offset_x, end_offset_y) = (ux * sw * 1.118, uy * sw * 1.118);
    let (ux, uy) = (ux * (size + sw), uy * (size + sw));
    let pt = Point::new(pe.x - end_offset_x, pe.y - end_offset_y);
    pe.x += -ux - end_offset_x;
    pe.y += -uy - end_offset_y;

    let mut d = Path::default();
    d.move_to(pt.x, pt.y);
    if source {
        d.line_to(pt.x - ux - uy / 2.0, pt.y - uy + ux / 2.0);
    } else {
        d.line_to(pt.x + uy / 2.0 - ux, pt.y - uy - ux / 2.0);
    }
    d.line_to(pt.x - ux, pt.y - uy);
    d.close();
    vec![path(d, fill(filled))]
}

/// draw.io's `openAsync`: one side of an `open` head.
fn open_async(pe: &mut Point, args: Args) -> Vec<MarkerPaint> {
    let Args {
        ux,
        uy,
        size,
        sw,
        source,
        ..
    } = args;
    let wf = 2.0;
    let (ux, uy) = (ux * (size + sw), uy * (size + sw));
    let pt = *pe;

    let mut d = Path::default();
    d.move_to(pt.x, pt.y);
    if source {
        d.line_to(pt.x - ux - uy / wf, pt.y - uy + ux / wf);
    } else {
        d.line_to(pt.x + uy / wf - ux, pt.y - uy - ux / wf);
    }
    vec![path(d, MarkerFill::None)]
}

/// draw.io's `mermaidExtension`: a triangle whose tip sits on the end point, with no
/// allowance for the stroke width.
fn mermaid_extension(pe: &mut Point, args: Args) -> Vec<MarkerPaint> {
    let Args {
        ux,
        uy,
        size,
        sw,
        filled,
        ..
    } = args;
    let wf = MERMAID_WIDTH_FACTOR;
    let (ux, uy) = (ux * (size + sw), uy * (size + sw));
    let pt = *pe;
    pe.x -= ux;
    pe.y -= uy;

    let mut d = Path::default();
    d.move_to(pt.x, pt.y);
    d.line_to(pt.x - ux - uy / wf, pt.y - uy + ux / wf);
    d.line_to(pt.x - ux + uy / wf, pt.y - uy - ux / wf);
    d.close();
    vec![path(d, fill(filled))]
}

/// draw.io's `mermaidDiamond`: a diamond whose tip sits on the end point.
fn mermaid_diamond(pe: &mut Point, args: Args) -> Vec<MarkerPaint> {
    let Args {
        ux,
        uy,
        size,
        sw,
        filled,
        ..
    } = args;
    let wf = MERMAID_WIDTH_FACTOR;
    let (ux, uy) = (ux * (size + sw), uy * (size + sw));
    let pt = *pe;
    pe.x -= ux;
    pe.y -= uy;

    let mut d = Path::default();
    d.move_to(pt.x, pt.y);
    d.line_to(pt.x - ux / 2.0 - uy / wf, pt.y - uy / 2.0 + ux / wf);
    d.line_to(pt.x - ux, pt.y - uy);
    d.line_to(pt.x - ux / 2.0 + uy / wf, pt.y - uy / 2.0 - ux / wf);
    d.close();
    vec![path(d, fill(filled))]
}

/// `mxER`'s `ERone`: one bar across the line.
fn er_one(pe: &mut Point, args: Args) -> Vec<MarkerPaint> {
    let Args {
        ux, uy, size, sw, ..
    } = args;
    let (nx, ny) = (ux * (size + sw + 1.0), uy * (size + sw + 1.0));
    let mut d = Path::default();
    d.move_to(pe.x - nx / 2.0 - ny / 2.0, pe.y - ny / 2.0 + nx / 2.0);
    d.line_to(pe.x - nx / 2.0 + ny / 2.0, pe.y - ny / 2.0 - nx / 2.0);
    vec![path(d, MarkerFill::None)]
}

/// `mxER`'s `ERmandOne`: two bars across the line.
fn er_mand_one(pe: &mut Point, args: Args) -> Vec<MarkerPaint> {
    let Args {
        ux, uy, size, sw, ..
    } = args;
    let (nx, ny) = (ux * (size + sw + 1.0), uy * (size + sw + 1.0));
    let mut d = Path::default();
    d.move_to(pe.x - nx / 2.0 - ny / 2.0, pe.y - ny / 2.0 + nx / 2.0);
    d.line_to(pe.x - nx / 2.0 + ny / 2.0, pe.y - ny / 2.0 - nx / 2.0);
    d.move_to(pe.x - nx - ny / 2.0, pe.y - ny + nx / 2.0);
    d.line_to(pe.x - nx + ny / 2.0, pe.y - ny - nx / 2.0);
    vec![path(d, MarkerFill::None)]
}

/// `mxER`'s `ERmany`: a crow's foot.
fn er_many(pe: &mut Point, args: Args) -> Vec<MarkerPaint> {
    let Args {
        ux, uy, size, sw, ..
    } = args;
    let (nx, ny) = (ux * (size + sw + 1.0), uy * (size + sw + 1.0));
    let mut d = Path::default();
    d.move_to(pe.x + ny / 2.0, pe.y - nx / 2.0);
    d.line_to(pe.x - nx, pe.y - ny);
    d.line_to(pe.x - ny / 2.0, pe.y + nx / 2.0);
    vec![path(d, MarkerFill::None)]
}

/// `mxER`'s `ERoneToMany`: a crow's foot behind a bar.
fn er_one_to_many(pe: &mut Point, args: Args) -> Vec<MarkerPaint> {
    let Args {
        ux, uy, size, sw, ..
    } = args;
    let (nx, ny) = (ux * (size + sw + 1.0), uy * (size + sw + 1.0));
    let mut d = Path::default();
    d.move_to(pe.x - nx - ny / 2.0, pe.y - ny + nx / 2.0);
    d.line_to(pe.x - nx + ny / 2.0, pe.y - ny - nx / 2.0);
    d.move_to(pe.x + ny / 2.0, pe.y - nx / 2.0);
    d.line_to(pe.x - nx, pe.y - ny);
    d.line_to(pe.x - ny / 2.0, pe.y + nx / 2.0);
    vec![path(d, MarkerFill::None)]
}

/// The circle of `ERzeroToMany` and `ERzeroToOne`. A filled one is painted white over the
/// full-length line. An unfilled one is outlined, and the line stops behind it.
fn er_circle(pe: &mut Point, args: Args) -> MarkerPaint {
    let Args {
        ux,
        uy,
        size,
        sw,
        filled,
        ..
    } = args;
    let (nx, ny) = (ux * (size + sw + 1.0), uy * (size + sw + 1.0));
    let a = size / 2.0;
    let (px, py) = (pe.x, pe.y);
    if !filled {
        pe.x -= 2.0 * nx - ux * sw / 2.0;
        pe.y -= 2.0 * ny - uy * sw / 2.0;
    }
    let fill = if filled {
        MarkerFill::White
    } else {
        MarkerFill::None
    };
    ellipse(px - 1.5 * nx - a, py - 1.5 * ny - a, 2.0 * a, 2.0 * a, fill)
}

/// `mxER`'s `ERzeroToMany`: a circle behind a crow's foot. Unfilled, the foot carries its
/// own stub of line, as the line stops at the circle.
fn er_zero_to_many(pe: &mut Point, args: Args) -> Vec<MarkerPaint> {
    let Args {
        ux,
        uy,
        size,
        sw,
        filled,
        ..
    } = args;
    let (nx, ny) = (ux * (size + sw + 1.0), uy * (size + sw + 1.0));
    let (px, py) = (pe.x, pe.y);
    let circle = er_circle(pe, args);

    let mut d = Path::default();
    d.move_to(px + ny / 2.0, py - nx / 2.0);
    d.line_to(px - nx, py - ny);
    d.line_to(px - ny / 2.0, py + nx / 2.0);
    if !filled {
        d.move_to(px - nx, py - ny);
        d.line_to(px, py);
    }
    vec![circle, path(d, MarkerFill::None)]
}

/// `mxER`'s `ERzeroToOne`: a circle behind a bar. Unfilled, the bar carries its own stub of
/// line, as the line stops at the circle.
fn er_zero_to_one(pe: &mut Point, args: Args) -> Vec<MarkerPaint> {
    let Args {
        ux,
        uy,
        size,
        sw,
        filled,
        ..
    } = args;
    let (nx, ny) = (ux * (size + sw + 1.0), uy * (size + sw + 1.0));
    let (px, py) = (pe.x, pe.y);
    let circle = er_circle(pe, args);

    let mut d = Path::default();
    d.move_to(px - nx / 2.0 - ny / 2.0, py - ny / 2.0 + nx / 2.0);
    d.line_to(px - nx / 2.0 + ny / 2.0, py - ny / 2.0 - nx / 2.0);
    if !filled {
        d.move_to(px - nx - ux * sw / 2.0, py - ny - uy * sw / 2.0);
        d.line_to(px, py);
    }
    vec![circle, path(d, MarkerFill::None)]
}
