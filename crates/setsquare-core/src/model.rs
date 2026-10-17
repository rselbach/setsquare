//! The cell tree behind one page, following draw.io's `mxGraphModel`.
//!
//! The root is implicit. Its children are layers, and layers hold vertices and edges.
//! Vertices and edges can hold children of their own: containers and groups hold
//! shapes, and edges hold their label cells.

use std::collections::{HashMap, HashSet};
use std::fmt;
use std::sync::Arc;

use crate::geometry::{Point, Rect, Size, route_orthogonal};
use crate::style::Style;

/// The identifier of a cell, unique within its page.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct CellId(Arc<str>);

impl CellId {
    /// Creates an identifier.
    pub fn new(id: impl AsRef<str>) -> Self {
        CellId(Arc::from(id.as_ref()))
    }

    /// Returns the identifier as text.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for CellId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// Where a vertex sits relative to its parent.
#[derive(Clone, Debug, PartialEq)]
pub enum VertexGeometry {
    /// Bounds in the parent's space: relative to the parent's top-left corner when the
    /// parent is a vertex, or to the page origin when the parent is a layer.
    Bounds(Rect),
    /// A position that follows the parent. For a vertex parent, `anchor` is a fraction of
    /// its size. For an edge parent, `anchor.x` runs from -1 at the source end to 1 at
    /// the target end. `offset` is in diagram units.
    Relative {
        anchor: Point,
        offset: Point,
        size: Size,
    },
}

/// A shape, text, container, or group.
#[derive(Clone, Debug, PartialEq)]
pub struct Vertex {
    pub parent: CellId,
    pub geometry: VertexGeometry,
    pub connectable: bool,
}

/// The waypoints and label placement of an edge. Points are in the parent's space.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct EdgeGeometry {
    pub points: Vec<Point>,
    /// The loose end used when the edge has no source cell.
    pub source_point: Option<Point>,
    /// The loose end used when the edge has no target cell.
    pub target_point: Option<Point>,
    /// The label position: `x` runs from -1 at the source to 1 at the target.
    pub label_position: Point,
    pub label_offset: Point,
}

/// A connector between two cells or loose points.
#[derive(Clone, Debug, PartialEq)]
pub struct Edge {
    pub parent: CellId,
    pub source: Option<CellId>,
    pub target: Option<CellId>,
    pub geometry: EdgeGeometry,
}

/// What a cell is. Layers are children of the implicit root, so they have no parent.
#[derive(Clone, Debug, PartialEq)]
pub enum CellKind {
    Layer,
    Vertex(Vertex),
    Edge(Edge),
}

/// The XML element that wraps a cell carrying custom data.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ObjectTag {
    UserObject,
    Object,
}

/// Custom data on a cell: the properties used by placeholders, links, and tooltips.
#[derive(Clone, Debug, PartialEq)]
pub struct UserObject {
    pub tag: ObjectTag,
    pub attributes: Vec<(String, String)>,
}

/// One node of the tree.
#[derive(Clone, Debug, PartialEq)]
pub struct Cell {
    pub id: CellId,
    pub kind: CellKind,
    /// The label, which is HTML when the style sets `html=1`.
    pub label: String,
    pub style: Style,
    pub visible: bool,
    pub collapsed: bool,
    pub object: Option<UserObject>,
}

impl Cell {
    fn with_kind(id: CellId, kind: CellKind) -> Cell {
        Cell {
            id,
            kind,
            label: String::new(),
            style: Style::default(),
            visible: true,
            collapsed: false,
            object: None,
        }
    }

    /// Creates a layer.
    pub fn layer(id: CellId) -> Cell {
        Cell::with_kind(id, CellKind::Layer)
    }

    /// Creates a connectable vertex with `bounds` in its parent's space.
    pub fn vertex(id: CellId, parent: CellId, bounds: Rect) -> Cell {
        Cell::with_kind(
            id,
            CellKind::Vertex(Vertex {
                parent,
                geometry: VertexGeometry::Bounds(bounds),
                connectable: true,
            }),
        )
    }

