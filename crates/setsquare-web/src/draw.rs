//! What the canvas paints for one cell, computed from the model.

use setsquare_core::{
    CellId, CellKind, MarkerFill, MarkerGeometry, MarkerPaint, Model, Rect, Shape, Style,
    edge_shape,
};

/// The paint for one cell. Equal values mean the cell does not need to redraw.
#[derive(Clone, Debug, PartialEq)]
pub enum CellDraw {
    Vertex(VertexDraw),
    Edge(EdgeDraw),
    Hidden,
}

#[derive(Clone, Debug, PartialEq)]
pub struct VertexDraw {
    pub outline: String,
    pub detail: Option<String>,
    pub fill: String,
    /// A container's header and its fill, painted over the body.
    pub header: Option<(String, String)>,
    /// Degrees clockwise around `pivot`, from the `rotation` style.
    pub rotation: f64,
    pub pivot: (f64, f64),
    pub stroke: String,
    pub stroke_width: f64,
    pub label: Option<Label>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct EdgeDraw {
    pub line: String,
    pub markers: Vec<MarkerPaint>,
    pub stroke: String,
    pub stroke_width: f64,
    pub dash: Option<String>,
    pub label: Option<Label>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Label {
    pub lines: Vec<String>,
    pub x: f64,
    /// The baseline-centered y of the first line.
    pub y: f64,
    pub anchor: &'static str,
    pub color: String,
    pub size: f64,
    pub bold: bool,
    /// The box behind the label and its color, for edge labels that sit on their line.
    pub backdrop: Option<(Rect, String)>,
}

const LINE_HEIGHT: f64 = 1.2;

impl CellDraw {
    pub fn of(model: &Model, id: &CellId) -> CellDraw {
        let Some(cell) = model.cell(id) else {
            return CellDraw::Hidden;
        };
        if !cell.visible {
            return CellDraw::Hidden;
        }
        let Some(style) = model.style(id) else {
            return CellDraw::Hidden;
        };
        match &cell.kind {
            CellKind::Layer => CellDraw::Hidden,
            CellKind::Vertex(_) => {
                let Some(bounds) = model.bounds(id) else {
                    return CellDraw::Hidden;
                };
                let shape = Shape::of(&style);
                let fill = paint(&style, "fillColor", "var(--sheet)");
                let header = shape.header(bounds, &style);
                // A container's body takes swimlaneFillColor; its fillColor goes to the header.
                let body = if header.is_some() {
                    paint(&style, "swimlaneFillColor", "var(--sheet)")
                } else {
                    fill.clone()
                };
                // Unpainted interiors stay transparent so a click anywhere inside selects them.
                let body = if shape.is_open() || body == "none" {
                    "transparent".to_owned()
                } else {
                    body
                };
                CellDraw::Vertex(VertexDraw {
                    outline: shape.outline(bounds),
                    detail: shape.detail(bounds, &style),
                    header: header.map(|r| (Shape::Rectangle.outline(r), fill)),
                    fill: body,
                    stroke: paint(&style, "strokeColor", "var(--diagram-text)"),
                    stroke_width: style.number("strokeWidth").unwrap_or(1.0),
                    rotation: style.number("rotation").unwrap_or(0.0),
                    pivot: (bounds.center().x, bounds.center().y),
                    label: label(&cell.label, &style, shape.label_area(bounds, &style)),
                })
            }
            CellKind::Edge(_) => {
                let Some(route) = model.route(id) else {
                    return CellDraw::Hidden;
                };
                let Some(shape) = edge_shape(&route, &style) else {
                    return CellDraw::Hidden;
                };
                let at = model.edge_label_point(id).unwrap_or_default();
                let backdrop = paint(&style, "labelBackgroundColor", "var(--sheet)");
                // draw.io aligns an edge label around its label point, not inside a box.
                let label =
                    label(&cell.label, &style, Rect::new(at.x, at.y, 0.0, 0.0)).map(|mut l| {
                        l.backdrop = (backdrop != "none").then(|| (l.text_box(), backdrop));
                        l
                    });
                CellDraw::Edge(EdgeDraw {
                    line: shape.line,
                    markers: shape.markers,
                    stroke: paint(&style, "strokeColor", "var(--diagram-text)"),
                    stroke_width: shape.stroke_width,
                    dash: shape.dash,
                    label,
                })
            }
        }
    }
}

impl CellDraw {
    /// Returns the cell as an SVG fragment.
    pub fn markup(&self) -> String {
        match self {
            CellDraw::Hidden => String::new(),
            CellDraw::Vertex(v) => {
                let mut out = format!(
                    r#"<path d="{}" style="fill:{};stroke:{};stroke-width:{}"/>"#,
                    v.outline, v.fill, v.stroke, v.stroke_width
                );
                if let Some((d, fill)) = &v.header {
                    out += &format!(
                        r#"<path d="{d}" style="fill:{fill};stroke:{};stroke-width:{}"/>"#,
                        v.stroke, v.stroke_width
                    );
                }
                if let Some(d) = &v.detail {
                    out += &format!(
                        r#"<path class="detail" d="{d}" style="stroke:{};stroke-width:{}"/>"#,
                        v.stroke, v.stroke_width
                    );
                }
                if let Some(l) = &v.label {
                    out += &l.markup();
                }
                // draw.io turns the shape and its label together around the center.
                if v.rotation != 0.0 {
                    out = format!(
                        r#"<g transform="rotate({} {} {})">{out}</g>"#,
                        v.rotation, v.pivot.0, v.pivot.1
                    );
                }
                out
            }
            CellDraw::Edge(e) => {
                let dash = e
                    .dash
                    .as_ref()
                    .map(|d| format!(";stroke-dasharray:{d}"))
                    .unwrap_or_default();
                let mut out = format!(
                    r#"<path class="hit" d="{0}"/><path class="edge" d="{0}" style="stroke:{1};stroke-width:{2}{dash}"/>"#,
                    e.line, e.stroke, e.stroke_width
                );
                for m in &e.markers {
                    let fill = match m.fill {
                        MarkerFill::None => "none",
                        MarkerFill::Stroke => e.stroke.as_str(),
                        MarkerFill::White => "#ffffff",
                    };
                    let style = format!(
                        r#"style="fill:{fill};stroke:{};stroke-width:{}""#,
                        e.stroke, e.stroke_width
                    );
                    out += &match &m.geometry {
                        MarkerGeometry::Path(d) => format!(r#"<path d="{d}" {style}/>"#),
                        MarkerGeometry::Ellipse { cx, cy, rx, ry } => {
                            format!(r#"<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" {style}/>"#)
                        }
                    };
                }
                if let Some(l) = &e.label {
                    out += &l.markup();
                }
                out
            }
        }
    }
}

impl Label {
    /// Returns an estimate of the box the text covers, padded by two units.
    fn text_box(&self) -> Rect {
        let longest = self
            .lines
            .iter()
            .map(|t| t.chars().count())
            .max()
            .unwrap_or(0) as f64;
        let width = longest * self.size * 0.55 + 4.0;
        let height = self.lines.len() as f64 * self.size * LINE_HEIGHT;
        let left = match self.anchor {
            "start" => self.x - 2.0,
            "end" => self.x - width + 2.0,
            _ => self.x - width / 2.0,
        };
        Rect::new(left, self.y - self.size * LINE_HEIGHT / 2.0, width, height)
    }

    fn markup(&self) -> String {
        let mut out = String::new();
        if let Some((r, color)) = &self.backdrop {
            out += &format!(
                r#"<rect x="{}" y="{}" width="{}" height="{}" style="fill:{color}"/>"#,
                r.x, r.y, r.width, r.height
            );
        }
        let weight = if self.bold { 700 } else { 400 };
        for (i, line) in self.lines.iter().enumerate() {
            let y = self.y + i as f64 * self.size * LINE_HEIGHT;
            out += &format!(
                r#"<text class="label" x="{}" y="{y}" style="text-anchor:{};fill:{};font-size:{}px;font-weight:{weight}">{}</text>"#,
                self.x,
                self.anchor,
                self.color,
                self.size,
                escape(line)
            );
        }
        out
    }
}

/// Escapes text for use inside SVG markup.
pub fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Returns a color from an effective style as CSS. A missing color means draw.io paints
/// nothing, `default` means the theme's color, and `light-dark(a,b)` pairs are valid CSS
/// as they are.
fn paint(style: &Style, key: &str, theme: &str) -> String {
    match style.get(key) {
        None => "none".to_owned(),
        Some("default") => theme.to_owned(),
        Some(c) => c.to_owned(),
    }
}

fn label(text: &str, style: &Style, area: Rect) -> Option<Label> {
    let text = if style.flag("html") {
        plain_text(text)
    } else {
        text.to_owned()
    };
    if text.trim().is_empty() || style.flag("noLabel") {
        return None;
    }
    let lines: Vec<String> = text.lines().map(str::to_owned).collect();
    let size = style.number("fontSize").unwrap_or(12.0);
    let spacing = style.number("spacing").unwrap_or(2.0);
    let (x, anchor) = match style.get("align") {
        Some("left") => (
            area.x + spacing + style.number("spacingLeft").unwrap_or(0.0),
            "start",
        ),
        Some("right") => (
            area.right() - spacing - style.number("spacingRight").unwrap_or(0.0),
            "end",
        ),
        _ => (area.center().x, "middle"),
    };
    let block = (lines.len() - 1) as f64 * size * LINE_HEIGHT;
    let y = match style.get("verticalAlign") {
        Some("top") => area.y + spacing + size * 0.6,
        Some("bottom") => area.bottom() - spacing - size * 0.6 - block,
        _ => area.center().y - block / 2.0,
    };
    Some(Label {
        lines,
        x,
        y,
        anchor,
        color: paint(style, "fontColor", "var(--diagram-text)"),
        size,
        bold: style.number("fontStyle").is_some_and(|s| s as i64 & 1 == 1),
        backdrop: None,
    })
}

/// Converts a simple HTML label to plain text with line breaks. Rich text rendering
/// replaces this when labels move to an HTML layer.
fn plain_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(start) = rest.find('<') {
        out.push_str(&rest[..start]);
        let Some(end) = rest[start..].find('>') else {
            break;
        };
        let tag = rest[start + 1..start + end]
            .trim_start_matches('/')
            .to_ascii_lowercase();
        if tag.starts_with("br") || tag.starts_with("div") || tag.starts_with('p') {
            out.push('\n');
        }
        rest = &rest[start + end + 1..];
    }
    out.push_str(rest);
    out.replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&amp;", "&")
}
