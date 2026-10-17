//! Setsquare's web app.

mod canvas;
mod chrome;
mod doc;
mod draw;
mod inspector;
mod library;
mod sample;
mod workspace;

use leptos::ev;
use leptos::prelude::*;
use setsquare_core::{Change, Model, PageSettings, Point};
use wasm_bindgen::JsCast;

use crate::canvas::{Canvas, Tool, ViewState};
use crate::chrome::{Notice, OPEN_INPUT, Theme, TitleBlock, TopBar, report};
use crate::doc::DocState;
use crate::inspector::Inspector;
use crate::library::Library;
use crate::workspace::Workspace;

fn main() {
    leptos::mount::mount_to_body(App);
}

#[component]
fn App() -> impl IntoView {
    let doc = DocState::new(Model::default(), PageSettings::default());
    let view = ViewState::new();
    let workspace = Workspace::new(doc, sample::document(), sample::NAME);
    provide_context(doc);
    provide_context(view);
    provide_context(workspace);

    let theme = RwSignal::new(Theme::Light);
    Effect::new(move |_| {
        let name = if theme.get() == Theme::Dark {
            "dark"
        } else {
            "light"
        };
        if let Some(root) = document_root() {
            let _ = root.set_attribute("data-theme", name);
        }
    });

    let _keys = window_event_listener(ev::keydown, move |e| shortcut(doc, view, workspace, &e));
    let _keys_up = window_event_listener(ev::keyup, move |e| {
        if e.key() == " " {
            view.space.set(false);
        }
    });

    view! {
        <div class="app">
            <TopBar theme/>
            <Library/>
            <main class="stage">
                <Canvas/>
                <TitleBlock/>
            </main>
            <Inspector/>
        </div>
        <Notice/>
    }
}

fn document_root() -> Option<web_sys::Element> {
    web_sys::window()?.document()?.document_element()
}

/// Handles keyboard shortcuts that apply anywhere outside a text field.
fn shortcut(doc: DocState, view: ViewState, workspace: Workspace, e: &ev::KeyboardEvent) {
    let typing = e
        .target()
        .and_then(|t| t.dyn_into::<web_sys::Element>().ok())
        .is_some_and(|t| matches!(t.tag_name().as_str(), "INPUT" | "SELECT" | "TEXTAREA"));
    if typing {
        return;
    }
    let key = e.key();
    let command = e.meta_key() || e.ctrl_key();
    let selection = doc.selection.get_untracked();
    let handled = match (command, key.as_str()) {
        (true, "z" | "Z") if e.shift_key() => {
            report(doc.redo());
            true
        }
        (true, "z") => {
            report(doc.undo());
            true
        }
        (true, "=" | "+") => {
            view.step_zoom(1);
            true
        }
        (true, "-") => {
            view.step_zoom(-1);
            true
        }
        (true, "s") => {
            workspace.save(doc);
            true
        }
        (true, "o") => {
            let input = web_sys::window()
                .and_then(|w| w.document())
                .and_then(|d| d.get_element_by_id(OPEN_INPUT));
            if let Some(input) = input.and_then(|i| i.dyn_into::<web_sys::HtmlElement>().ok()) {
                input.click();
            }
            true
        }
        (true, "h" | "H") if e.shift_key() => {
            view.fit(doc);
            true
        }
        (true, _) => false,
        (false, "Delete" | "Backspace") => match selection {
            Some(id) => {
                report(doc.perform(Change::Remove { cells: vec![id] }));
                true
            }
            None => false,
        },
        (false, "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown") => match selection {
            Some(id) => {
                let step = if e.shift_key() { 10.0 } else { 1.0 };
                let by = match key.as_str() {
                    "ArrowLeft" => Point::new(-step, 0.0),
                    "ArrowRight" => Point::new(step, 0.0),
                    "ArrowUp" => Point::new(0.0, -step),
                    _ => Point::new(0.0, step),
                };
                report(doc.perform(Change::Translate {
                    cells: vec![id],
                    by,
                }));
                true
            }
            None => false,
        },
        (false, "Escape") => {
            doc.selection.set(None);
            view.tool.set(Tool::Select);
            true
        }
        (false, " ") => {
            view.space.set(true);
            true
        }
        (false, k) => match k.to_ascii_lowercase().as_str() {
            "v" => Some(Tool::Select),
            "h" => Some(Tool::Hand),
            "r" => Some(Tool::Rectangle),
            "e" => Some(Tool::Ellipse),
            "t" => Some(Tool::Text),
            _ => None,
        }
        .map(|t| view.tool.set(t))
        .is_some(),
    };
    if handled {
        e.prevent_default();
    }
}
