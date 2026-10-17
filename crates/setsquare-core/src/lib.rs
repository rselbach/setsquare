//! The diagram model behind Setsquare, a diagram editor with draw.io feature parity.
//!
//! This crate has no user interface and no platform code. It owns the cell tree of each
//! page, draw.io styles, geometry, the built-in shapes, and undoable edits.

pub mod change;
pub mod geometry;
pub mod model;
pub mod shape;
pub mod style;

pub use change::{Applied, Change, History};
pub use geometry::{Guide, Point, Rect, Size, Snap};
pub use model::{
    Cell, CellId, CellKind, Document, Edge, EdgeGeometry, Model, ModelError, Page, PageSettings,
    Vertex, VertexGeometry,
};
pub use shape::Shape;
pub use style::Style;
