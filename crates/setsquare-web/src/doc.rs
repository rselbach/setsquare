//! The reactive view of one page's model.
//!
//! The core [`Model`] stays the single source of truth. Each cell gets its own trigger, so a
//! change redraws only the cells it touched, and a separate trigger fires when cells are
//! added or removed.

use std::collections::HashMap;

use leptos::prelude::*;
use setsquare_core::{Applied, CellId, CellKind, Change, History, Model, ModelError, PageSettings};

/// Shared handle to the page being edited. It is `Copy`, so components take it by value.
#[derive(Clone, Copy)]
pub struct DocState {
    model: StoredValue<Model>,
    history: StoredValue<History>,
    triggers: StoredValue<HashMap<CellId, ArcTrigger>>,
    structure: Trigger,
    can_undo: RwSignal<bool>,
    can_redo: RwSignal<bool>,
    pub settings: RwSignal<PageSettings>,
    pub selection: RwSignal<Option<CellId>>,
    /// Counts edits, so the title block can tell whether the drawing changed since a save.
    pub revision: RwSignal<u64>,
}

impl DocState {
    pub fn new(model: Model, settings: PageSettings) -> DocState {
        DocState {
            model: StoredValue::new(model),
            history: StoredValue::new(History::default()),
            triggers: StoredValue::new(HashMap::new()),
            structure: Trigger::new(),
            can_undo: RwSignal::new(false),
            can_redo: RwSignal::new(false),
            settings: RwSignal::new(settings),
            selection: RwSignal::new(None),
            revision: RwSignal::new(0),
        }
    }

    /// Puts another page's model, settings, and history in place and returns the previous
    /// ones. Every cell redraws.
    pub fn swap(
        &self,
        model: Model,
        settings: PageSettings,
        history: History,
    ) -> (Model, PageSettings, History) {
        let model = self
            .model
            .try_update_value(|m| std::mem::replace(m, model))
            .expect("document state outlives its views");
        let history = self
            .history
            .try_update_value(|h| std::mem::replace(h, history))
            .expect("document state outlives its views");
        let settings = self
            .settings
            .try_update(|s| std::mem::replace(s, settings))
            .expect("document state outlives its views");
        self.selection.set(None);
        let all: Vec<ArcTrigger> = self.triggers.with_value(|t| t.values().cloned().collect());
        for trigger in all {
            trigger.notify();
        }
        self.structure.notify();
        self.sync_history();
        self.revision.update(|r| *r += 1);
        (model, settings, history)
    }

    /// Returns a copy of the model, such as for saving.
    pub fn snapshot(&self) -> Model {
        self.model.with_value(Clone::clone)
    }

    /// Reads the model without subscribing to anything.
    pub fn read<R>(&self, f: impl FnOnce(&Model) -> R) -> R {
        self.model.with_value(f)
    }

    /// Subscribes the current reactive scope to changes of one cell.
    pub fn track(&self, id: &CellId) {
        let trigger = self
            .triggers
            .try_update_value(|t| t.entry(id.clone()).or_default().clone());
        if let Some(trigger) = trigger {
            trigger.track();
        }
    }

    /// Returns the drawable cells from back to front, and subscribes to additions and removals.
    pub fn cells(&self) -> Vec<CellId> {
        self.structure.track();
        self.read(|m| {
            m.paint_order()
                .into_iter()
                .filter(|c| !matches!(c.kind, CellKind::Layer))
                .map(|c| c.id.clone())
                .collect()
        })
    }

    /// Returns an identifier that no cell uses yet.
    pub fn new_id(&self) -> CellId {
        self.model
            .try_update_value(Model::new_id)
            .expect("document state outlives its views")
    }

    /// Applies `change` and records it for undo.
    pub fn perform(&self, change: Change) -> Result<(), ModelError> {
        let applied = self
            .model
            .try_update_value(|m| self.history.try_update_value(|h| h.perform(m, change)));
        self.finish(
            applied
                .flatten()
                .expect("document state outlives its views"),
        )
    }

    /// Applies `change` without recording it. Use for live previews such as a drag, then
    /// [`DocState::record`] the combined inverse when the gesture ends.
    pub fn preview(&self, change: Change) -> Result<(), ModelError> {
        let applied = self.model.try_update_value(|m| m.apply(change));
        self.finish(applied.expect("document state outlives its views"))
    }

    /// Records the inverse of changes already applied with [`DocState::preview`].
    pub fn record(&self, inverse: Change) {
        self.history.update_value(|h| h.record(inverse));
        self.sync_history();
        self.revision.update(|r| *r += 1);
    }

    pub fn undo(&self) -> Result<(), ModelError> {
        let applied = self
            .model
            .try_update_value(|m| self.history.try_update_value(|h| h.undo(m)));
        match applied
            .flatten()
            .expect("document state outlives its views")?
        {
            Some(applied) => self.finish(Ok(applied)),
            None => Ok(()),
        }
    }

    pub fn redo(&self) -> Result<(), ModelError> {
        let applied = self
            .model
            .try_update_value(|m| self.history.try_update_value(|h| h.redo(m)));
        match applied
            .flatten()
            .expect("document state outlives its views")?
        {
            Some(applied) => self.finish(Ok(applied)),
            None => Ok(()),
        }
    }

    pub fn can_undo(&self) -> bool {
        self.can_undo.get()
    }

    pub fn can_redo(&self) -> bool {
        self.can_redo.get()
    }

    fn finish(&self, applied: Result<Applied, ModelError>) -> Result<(), ModelError> {
        let applied = applied?;
        // Collect first so no view re-enters the trigger map while it is borrowed.
        let touched: Vec<ArcTrigger> = self.triggers.with_value(|t| {
            applied
                .touched
                .iter()
                .filter_map(|id| t.get(id).cloned())
                .collect()
        });
        for trigger in touched {
            trigger.notify();
        }
        if applied.structural {
            if let Some(selected) = self.selection.get_untracked()
                && !self.read(|m| m.cell(&selected).is_some())
            {
                self.selection.set(None);
            }
            self.structure.notify();
        }
        self.sync_history();
        self.revision.update(|r| *r += 1);
        Ok(())
    }

    fn sync_history(&self) {
        let (undo, redo) = self.history.with_value(|h| (h.can_undo(), h.can_redo()));
        self.can_undo.set(undo);
        self.can_redo.set(redo);
    }
}
