//! Edits to a [`Model`], each of which produces its own inverse for undo.

use std::collections::{HashMap, HashSet};

use crate::geometry::{Point, Rect};
use crate::model::{Cell, CellId, CellKind, Model, ModelError, VertexGeometry};
use crate::style::Style;

/// One edit. Applying a change returns the change that reverses it.
#[derive(Clone, Debug, PartialEq)]
pub enum Change {
    /// Inserts cells at sibling positions. Parents come before their children, and an
    /// index past the end appends.
    Insert {
        cells: Vec<(Cell, usize)>,
    },
    /// Removes cells with their descendants and every edge connected to them.
    Remove {
        cells: Vec<CellId>,
    },
    /// Moves cells. A cell whose ancestor is also listed moves with the ancestor only.
    Translate {
        cells: Vec<CellId>,
        by: Point,
    },
    /// Sets the bounds of a vertex in its parent's space.
    SetBounds {
        cell: CellId,
        bounds: Rect,
    },
    SetLabel {
        cell: CellId,
        label: String,
    },
    SetStyle {
        cell: CellId,
        style: Style,
    },
    /// Applies changes in order, all or nothing.
    Batch(Vec<Change>),
}

/// The outcome of a change the model accepted.
#[derive(Clone, Debug, PartialEq)]
pub struct Applied {
    /// The change that undoes this one.
    pub inverse: Change,
    /// Every cell whose drawing changed, including removed cells.
    pub touched: Vec<CellId>,
    /// Whether cells were added or removed, which changes the set of cells to draw.
    pub structural: bool,
}

impl Model {
    /// Applies `change`. On error the model is left as it was.
    pub fn apply(&mut self, change: Change) -> Result<Applied, ModelError> {
        match change {
            Change::Insert { cells } => self.insert(cells),
            Change::Remove { cells } => self.remove(&cells),
            Change::Translate { cells, by } => self.translate(&cells, by),
            Change::SetBounds { cell, bounds } => {
                let VertexGeometry::Bounds(old) = self.bounded_mut(&cell)? else {
                    return Err(ModelError::NotBounded(cell));
                };
                let previous = std::mem::replace(old, bounds);
                Ok(Applied {
                    touched: self.affected(std::slice::from_ref(&cell)),
                    inverse: Change::SetBounds {
                        cell,
                        bounds: previous,
                    },
                    structural: false,
                })
            }
            Change::SetLabel { cell, label } => {
                let previous = std::mem::replace(&mut self.cell_mut(&cell)?.label, label);
                Ok(Applied {
                    touched: vec![cell.clone()],
                    inverse: Change::SetLabel {
                        cell,
                        label: previous,
                    },
                    structural: false,
                })
            }
            Change::SetStyle { cell, style } => {
                let previous = std::mem::replace(&mut self.cell_mut(&cell)?.style, style);
                Ok(Applied {
                    touched: vec![cell.clone()],
                    inverse: Change::SetStyle {
                        cell,
                        style: previous,
                    },
                    structural: false,
                })
            }
            Change::Batch(changes) => self.batch(changes),
        }
    }

    fn bounded_mut(&mut self, id: &CellId) -> Result<&mut VertexGeometry, ModelError> {
        match &mut self.cell_mut(id)?.kind {
            CellKind::Vertex(v) => Ok(&mut v.geometry),
            _ => Err(ModelError::NotBounded(id.clone())),
        }
    }

    fn insert(&mut self, cells: Vec<(Cell, usize)>) -> Result<Applied, ModelError> {
        let mut pending: HashMap<&CellId, &Cell> = HashMap::new();
        for (cell, _) in &cells {
            if self.contains(&cell.id) || pending.insert(&cell.id, cell).is_some() {
                return Err(ModelError::DuplicateId(cell.id.clone()));
            }
        }
        for (cell, _) in &cells {
            self.check_parent(cell, &pending)?;
            if let CellKind::Edge(e) = &cell.kind {
                for t in [&e.source, &e.target].into_iter().flatten() {
                    if !self.contains(t) && !pending.contains_key(t) {
                        return Err(ModelError::UnknownCell(t.clone()));
                    }
                }
            }
        }
        let ids: Vec<CellId> = cells.iter().map(|(c, _)| c.id.clone()).collect();
        for (cell, index) in cells {
            self.insert_at(cell, index);
        }
        Ok(Applied {
            inverse: Change::Remove { cells: ids.clone() },
            touched: ids,
            structural: true,
        })
    }

