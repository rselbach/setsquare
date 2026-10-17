//! Reading and writing draw.io files.
//!
//! A file is an `mxfile` element with one `diagram` element per page. Each page holds an
//! `mxGraphModel`, either as XML or compressed as base64 of raw deflate of the
//! URI-encoded XML. Older files and the clipboard use a bare `mxGraphModel` with one page.

use std::fmt::{self, Write};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, percent_decode_str, utf8_percent_encode};
use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, XmlVersion};

use crate::change::Change;
use crate::geometry::{Point, Rect, Size};
use crate::model::{
    Cell, CellId, CellKind, Document, Edge, EdgeGeometry, Model, ModelError, ObjectTag, Page,
    PageSettings, UserObject, Vertex, VertexGeometry,
};
use crate::style::Style;

/// An error reading a draw.io file.
#[derive(Clone, Debug, PartialEq)]
pub enum ReadError {
    /// The text is not well-formed XML.
    Xml(String),
    /// The root element is neither `mxfile` nor `mxGraphModel`.
    NotDrawio(String),
    /// The file has no pages.
    NoPages,
    /// A compressed page could not be decoded.
    Compressed { page: String, reason: String },
    /// A page has no `root` element.
    MissingRoot { page: String },
    /// The cells of a page do not form a valid tree.
    Model { page: String, reason: ModelError },
}

impl fmt::Display for ReadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ReadError::Xml(reason) => write!(f, "the file is not valid XML: {reason}"),
            ReadError::NotDrawio(root) => write!(
                f,
                "the file is not a draw.io drawing: its root element is <{root}>"
            ),
            ReadError::NoPages => write!(f, "the file has no pages"),
            ReadError::Compressed { page, reason } => {
                write!(f, "page {page:?} could not be decompressed: {reason}")
            }
            ReadError::MissingRoot { page } => write!(f, "page {page:?} has no cells"),
            ReadError::Model { page, reason } => write!(f, "page {page:?} is damaged: {reason}"),
        }
    }
}

impl std::error::Error for ReadError {}

/// Reads a draw.io file.
pub fn read(text: &str) -> Result<Document, ReadError> {
    let root = parse_xml(text)?;
    let pages: Vec<Page> = match root.name.as_str() {
        "mxfile" => root
            .children_named("diagram")
            .enumerate()
            .map(|(i, d)| read_diagram(d, i))
            .collect::<Result<_, _>>()?,
        "mxGraphModel" => vec![read_page(&root, "page-1".into(), "Page-1".into())?],
        other => return Err(ReadError::NotDrawio(other.to_owned())),
    };
    let mut pages = pages.into_iter();
    let mut doc = Document::new(pages.next().ok_or(ReadError::NoPages)?);
    for page in pages {
        doc.push_page(page);
    }
    Ok(doc)
}

/// Writes a document as a draw.io file with uncompressed pages.
pub fn write(doc: &Document) -> String {
    let mut out = format!(
        r#"<mxfile host="Setsquare" agent="Setsquare" version="{}">"#,
        env!("CARGO_PKG_VERSION")
    );
    for page in doc.pages() {
        let _ = write!(
            out,
            r#"<diagram id="{}" name="{}">"#,
            escape(&page.id),
            escape(&page.name)
        );
        out += &model_xml(&page.settings, &page.model);
        out += "</diagram>";
    }
    out += "</mxfile>";
    out
}

/// Decodes a compressed page the way draw.io does: base64, then raw inflate, then URI
/// decoding.
pub fn decompress(data: &str) -> Result<String, String> {
    let compact: String = data.split_whitespace().collect();
    let bytes = STANDARD
        .decode(compact)
        .map_err(|e| format!("base64: {e}"))?;
    let inflated =
        miniz_oxide::inflate::decompress_to_vec(&bytes).map_err(|e| format!("inflate: {e}"))?;
    let encoded = String::from_utf8(inflated).map_err(|e| format!("text: {e}"))?;
    percent_decode_str(&encoded)
        .decode_utf8()
        .map(|s| s.into_owned())
        .map_err(|e| format!("URI: {e}"))
}

/// The characters JavaScript's `encodeURIComponent` leaves alone.
const URI_COMPONENT: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'!')
    .remove(b'~')
    .remove(b'*')
    .remove(b'\'')
    .remove(b'(')
    .remove(b')');