    /// Creates an edge between two cells.
    pub fn edge(id: CellId, parent: CellId, source: CellId, target: CellId) -> Cell {
        Cell::with_kind(
            id,
            CellKind::Edge(Edge {
                parent,
                source: Some(source),
                target: Some(target),
                geometry: EdgeGeometry::default(),
            }),
        )
    }

    /// Returns the cell with `label` set.
    pub fn with_label(mut self, label: impl Into<String>) -> Cell {
        self.label = label.into();
        self
    }

    /// Returns the cell with `style` parsed and set.
    pub fn with_style(mut self, style: &str) -> Cell {
        self.style = Style::parse(style);
        self
    }

    /// Returns the parent, or `None` for a layer.
    pub fn parent(&self) -> Option<&CellId> {
        match &self.kind {
            CellKind::Layer => None,
            CellKind::Vertex(v) => Some(&v.parent),
            CellKind::Edge(e) => Some(&e.parent),
        }
    }
}

/// An error from a change that the model refused. The model is unchanged.
#[derive(Clone, Debug, PartialEq)]
pub enum ModelError {
    UnknownCell(CellId),
    DuplicateId(CellId),
    /// The cell cannot live under this parent, such as a vertex placed directly in the root.
    InvalidParent {
        cell: CellId,
        parent: Option<CellId>,
    },
    /// The change only applies to vertices with bounds.
    NotBounded(CellId),
}

impl fmt::Display for ModelError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ModelError::UnknownCell(id) => write!(f, "no cell with id {id}"),
            ModelError::DuplicateId(id) => write!(f, "a cell with id {id} already exists"),
            ModelError::InvalidParent {
                cell,
                parent: Some(p),
            } => write!(f, "cell {cell} cannot be a child of {p}"),
            ModelError::InvalidParent { cell, parent: None } => {
                write!(f, "cell {cell} must have a parent")
            }
            ModelError::NotBounded(id) => write!(f, "cell {id} is not a vertex with bounds"),
        }
    }
}

impl std::error::Error for ModelError {}

/// The cells of one page and their order.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Model {
    cells: HashMap<CellId, Cell>,
    layers: Vec<CellId>,
    children: HashMap<CellId, Vec<CellId>>,
    next_id: u64,
}

impl Model {
    /// Creates a model with one empty layer, as draw.io does for a new page.
    pub fn new() -> Model {
        let mut m = Model::default();
        let id = CellId::new("1");
        m.layers.push(id.clone());
        m.cells.insert(id.clone(), Cell::layer(id));
        m
    }

    /// Returns the cell with `id`.
    pub fn cell(&self, id: &CellId) -> Option<&Cell> {
        self.cells.get(id)
    }

    /// Returns the number of cells, including layers.
    pub fn len(&self) -> usize {
        self.cells.len()
    }

    /// Reports whether the model has no cells.
    pub fn is_empty(&self) -> bool {
        self.cells.is_empty()
    }

    /// Returns the layers from back to front.
    pub fn layers(&self) -> &[CellId] {
        &self.layers
    }

    /// Returns the children of `id` from back to front.
    pub fn children(&self, id: &CellId) -> &[CellId] {
        self.children.get(id).map_or(&[], Vec::as_slice)
    }

    /// Returns an identifier that no cell uses yet.
    pub fn new_id(&mut self) -> CellId {
        loop {
            self.next_id += 1;
            let id = CellId::new(format!("ss-{}", self.next_id));
            if !self.cells.contains_key(&id) {
                return id;
            }
        }
    }

    /// Returns every cell from back to front, each parent before its children.
    pub fn paint_order(&self) -> Vec<&Cell> {
        let mut out = Vec::with_capacity(self.cells.len());
        let mut stack: Vec<&CellId> = self.layers.iter().rev().collect();
        while let Some(id) = stack.pop() {
            if let Some(cell) = self.cells.get(id) {
                out.push(cell);
                stack.extend(self.children(id).iter().rev());
            }
        }
        out
    }

