//! What the canvas paints for one cell, computed from the model.

use setsquare_core::{CellId, CellKind, Model, Rect, Shape, Style};

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
    pub stroke: String,
    pub stroke_width: f64,
    pub label: Option<Label>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct EdgeDraw {
    pub path: String,
    pub stroke: String,
    pub stroke_width: f64,
    pub dashed: bool,
    pub arrow: bool,
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
    /// The box behind the label, for edge labels that sit on top of their line.
    pub backdrop: Option<Rect>,
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
        match &cell.kind {
            CellKind::Layer => CellDraw::Hidden,
            CellKind::Vertex(_) => {
                let Some(bounds) = model.bounds(id) else {
                    return CellDraw::Hidden;
                };
                let style = &cell.style;
                let shape = Shape::of(style);
                // Open shapes get a transparent fill so a click anywhere inside selects them.
                let open = shape.is_open() || style.get("fillColor") == Some("none");
                CellDraw::Vertex(VertexDraw {
                    outline: shape.outline(bounds),
                    detail: shape.detail(bounds, style),
                    fill: if open {
                        "transparent".into()
                    } else {
                        color(style, "fillColor", "var(--sheet)")
                    },
                    stroke: if shape == Shape::Text {
                        "none".into()
                    } else {
                        color(style, "strokeColor", "var(--diagram-text)")
                    },
                    stroke_width: style.number("strokeWidth").unwrap_or(1.0),
                    label: label(&cell.label, style, shape.label_area(bounds, style)),
                })
            }
            CellKind::Edge(_) => {
                let Some(route) = model.route(id) else {
                    return CellDraw::Hidden;
                };
                let style = &cell.style;
                let path = route
                    .iter()
                    .enumerate()
                    .map(|(i, p)| format!("{}{} {}", if i == 0 { 'M' } else { 'L' }, p.x, p.y))
                    .collect();
                let at = model.point_along(id, 0.0).unwrap_or_default();
                let label = label(
                    &cell.label,
                    style,
                    Rect::new(at.x - 60.0, at.y - 10.0, 120.0, 20.0),
                )
                .map(|mut l| {
                    let width = l.lines.iter().map(|t| t.chars().count()).max().unwrap_or(0) as f64
                        * l.size
                        * 0.55
                        + 8.0;
                    let height = l.lines.len() as f64 * l.size * LINE_HEIGHT + 2.0;
                    l.backdrop = Some(Rect::new(
                        at.x - width / 2.0,
                        at.y - height / 2.0,
                        width,
                        height,
                    ));
                    l
                });
                CellDraw::Edge(EdgeDraw {
                    path,
                    stroke: color(style, "strokeColor", "var(--diagram-text)"),
                    stroke_width: style.number("strokeWidth").unwrap_or(1.0),
                    dashed: style.flag("dashed"),
                    arrow: style.get("endArrow") != Some("none"),
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
                if let Some(d) = &v.detail {
                    out += &format!(
                        r#"<path class="detail" d="{d}" style="stroke:{};stroke-width:{}"/>"#,
                        v.stroke, v.stroke_width
                    );
                }
                if let Some(l) = &v.label {
                    out += &l.markup();
                }
                out
            }
            CellDraw::Edge(e) => {
                let dash = if e.dashed {
                    ";stroke-dasharray:6 4"
                } else {
                    ""
                };
                let marker = if e.arrow {
                    r#" marker-end="url(#arrow)""#
                } else {
                    ""
                };
                let mut out = format!(
                    r#"<path class="hit" d="{0}"/><path class="edge" d="{0}"{marker} style="stroke:{1};stroke-width:{2}{dash}"/>"#,
                    e.path, e.stroke, e.stroke_width
                );
                if let Some(l) = &e.label {
                    out += &l.markup();
                }
                out
            }
        }
    }
}

impl Label {
    fn markup(&self) -> String {
        let mut out = String::new();
        if let Some(r) = self.backdrop {
            out += &format!(
                r#"<rect x="{}" y="{}" width="{}" height="{}" style="fill:var(--sheet)"/>"#,
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

/// Returns a style color as CSS. draw.io's `light-dark(a,b)` pairs are valid CSS as is,
/// and `default` or a missing key falls back to a theme-aware variable.
fn color(style: &Style, key: &str, fallback: &str) -> String {
    match style.get(key) {
        None | Some("default") => fallback.to_owned(),
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
        color: color(style, "fontColor", "var(--diagram-text)"),
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