/// Compresses page XML the way draw.io does. [`decompress`] reverses it.
pub fn compress(xml: &str) -> String {
    let encoded = utf8_percent_encode(xml, URI_COMPONENT).to_string();
    STANDARD.encode(miniz_oxide::deflate::compress_to_vec(encoded.as_bytes(), 9))
}

#[derive(Debug, Default)]
struct Element {
    name: String,
    attrs: Vec<(String, String)>,
    children: Vec<Element>,
    text: String,
}

impl Element {
    fn attr(&self, key: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }

    fn number(&self, key: &str) -> f64 {
        self.attr(key).and_then(|v| v.parse().ok()).unwrap_or(0.0)
    }

    fn child(&self, name: &str) -> Option<&Element> {
        self.children.iter().find(|c| c.name == name)
    }

    fn child_as(&self, name: &str, role: &str) -> Option<&Element> {
        self.children
            .iter()
            .find(|c| c.name == name && c.attr("as") == Some(role))
    }

    fn children_named<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Element> {
        self.children.iter().filter(move |c| c.name == name)
    }
}

fn xml_error(e: impl fmt::Display) -> ReadError {
    ReadError::Xml(e.to_string())
}

fn element(start: &BytesStart) -> Result<Element, ReadError> {
    let mut attrs = Vec::new();
    for attr in start.attributes() {
        let attr = attr.map_err(xml_error)?;
        let key = attr.key.as_ref().to_owned();
        let value = attr
            .normalized_value(XmlVersion::Implicit1_0)
            .map_err(xml_error)?
            .into_owned();
        attrs.push((key, value));
    }
    Ok(Element {
        name: start.name().as_ref().to_owned(),
        attrs,
        ..Element::default()
    })
}