    /// Returns the position of `id` among its siblings.
    fn index_of(&self, id: &CellId) -> Option<usize> {
        let cell = self.cells.get(id)?;
        let siblings = match cell.parent() {
            None => &self.layers,
            Some(p) => self.children.get(p)?,
        };
        siblings.iter().position(|c| c == id)
    }

    /// Returns the bounds of a vertex in page coordinates.
    pub fn bounds(&self, id: &CellId) -> Option<Rect> {
        let CellKind::Vertex(v) = &self.cells.get(id)?.kind else {
            return None;
        };
        let parent = self.cells.get(&v.parent)?;
        match (&v.geometry, &parent.kind) {
            (VertexGeometry::Bounds(r), CellKind::Layer) => Some(*r),
            (VertexGeometry::Bounds(r), CellKind::Vertex(_)) => {
                Some(r.translate(self.bounds(&v.parent)?.origin()))
            }
            (VertexGeometry::Bounds(r), CellKind::Edge(_)) => {
                let at = self.point_along(&v.parent, 0.0)?;
                Some(r.translate(at))
            }
            (
                VertexGeometry::Relative {
                    anchor,
                    offset,
                    size,
                },
                CellKind::Vertex(_),
            ) => {
                let p = self.bounds(&v.parent)?;
                let x = p.x + anchor.x * p.width + offset.x;
                let y = p.y + anchor.y * p.height + offset.y;
                Some(Rect::new(
                    x - size.width / 2.0,
                    y - size.height / 2.0,
                    size.width,
                    size.height,
                ))
            }
            (
                VertexGeometry::Relative {
                    anchor,
                    offset,
                    size,
                },
                CellKind::Edge(_),
            ) => {
                let at = self.point_along(&v.parent, anchor.x)? + *offset;
                Some(Rect::new(
                    at.x - size.width / 2.0,
                    at.y - size.height / 2.0,
                    size.width,
                    size.height,
                ))
            }
            (_, CellKind::Layer) => None,
        }
    }

    /// Returns the origin of the space that `parent`'s children use, in page coordinates.
    fn origin_of(&self, parent: &CellId) -> Point {
        self.bounds(parent).map_or(Point::default(), |r| r.origin())
    }