    fn remove(&mut self, ids: &[CellId]) -> Result<Applied, ModelError> {
        if let Some(missing) = ids.iter().find(|id| !self.contains(id)) {
            return Err(ModelError::UnknownCell(missing.clone()));
        }
        // Record positions before detaching anything, then detach the deepest cells first.
        // Restoring parents first and siblings in ascending order rebuilds the same tree.
        let mut doomed: Vec<(usize, usize, CellId)> = self
            .affected(ids)
            .into_iter()
            .map(|id| (self.depth(&id), self.sibling_index(&id), id))
            .collect();
        doomed.sort_by_key(|d| std::cmp::Reverse((d.0, d.1)));
        let mut restored: Vec<(usize, Cell, usize)> = Vec::with_capacity(doomed.len());
        for (depth, index, id) in &doomed {
            if let Some((cell, _)) = self.detach(id) {
                restored.push((*depth, cell, *index));
            }
        }
        restored.sort_by_key(|r| (r.0, r.2));
        let touched = doomed.into_iter().map(|(_, _, id)| id).collect();
        let cells = restored
            .into_iter()
            .map(|(_, cell, index)| (cell, index))
            .collect();
        Ok(Applied {
            inverse: Change::Insert { cells },
            touched,
            structural: true,
        })
    }

    fn translate(&mut self, ids: &[CellId], by: Point) -> Result<Applied, ModelError> {
        if let Some(missing) = ids.iter().find(|id| !self.contains(id)) {
            return Err(ModelError::UnknownCell(missing.clone()));
        }
        let listed: HashSet<&CellId> = ids.iter().collect();
        let has_listed_ancestor = |id: &CellId| {
            let mut current = self.cell(id).and_then(Cell::parent);
            while let Some(p) = current {
                if listed.contains(p) {
                    return true;
                }
                current = self.cell(p).and_then(Cell::parent);
            }
            false
        };
        let movers: Vec<CellId> = ids
            .iter()
            .filter(|id| !has_listed_ancestor(id))
            .cloned()
            .collect();
        for id in &movers {
            match &mut self.cell_mut(id)?.kind {
                CellKind::Layer => {}
                CellKind::Vertex(v) => match &mut v.geometry {
                    VertexGeometry::Bounds(r) => *r = r.translate(by),
                    VertexGeometry::Relative { offset, .. } => *offset = *offset + by,
                },
                CellKind::Edge(e) => {
                    let g = &mut e.geometry;
                    for p in g
                        .points
                        .iter_mut()
                        .chain(g.source_point.as_mut())
                        .chain(g.target_point.as_mut())
                    {
                        *p = *p + by;
                    }
                }
            }
        }
        Ok(Applied {
            touched: self.affected(&movers),
            inverse: Change::Translate {
                cells: movers,
                by: -by,
            },
            structural: false,
        })
    }

    fn batch(&mut self, changes: Vec<Change>) -> Result<Applied, ModelError> {
        let mut inverses = Vec::with_capacity(changes.len());
        let mut touched = Vec::new();
        let mut structural = false;
        for change in changes {
            match self.apply(change) {
                Ok(applied) => {
                    touched.extend(applied.touched);
                    structural |= applied.structural;
                    inverses.push(applied.inverse);
                }
                Err(err) => {
                    for inverse in inverses.into_iter().rev() {
                        self.apply(inverse)
                            .expect("the inverse of an applied change always applies");
                    }
                    return Err(err);
                }
            }
        }
        inverses.reverse();
        Ok(Applied {
            inverse: Change::Batch(inverses),
            touched,
            structural,
        })
    }
}

/// Undo and redo stacks of inverse changes.
#[derive(Clone, Debug, Default)]
pub struct History {
    undo: Vec<Change>,
    redo: Vec<Change>,
}

impl History {
    /// Applies `change` to `model` and records its inverse for undo.
    pub fn perform(&mut self, model: &mut Model, change: Change) -> Result<Applied, ModelError> {
        let applied = model.apply(change)?;
        self.record(applied.inverse.clone());
        Ok(applied)
    }

    /// Records the inverse of a change that was already applied, and clears redo.
    pub fn record(&mut self, inverse: Change) {
        self.undo.push(inverse);
        self.redo.clear();
    }

    /// Reports whether there is a change to undo.
    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    /// Reports whether there is a change to redo.
    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    /// Undoes the latest change. Returns `None` when there is nothing to undo.
    pub fn undo(&mut self, model: &mut Model) -> Result<Option<Applied>, ModelError> {
        Self::step(model, &mut self.undo, &mut self.redo)
    }

    /// Redoes the latest undone change. Returns `None` when there is nothing to redo.
    pub fn redo(&mut self, model: &mut Model) -> Result<Option<Applied>, ModelError> {
        Self::step(model, &mut self.redo, &mut self.undo)
    }