/// Parses XML into a small element tree and returns the root element.
fn parse_xml(text: &str) -> Result<Element, ReadError> {
    let mut reader = Reader::from_str(text);
    let mut stack = vec![Element::default()];
    loop {
        match reader.read_event().map_err(xml_error)? {
            Event::Start(start) => stack.push(element(&start)?),
            Event::Empty(start) => {
                let el = element(&start)?;
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(el);
                }
            }
            Event::End(_) => {
                let el = stack
                    .pop()
                    .ok_or_else(|| xml_error("unexpected closing tag"))?;
                stack
                    .last_mut()
                    .ok_or_else(|| xml_error("unexpected closing tag"))?
                    .children
                    .push(el);
            }
            Event::Text(text) => {
                if let Some(top) = stack.last_mut() {
                    top.text.push_str(&text.xml10_content());
                }
            }
            Event::GeneralRef(entity) => {
                let resolved = match entity.resolve_char_ref().map_err(xml_error)? {
                    Some(c) => c,
                    None => match &*entity {
                        "amp" => '&',
                        "lt" => '<',
                        "gt" => '>',
                        "quot" => '"',
                        "apos" => '\'',
                        other => return Err(xml_error(format!("unknown entity &{other};"))),
                    },
                };
                if let Some(top) = stack.last_mut() {
                    top.text.push(resolved);
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    let mut document = stack
        .pop()
        .filter(|_| stack.is_empty())
        .ok_or_else(|| xml_error("unclosed element"))?;
    document
        .children
        .drain(..)
        .next()
        .ok_or_else(|| xml_error("the file is empty"))
}

fn read_diagram(diagram: &Element, index: usize) -> Result<Page, ReadError> {
    let id = diagram
        .attr("id")
        .map_or_else(|| format!("page-{}", index + 1), str::to_owned);
    let name = diagram
        .attr("name")
        .map_or_else(|| format!("Page-{}", index + 1), str::to_owned);
    if let Some(model) = diagram.child("mxGraphModel") {
        return read_page(model, id, name);
    }
    if diagram.text.trim().is_empty() {
        return Ok(Page {
            id,
            name,
            settings: PageSettings::default(),
            model: Model::new(),
        });
    }
    let xml = decompress(&diagram.text).map_err(|reason| ReadError::Compressed {
        page: name.clone(),
        reason,
    })?;
    read_page(&parse_xml(&xml)?, id, name)
}

const SETTINGS: [&str; 14] = [
    "grid",
    "gridSize",
    "guides",
    "tooltips",
    "connect",
    "arrows",
    "fold",
    "page",
    "pageScale",
    "pageWidth",
    "pageHeight",
    "background",
    "math",
    "shadow",
];

fn read_page(model: &Element, id: String, name: String) -> Result<Page, ReadError> {
    let d = PageSettings::default();
    let flag = |key: &str, default: bool| model.attr(key).map_or(default, |v| v == "1");
    let number = |key: &str, default: f64| {
        model
            .attr(key)
            .and_then(|v| v.parse().ok())
            .unwrap_or(default)
    };
    let settings = PageSettings {
        grid: flag("grid", d.grid),
        grid_size: number("gridSize", d.grid_size),
        guides: flag("guides", d.guides),
        tooltips: flag("tooltips", d.tooltips),
        connect: flag("connect", d.connect),
        arrows: flag("arrows", d.arrows),
        fold: flag("fold", d.fold),
        page_view: flag("page", d.page_view),
        page_scale: number("pageScale", d.page_scale),
        page_size: Size::new(
            number("pageWidth", d.page_size.width),
            number("pageHeight", d.page_size.height),
        ),
        background: model
            .attr("background")
            .filter(|b| !b.is_empty() && *b != "none")
            .map(str::to_owned),
        math: flag("math", d.math),
        shadow: flag("shadow", d.shadow),
        extra: model
            .attrs
            .iter()
            .filter(|(k, _)| !SETTINGS.contains(&k.as_str()))
            .cloned()
            .collect(),
    };
    let root = model
        .child("root")
        .ok_or_else(|| ReadError::MissingRoot { page: name.clone() })?;
    let model = read_cells(root).map_err(|reason| ReadError::Model {
        page: name.clone(),
        reason,
    })?;
    Ok(Page {
        id,
        name,
        settings,
        model,
    })
}

/// One cell as it appears in the file, before it joins the tree.
struct Raw<'a> {
    cell: &'a Element,
    id: String,
    label: String,
    object: Option<UserObject>,
}

fn read_cells(root: &Element) -> Result<Model, ModelError> {
    let mut generated = 0;
    let mut raws = Vec::new();
    for child in &root.children {
        let mut id = |el: &Element| {
            el.attr("id").map_or_else(
                || {
                    generated += 1;
                    format!("ss-read-{generated}")
                },
                str::to_owned,
            )
        };
        match child.name.as_str() {
            "mxCell" => raws.push(Raw {
                cell: child,
                id: id(child),
                label: child.attr("value").unwrap_or_default().to_owned(),
                object: None,
            }),
            "UserObject" | "object" => {
                let Some(cell) = child.child("mxCell") else {
                    continue;
                };
                let tag = if child.name == "object" {
                    ObjectTag::Object
                } else {
                    ObjectTag::UserObject
                };
                let attributes = child
                    .attrs
                    .iter()
                    .filter(|(k, _)| k != "id" && k != "label")
                    .cloned()
                    .collect();
                raws.push(Raw {
                    cell,
                    id: id(child),
                    label: child.attr("label").unwrap_or_default().to_owned(),
                    object: Some(UserObject { tag, attributes }),
                });
            }
            _ => {}
        }
    }

    let root_id = raws
        .iter()
        .find(|r| r.cell.attr("parent").is_none())
        .map(|r| r.id.clone());
    let known: std::collections::HashSet<&str> = raws.iter().map(|r| r.id.as_str()).collect();
    let terminal = |key: &str, cell: &Element| {
        cell.attr(key)
            .filter(|t| known.contains(t))
            .map(CellId::new)
    };
    let mut cells = Vec::with_capacity(raws.len());
    for raw in &raws {
        let el = raw.cell;
        let kind = match el.attr("parent") {
            None if Some(&raw.id) == root_id.as_ref() => continue,
            None => CellKind::Layer,
            Some(p) if Some(p) == root_id.as_deref() => CellKind::Layer,
            Some(p) => {
                let parent = CellId::new(p);
                let geometry = el
                    .child_as("mxGeometry", "geometry")
                    .or_else(|| el.child("mxGeometry"));
                if el.attr("edge") == Some("1") {
                    CellKind::Edge(Edge {
                        parent,
                        source: terminal("source", el),
                        target: terminal("target", el),
                        geometry: geometry.map(edge_geometry).unwrap_or_default(),
                    })
                } else {
                    let (geometry, alternate_bounds) = vertex_geometry(geometry);
                    CellKind::Vertex(Vertex {
                        parent,
                        geometry,
                        connectable: el.attr("connectable") != Some("0"),
                        alternate_bounds,
                    })
                }
            }
        };
        cells.push((
            Cell {
                id: CellId::new(&raw.id),
                kind,
                label: raw.label.clone(),
                style: Style::parse(el.attr("style").unwrap_or_default()),
                visible: el.attr("visible") != Some("0"),
                collapsed: el.attr("collapsed") == Some("1"),
                object: raw.object.clone(),
            },
            usize::MAX,
        ));
    }
    let mut model = Model::default();
    model.apply(Change::Insert { cells })?;
    Ok(model)
}

fn point(el: &Element) -> Point {
    Point::new(el.number("x"), el.number("y"))
}

fn rect(el: &Element) -> Rect {
    Rect::new(
        el.number("x"),
        el.number("y"),
        el.number("width"),
        el.number("height"),
    )
}

fn vertex_geometry(geometry: Option<&Element>) -> (VertexGeometry, Option<Rect>) {
    let Some(g) = geometry else {
        return (VertexGeometry::Bounds(Rect::default()), None);
    };
    let alternate = g.child_as("mxRectangle", "alternateBounds").map(rect);
    if g.attr("relative") == Some("1") {
        let offset = g
            .child_as("mxPoint", "offset")
            .map(point)
            .unwrap_or_default();
        let size = Size::new(g.number("width"), g.number("height"));
        return (
            VertexGeometry::Relative {
                anchor: point(g),
                offset,
                size,
            },
            alternate,
        );
    }
    (VertexGeometry::Bounds(rect(g)), alternate)
}

fn edge_geometry(g: &Element) -> EdgeGeometry {
    EdgeGeometry {
        points: g
            .child_as("Array", "points")
            .map(|a| a.children_named("mxPoint").map(point).collect())
            .unwrap_or_default(),
        source_point: g.child_as("mxPoint", "sourcePoint").map(point),
        target_point: g.child_as("mxPoint", "targetPoint").map(point),
        label_position: point(g),
        label_offset: g
            .child_as("mxPoint", "offset")
            .map(point)
            .unwrap_or_default(),
        relative: g.attr("relative") == Some("1"),
    }
}

/// Escapes an attribute value. Line breaks become character references, because XML
/// parsers turn literal line breaks in attributes into spaces.
fn escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\n' => out.push_str("&#xa;"),
            '\r' => out.push_str("&#xd;"),
            '\t' => out.push_str("&#x9;"),
            c => out.push(c),
        }
    }
    out
}

