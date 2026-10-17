//! The diagram model behind Setsquare, a diagram editor with draw.io feature parity.
//!
//! This crate has no user interface and no platform code. It owns the cell tree of each
//! page, draw.io styles, geometry, the built-in shapes, undoable edits, and the draw.io
//! file format.

pub mod change;
pub mod drawio;
pub mod edge_shape;
pub mod geometry;
pub mod model;
mod routing;
pub mod shape;
pub mod style;
pub mod stylesheet;

pub use change::{Applied, Change, History};
pub use edge_shape::{EdgeShape, MarkerGeometry, MarkerPaint, edge_shape};
pub use geometry::{Guide, Point, Rect, Size, Snap};
pub use model::{
    Cell, CellId, CellKind, Document, Edge, EdgeGeometry, Model, ModelError, Page, PageSettings,
    Vertex, VertexGeometry,
};
pub use shape::Shape;
pub use style::Style;
pub use stylesheet::Stylesheet;