    fn step(
        model: &mut Model,
        from: &mut Vec<Change>,
        to: &mut Vec<Change>,
    ) -> Result<Option<Applied>, ModelError> {
        let Some(change) = from.pop() else {
            return Ok(None);
        };
        match model.apply(change.clone()) {
            Ok(applied) => {
                to.push(applied.inverse.clone());
                Ok(Some(applied))
            }
            Err(err) => {
                from.push(change);
                Err(err)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(s: &str) -> CellId {
        CellId::new(s)
    }

    fn sample() -> Model {
        let mut m = Model::new();
        let cells = vec![
            Cell::vertex(id("box"), id("1"), Rect::new(100.0, 100.0, 200.0, 100.0)),
            Cell::vertex(id("inner"), id("box"), Rect::new(10.0, 30.0, 50.0, 20.0)),
            Cell::vertex(id("far"), id("1"), Rect::new(500.0, 100.0, 60.0, 40.0)),
            Cell::vertex(id("other"), id("1"), Rect::new(0.0, 0.0, 10.0, 10.0)),
            Cell::edge(id("e"), id("1"), id("inner"), id("far")),
        ];
        m.apply(Change::Insert {
            cells: cells.into_iter().map(|c| (c, usize::MAX)).collect(),
        })
        .expect("insert sample");
        m
    }

    #[test]
    fn every_change_round_trips_through_its_inverse() {
        let tests = [
            (
                "remove container",
                Change::Remove {
                    cells: vec![id("box")],
                },
            ),
            (
                "remove edge",
                Change::Remove {
                    cells: vec![id("e")],
                },
            ),
            (
                "translate parent and child",
                Change::Translate {
                    cells: vec![id("box"), id("inner")],
                    by: Point::new(5.0, -3.0),
                },
            ),
            (
                "set bounds",
                Change::SetBounds {
                    cell: id("far"),
                    bounds: Rect::new(1.0, 2.0, 3.0, 4.0),
                },
            ),
            (
                "set label",
                Change::SetLabel {
                    cell: id("far"),
                    label: "Registrar DB".into(),
                },
            ),
            (
                "set style",
                Change::SetStyle {
                    cell: id("far"),
                    style: Style::parse("ellipse;"),
                },
            ),
            (
                "batch",
                Change::Batch(vec![
                    Change::SetLabel {
                        cell: id("far"),
                        label: "Annie".into(),
                    },
                    Change::Remove {
                        cells: vec![id("other")],
                    },
                ]),
            ),
        ];
        for (name, change) in tests {
            let original = sample();
            let mut m = original.clone();
            let applied = m.apply(change).unwrap_or_else(|e| panic!("{name}: {e}"));
            assert_ne!(m, original, "{name}: change had no effect");
            m.apply(applied.inverse)
                .unwrap_or_else(|e| panic!("{name}: inverse: {e}"));
            assert_eq!(m, original, "{name}: inverse did not restore the model");
        }
    }

    #[test]
    fn remove_takes_descendants_and_connected_edges() {
        let mut m = sample();
        let applied = m
            .apply(Change::Remove {
                cells: vec![id("box")],
            })
            .expect("remove");
        let mut touched: Vec<&str> = applied.touched.iter().map(CellId::as_str).collect();
        touched.sort();
        assert_eq!(touched, ["box", "e", "inner"]);
        assert!(m.cell(&id("far")).is_some());
        assert!(applied.structural);
    }

    #[test]
    fn translating_a_parent_moves_children_once() {
        let mut m = sample();
        m.apply(Change::Translate {
            cells: vec![id("box"), id("inner")],
            by: Point::new(10.0, 0.0),
        })
        .expect("translate");
        assert_eq!(
            m.bounds(&id("inner")),
            Some(Rect::new(120.0, 130.0, 50.0, 20.0))
        );
    }

    #[test]
    fn insert_rejects_bad_references() {
        let tests = [
            (
                "duplicate id",
                Cell::vertex(id("far"), id("1"), Rect::default()),
                ModelError::DuplicateId(id("far")),
            ),
            (
                "unknown parent",
                Cell::vertex(id("x"), id("nope"), Rect::default()),
                ModelError::InvalidParent {
                    cell: id("x"),
                    parent: Some(id("nope")),
                },
            ),
            (
                "unknown terminal",
                Cell::edge(id("x"), id("1"), id("far"), id("nope")),
                ModelError::UnknownCell(id("nope")),
            ),
        ];
        for (name, cell, want) in tests {
            let mut m = sample();
            let before = m.clone();
            assert_eq!(
                m.apply(Change::Insert {
                    cells: vec![(cell, 0)]
                }),
                Err(want),
                "{name}"
            );
            assert_eq!(m, before, "{name}: model changed");
        }
    }

    #[test]
    fn failed_batch_leaves_the_model_unchanged() {
        let mut m = sample();
        let before = m.clone();
        let result = m.apply(Change::Batch(vec![
            Change::SetLabel {
                cell: id("far"),
                label: "Troy".into(),
            },
            Change::SetLabel {
                cell: id("missing"),
                label: "Abed".into(),
            },
        ]));
        assert_eq!(result, Err(ModelError::UnknownCell(id("missing"))));
        assert_eq!(m, before);
    }

    #[test]
    fn history_undoes_and_redoes() {
        let mut m = sample();
        let original = m.clone();
        let mut h = History::default();
        h.perform(
            &mut m,
            Change::SetLabel {
                cell: id("far"),
                label: "Greendale".into(),
            },
        )
        .expect("perform");
        let edited = m.clone();
        assert!(h.undo(&mut m).expect("undo").is_some());
        assert_eq!(m, original);
        assert!(h.redo(&mut m).expect("redo").is_some());
        assert_eq!(m, edited);
        assert!(h.redo(&mut m).expect("empty redo").is_none());
    }
}