/// Formats a number the way draw.io does, without a trailing `.0` and without `-0`.
fn num(v: f64) -> String {
    if v == 0.0 {
        "0".to_owned()
    } else {
        v.to_string()
    }
}

fn model_xml(settings: &PageSettings, model: &Model) -> String {
    let b = |v: bool| if v { "1" } else { "0" };
    let s = settings;
    let mut out = format!(
        r#"<mxGraphModel grid="{}" gridSize="{}" guides="{}" tooltips="{}" connect="{}" arrows="{}" fold="{}" page="{}" pageScale="{}" pageWidth="{}" pageHeight="{}" math="{}" shadow="{}""#,
        b(s.grid),
        num(s.grid_size),
        b(s.guides),
        b(s.tooltips),
        b(s.connect),
        b(s.arrows),
        b(s.fold),
        b(s.page_view),
        num(s.page_scale),
        num(s.page_size.width),
        num(s.page_size.height),
        b(s.math),
        b(s.shadow),
    );
    if let Some(bg) = &s.background {
        let _ = write!(out, r#" background="{}""#, escape(bg));
    }
    for (k, v) in &s.extra {
        let _ = write!(out, r#" {k}="{}""#, escape(v));
    }
    out += r#"><root><mxCell id="0"/>"#;
    for cell in model.paint_order() {
        write_cell(&mut out, cell);
    }
    out += "</root></mxGraphModel>";
    out
}

fn write_cell(out: &mut String, cell: &Cell) {
    let id = escape(cell.id.as_str());
    let tag = match &cell.object {
        Some(object) => {
            let tag = if object.tag == ObjectTag::Object {
                "object"
            } else {
                "UserObject"
            };
            let _ = write!(out, r#"<{tag} label="{}""#, escape(&cell.label));
            for (k, v) in &object.attributes {
                let _ = write!(out, r#" {k}="{}""#, escape(v));
            }
            let _ = write!(out, r#" id="{id}"><mxCell"#);
            Some(tag)
        }
        None => {
            let _ = write!(out, r#"<mxCell id="{id}""#);
            if !cell.label.is_empty() {
                let _ = write!(out, r#" value="{}""#, escape(&cell.label));
            }
            None
        }
    };
    let style = cell.style.to_string();
    if !style.is_empty() {
        let _ = write!(out, r#" style="{}""#, escape(&style));
    }
    match &cell.kind {
        CellKind::Layer => out.push_str(r#" parent="0""#),
        CellKind::Vertex(v) => {
            out.push_str(r#" vertex="1""#);
            if !v.connectable {
                out.push_str(r#" connectable="0""#);
            }
        }
        CellKind::Edge(_) => out.push_str(r#" edge="1""#),
    }
    if !cell.visible {
        out.push_str(r#" visible="0""#);
    }
    if cell.collapsed {
        out.push_str(r#" collapsed="1""#);
    }
    if let Some(parent) = cell.parent() {
        let _ = write!(out, r#" parent="{}""#, escape(parent.as_str()));
    }
    if let CellKind::Edge(e) = &cell.kind {
        for (key, terminal) in [("source", &e.source), ("target", &e.target)] {
            if let Some(t) = terminal {
                let _ = write!(out, r#" {key}="{}""#, escape(t.as_str()));
            }
        }
    }
    match &cell.kind {
        CellKind::Layer => out.push_str("/>"),
        CellKind::Vertex(v) => {
            out.push('>');
            write_vertex_geometry(out, v);
            out.push_str("</mxCell>");
        }
        CellKind::Edge(e) => {
            out.push('>');
            write_edge_geometry(out, &e.geometry);
            out.push_str("</mxCell>");
        }
    }
    if let Some(tag) = tag {
        let _ = write!(out, "</{tag}>");
    }
}

fn xy(out: &mut String, p: Point) {
    if p.x != 0.0 {
        let _ = write!(out, r#" x="{}""#, num(p.x));
    }
    if p.y != 0.0 {
        let _ = write!(out, r#" y="{}""#, num(p.y));
    }
}

fn mx_point(out: &mut String, p: Point, role: Option<&str>) {
    out.push_str("<mxPoint");
    xy(out, p);
    if let Some(role) = role {
        let _ = write!(out, r#" as="{role}""#);
    }
    out.push_str("/>");
}

fn write_vertex_geometry(out: &mut String, v: &Vertex) {
    let (origin, size, relative, offset) = match &v.geometry {
        VertexGeometry::Bounds(r) => (r.origin(), r.size(), false, None),
        VertexGeometry::Relative {
            anchor,
            offset,
            size,
        } => (
            *anchor,
            *size,
            true,
            Some(*offset).filter(|o| *o != Point::default()),
        ),
    };
    out.push_str("<mxGeometry");
    xy(out, origin);
    let _ = write!(
        out,
        r#" width="{}" height="{}""#,
        num(size.width),
        num(size.height)
    );
    if relative {
        out.push_str(r#" relative="1""#);
    }
    out.push_str(r#" as="geometry""#);
    if offset.is_none() && v.alternate_bounds.is_none() {
        out.push_str("/>");
        return;
    }
    out.push('>');
    if let Some(offset) = offset {
        mx_point(out, offset, Some("offset"));
    }
    if let Some(r) = v.alternate_bounds {
        out.push_str("<mxRectangle");
        xy(out, r.origin());
        let _ = write!(
            out,
            r#" width="{}" height="{}" as="alternateBounds"/>"#,
            num(r.width),
            num(r.height)
        );
    }
    out.push_str("</mxGeometry>");
}

fn write_edge_geometry(out: &mut String, g: &EdgeGeometry) {
    out.push_str("<mxGeometry");
    xy(out, g.label_position);
    if g.relative {
        out.push_str(r#" relative="1""#);
    }
    out.push_str(r#" as="geometry">"#);
    if let Some(p) = g.source_point {
        mx_point(out, p, Some("sourcePoint"));
    }
    if let Some(p) = g.target_point {
        mx_point(out, p, Some("targetPoint"));
    }
    if !g.points.is_empty() {
        out.push_str(r#"<Array as="points">"#);
        for p in &g.points {
            mx_point(out, *p, None);
        }
        out.push_str("</Array>");
    }
    if g.label_offset != Point::default() {
        mx_point(out, g.label_offset, Some("offset"));
    }
    out.push_str("</mxGeometry>");
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r##"<mxfile host="app.diagrams.net"><diagram id="p1" name="Enrollment flow"><mxGraphModel dx="1200" dy="800" grid="1" gridSize="20" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" background="#ffffff" math="0" shadow="0" adaptiveColors="auto"><root>
  <mxCell id="0"/>
  <mxCell id="1" value="Services" parent="0"/>
  <mxCell id="box" value="Enrollment backend" style="swimlane;startSize=28;" vertex="1" collapsed="1" parent="1">
    <mxGeometry x="450" y="20" width="390" height="28" as="geometry"><mxRectangle x="450" y="20" width="390" height="520" as="alternateBounds"/></mxGeometry>
  </mxCell>
  <UserObject label="Waitlist&#xa;queue" owner="Annie Edison" placeholders="1" id="queue">
    <mxCell style="shape=cylinder3;direction=south;fillColor=light-dark(#E9E2F2,#312B41);" vertex="1" parent="box">
      <mxGeometry x="20" y="300" width="150" height="60" as="geometry"/>
    </mxCell>
  </UserObject>
  <mxCell id="hidden" value="Troy &amp; Abed" vertex="1" visible="0" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell>
  <mxCell id="e1" value="" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="queue" target="hidden">
    <mxGeometry x="-0.25" relative="1" as="geometry"><Array as="points"><mxPoint x="300" y="200"/><mxPoint x="300" y="40"/></Array><mxPoint x="2" y="-4" as="offset"/></mxGeometry>
  </mxCell>
  <mxCell id="e1-label" value="seat freed" style="edgeLabel;" vertex="1" connectable="0" parent="e1">
    <mxGeometry x="0.5" y="1" relative="1" as="geometry"><mxPoint x="3" y="5" as="offset"/></mxGeometry>
  </mxCell>
  <mxCell id="loose" edge="1" parent="1" source="gone">
    <mxGeometry relative="1" as="geometry"><mxPoint x="10" y="10" as="sourcePoint"/><mxPoint x="90" y="10" as="targetPoint"/></mxGeometry>
  </mxCell>
</root></mxGraphModel></diagram><diagram id="p2" name="Data model"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>"##;

    fn id(s: &str) -> CellId {
        CellId::new(s)
    }

    #[test]
    fn read_understands_every_part_of_a_page() {
        let doc = read(SAMPLE).expect("read sample");
        assert_eq!(doc.pages().len(), 2);
        let page = &doc.pages()[0];
        assert_eq!(
            (page.id.as_str(), page.name.as_str()),
            ("p1", "Enrollment flow")
        );
        assert_eq!(page.settings.grid_size, 20.0);
        assert_eq!(page.settings.page_size, Size::new(1169.0, 827.0));
        assert_eq!(page.settings.background.as_deref(), Some("#ffffff"));
        assert!(
            page.settings
                .extra
                .contains(&("adaptiveColors".into(), "auto".into()))
        );

        let m = &page.model;
        assert_eq!(m.layers(), [id("1")]);
        assert_eq!(m.cell(&id("1")).map(|c| c.label.as_str()), Some("Services"));

        let backend = m.cell(&id("box")).expect("container");
        assert!(backend.collapsed);
        let CellKind::Vertex(v) = &backend.kind else {
            panic!("container is not a vertex")
        };
        assert_eq!(
            v.alternate_bounds,
            Some(Rect::new(450.0, 20.0, 390.0, 520.0))
        );

        let queue = m.cell(&id("queue")).expect("user object");
        assert_eq!(queue.label, "Waitlist\nqueue");
        let object = queue.object.as_ref().expect("custom data");
        assert_eq!(object.tag, ObjectTag::UserObject);
        assert_eq!(
            object.attributes,
            [
                ("owner".into(), "Annie Edison".into()),
                ("placeholders".into(), "1".into())
            ]
        );
        assert_eq!(queue.parent(), Some(&id("box")));
        assert_eq!(
            queue.style.get("fillColor"),
            Some("light-dark(#E9E2F2,#312B41)")
        );

        let hidden = m.cell(&id("hidden")).expect("hidden cell");
        assert!(!hidden.visible);
        assert_eq!(hidden.label, "Troy & Abed");

        let CellKind::Edge(e) = &m.cell(&id("e1")).expect("edge").kind else {
            panic!("e1 is not an edge")
        };
        assert_eq!(
            e.geometry.points,
            [Point::new(300.0, 200.0), Point::new(300.0, 40.0)]
        );
        assert_eq!(e.geometry.label_position, Point::new(-0.25, 0.0));
        assert_eq!(e.geometry.label_offset, Point::new(2.0, -4.0));

        let label = m.cell(&id("e1-label")).expect("edge label");
        let CellKind::Vertex(v) = &label.kind else {
            panic!("edge label is not a vertex")
        };
        assert!(!v.connectable);
        assert_eq!(
            v.geometry,
            VertexGeometry::Relative {
                anchor: Point::new(0.5, 1.0),
                offset: Point::new(3.0, 5.0),
                size: Size::default()
            }
        );

        let CellKind::Edge(loose) = &m.cell(&id("loose")).expect("loose edge").kind else {
            panic!("not an edge")
        };
        assert_eq!(
            loose.source, None,
            "a terminal that does not exist is dropped"
        );
        assert_eq!(loose.geometry.source_point, Some(Point::new(10.0, 10.0)));
    }

    #[test]
    fn write_then_read_returns_the_same_document() {
        let doc = read(SAMPLE).expect("read sample");
        let again = read(&write(&doc)).expect("read written file");
        assert_eq!(again, doc);
    }

    #[test]
    fn compressed_pages_read_like_plain_ones() {
        let plain = read(SAMPLE).expect("read sample");
        let page = &plain.pages()[0];
        let packed = format!(
            r#"<mxfile><diagram id="p1" name="Enrollment flow">{}</diagram></mxfile>"#,
            compress(&model_xml(&page.settings, &page.model))
        );
        let unpacked = read(&packed).expect("read compressed");
        assert_eq!(unpacked.pages()[0], *page);
    }

    #[test]
    fn compress_round_trips_any_text() {
        let tests = ["", "<b>Greendale</b>", "Café ✓ 100% & more", "line\nbreak"];
        for text in tests {
            assert_eq!(decompress(&compress(text)).as_deref(), Ok(text), "{text:?}");
        }
    }

    #[test]
    fn read_accepts_a_bare_graph_model() {
        let doc = read(r#"<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" vertex="1" parent="1"><mxGeometry width="10" height="10" as="geometry"/></mxCell></root></mxGraphModel>"#)
            .expect("read bare model");
        assert_eq!(doc.pages().len(), 1);
        assert_eq!(
            doc.pages()[0].model.bounds(&id("2")),
            Some(Rect::new(0.0, 0.0, 10.0, 10.0))
        );
    }

    #[test]
    fn read_reports_what_is_wrong() {
        let tests = [
            ("not XML", "<mxfile><diagram>", "not valid XML"),
            ("wrong root", "<svg/>", "<svg>"),
            ("no pages", "<mxfile/>", "no pages"),
            (
                "bad compression",
                r#"<mxfile><diagram name="P">not-base64!</diagram></mxfile>"#,
                "could not be decompressed",
            ),
            (
                "orphan cell",
                r#"<mxfile><diagram name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="2" vertex="1" parent="nope"/></root></mxGraphModel></diagram></mxfile>"#,
                "damaged",
            ),
        ];
        for (name, text, want) in tests {
            let err = read(text).expect_err(name).to_string();
            assert!(err.contains(want), "{name}: {err}");
        }
    }

    #[test]
    fn escape_keeps_line_breaks() {
        assert_eq!(
            escape("a\n\"b\" & <c>"),
            "a&#xa;&quot;b&quot; &amp; &lt;c&gt;"
        );
    }
}