    /// Returns the route of an edge in page coordinates, from source to target.
    pub fn route(&self, id: &CellId) -> Option<Vec<Point>> {
        let CellKind::Edge(e) = &self.cells.get(id)?.kind else {
            return None;
        };
        let origin = self.origin_of(&e.parent);
        let end =
            |terminal: &Option<CellId>, loose: Option<Point>| -> Option<Result<Rect, Point>> {
                match terminal {
                    Some(t) => self.bounds(t).map(Ok),
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

    /// Returns the point at `t` along an edge, where -1 is the source end and 1 is the target end.
    pub fn point_along(&self, edge: &CellId, t: f64) -> Option<Point> {
        let route = self.route(edge)?;
        let lengths: Vec<f64> = route
            .windows(2)
            .map(|w| (w[1].x - w[0].x).hypot(w[1].y - w[0].y))
            .collect();
        let total: f64 = lengths.iter().sum();
        let mut remaining = total * (t.clamp(-1.0, 1.0) + 1.0) / 2.0;
        for (segment, len) in route.windows(2).zip(&lengths) {
            if remaining <= *len && *len > 0.0 {
                let k = remaining / len;
                return Some(Point::new(
                    segment[0].x + (segment[1].x - segment[0].x) * k,
                    segment[0].y + (segment[1].y - segment[0].y) * k,
                ));
            }
            remaining -= len;
        }
        route.last().copied()
    }

    /// Returns `ids` and all their descendants.
    pub fn with_descendants(&self, ids: &[CellId]) -> Vec<CellId> {
        let mut out = Vec::new();
        let mut stack: Vec<CellId> = ids.iter().rev().cloned().collect();
        while let Some(id) = stack.pop() {
            stack.extend(self.children(&id).iter().rev().cloned());
            out.push(id);
        }
        out
    }

    /// Returns the edges that connect to any of `ids`.
    pub(crate) fn edges_touching(&self, ids: &HashSet<&CellId>) -> Vec<CellId> {
        let mut edges: Vec<CellId> = self
            .cells
            .values()
            .filter(|c| match &c.kind {
                CellKind::Edge(e) => [&e.source, &e.target]
                    .into_iter()
                    .flatten()
                    .any(|t| ids.contains(t)),
                _ => false,
            })
            .map(|c| c.id.clone())
            .collect();
        edges.sort();
        edges
    }

    /// Returns every cell whose drawing depends on `ids`: the cells, their descendants,
    /// the edges connected to any of them, and those edges' labels.
    pub fn affected(&self, ids: &[CellId]) -> Vec<CellId> {
        let mut out = self.with_descendants(ids);
        let set: HashSet<&CellId> = out.iter().collect();
        let edges = self.edges_touching(&set);
        let mut seen: HashSet<CellId> = out.iter().cloned().collect();
        for id in self.with_descendants(&edges) {
            if seen.insert(id.clone()) {
                out.push(id);
            }
        }
        out
    }

    /// Checks that `cell` may live under its parent, given the cells that will exist.
    pub(crate) fn check_parent(
        &self,
        cell: &Cell,
        pending: &HashMap<&CellId, &Cell>,
    ) -> Result<(), ModelError> {
        let lookup = |id: &CellId| pending.get(id).copied().or_else(|| self.cells.get(id));
        let Some(parent) = cell.parent() else {
            return Ok(());
        };
        match lookup(parent) {
            Some(_) => Ok(()),
            None => Err(ModelError::InvalidParent {
                cell: cell.id.clone(),
                parent: Some(parent.clone()),
            }),
        }
    }

    pub(crate) fn insert_at(&mut self, cell: Cell, index: usize) {
        let id = cell.id.clone();
        let siblings = match cell.parent() {
            None => &mut self.layers,
            Some(p) => self.children.entry(p.clone()).or_default(),
        };
        siblings.insert(index.min(siblings.len()), id.clone());
        self.cells.insert(id, cell);
    }

    /// Removes one cell, which must have no children left. Returns it with its index.
    pub(crate) fn detach(&mut self, id: &CellId) -> Option<(Cell, usize)> {
        let index = self.index_of(id)?;
        let cell = self.cells.remove(id)?;
        match cell.parent() {
            None => {
                self.layers.remove(index);
            }
            Some(p) => {
                if let Some(siblings) = self.children.get_mut(p) {
                    siblings.remove(index);
                }
            }
        }
        self.children.remove(id);
        Some((cell, index))
    }

    pub(crate) fn cell_mut(&mut self, id: &CellId) -> Result<&mut Cell, ModelError> {
        self.cells
            .get_mut(id)
            .ok_or_else(|| ModelError::UnknownCell(id.clone()))
    }

    pub(crate) fn contains(&self, id: &CellId) -> bool {
        self.cells.contains_key(id)
    }

    /// Returns the depth of a cell below the root: 0 for layers.
    pub(crate) fn depth(&self, id: &CellId) -> usize {
        let mut depth = 0;
        let mut current = self.cells.get(id).and_then(Cell::parent);
        while let Some(p) = current {
            depth += 1;
            current = self.cells.get(p).and_then(Cell::parent);
        }
        depth
    }

    pub(crate) fn sibling_index(&self, id: &CellId) -> usize {
        self.index_of(id).unwrap_or(0)
    }
}

/// Page settings stored on draw.io's `mxGraphModel` element.
#[derive(Clone, Debug, PartialEq)]
pub struct PageSettings {
    pub grid: bool,
    pub grid_size: f64,
    pub guides: bool,
    pub tooltips: bool,
    pub connect: bool,
    pub arrows: bool,
    pub fold: bool,
    pub page_view: bool,
    pub page_scale: f64,
    pub page_size: Size,
    /// The background color, or `None` for the default.
    pub background: Option<String>,
    pub math: bool,
    pub shadow: bool,
}

impl Default for PageSettings {
    /// Returns draw.io's defaults for a new page: A4 portrait with a 10 pt grid.
    fn default() -> Self {
        PageSettings {
            grid: true,
            grid_size: 10.0,
            guides: true,
            tooltips: true,
            connect: true,
            arrows: true,
            fold: true,
            page_view: true,
            page_scale: 1.0,
            page_size: Size::new(827.0, 1169.0),
            background: None,
            math: false,
            shadow: false,
        }
    }
}

/// One page of a drawing: draw.io's `diagram` element.
#[derive(Clone, Debug, PartialEq)]
pub struct Page {
    pub id: String,
    pub name: String,
    pub settings: PageSettings,
    pub model: Model,
}

/// A drawing with one or more pages.
#[derive(Clone, Debug, PartialEq)]
pub struct Document {
    pages: Vec<Page>,
}

impl Document {
    /// Creates a document whose only page is `first`.
    pub fn new(first: Page) -> Document {
        Document { pages: vec![first] }
    }

    /// Returns the pages in order.
    pub fn pages(&self) -> &[Page] {
        &self.pages
    }

    /// Returns the page at `index` for editing.
    pub fn page_mut(&mut self, index: usize) -> Option<&mut Page> {
        self.pages.get_mut(index)
    }

    /// Appends a page.
    pub fn push_page(&mut self, page: Page) {
        self.pages.push(page);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::change::Change;

    fn sample() -> Model {
        let mut m = Model::new();
        let layer = CellId::new("1");
        let cells = vec![
            Cell::vertex(
                CellId::new("box"),
                layer.clone(),
                Rect::new(100.0, 100.0, 200.0, 100.0),
            )
            .with_style("swimlane;"),
            Cell::vertex(
                CellId::new("inner"),
                CellId::new("box"),
                Rect::new(10.0, 30.0, 50.0, 20.0),
            ),
            Cell::vertex(
                CellId::new("far"),
                layer.clone(),
                Rect::new(500.0, 115.0, 60.0, 40.0),
            ),
            Cell::edge(
                CellId::new("e"),
                layer,
                CellId::new("inner"),
                CellId::new("far"),
            ),
        ];
        m.apply(Change::Insert {
            cells: cells.into_iter().map(|c| (c, usize::MAX)).collect(),
        })
        .expect("insert sample");
        m
    }

    #[test]
    fn bounds_are_in_page_coordinates() {
        let m = sample();
        assert_eq!(
            m.bounds(&CellId::new("box")),
            Some(Rect::new(100.0, 100.0, 200.0, 100.0))
        );
        assert_eq!(
            m.bounds(&CellId::new("inner")),
            Some(Rect::new(110.0, 130.0, 50.0, 20.0))
        );
        assert_eq!(m.bounds(&CellId::new("e")), None);
    }

    #[test]
    fn route_connects_facing_sides() {
        let m = sample();
        let route = m.route(&CellId::new("e")).expect("route");
        assert_eq!(route.first(), Some(&Point::new(160.0, 140.0)));
        assert_eq!(route.last(), Some(&Point::new(500.0, 135.0)));
    }

    #[test]
    fn paint_order_puts_parents_first() {
        let m = sample();
        let ids: Vec<&str> = m.paint_order().iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, ["1", "box", "inner", "far", "e"]);
    }

    #[test]
    fn affected_includes_descendants_and_connected_edges() {
        let m = sample();
        let mut got: Vec<String> = m
            .affected(&[CellId::new("box")])
            .iter()
            .map(ToString::to_string)
            .collect();
        got.sort();
        assert_eq!(got, ["box", "e", "inner"]);
    }

    #[test]
    fn new_id_skips_existing_ids() {
        let mut m = Model::new();
        m.apply(Change::Insert {
            cells: vec![(
                Cell::vertex(CellId::new("ss-1"), CellId::new("1"), Rect::default()),
                0,
            )],
        })
        .expect("insert");
        assert_eq!(m.new_id(), CellId::new("ss-2"));
    }
}
