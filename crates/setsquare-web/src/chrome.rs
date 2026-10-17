//! The top bar and the title block.

use leptos::prelude::*;

use crate::canvas::{Tool, ViewState};
use crate::doc::DocState;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Theme {
    Light,
    Dark,
}

/// Returns an icon from the sprite in index.html.
pub fn icon(name: &'static str) -> impl IntoView {
    view! { <svg class="icon" aria-hidden="true" inner_html=format!(r##"<use href="#i-{name}"/>"##)></svg> }
}

#[component]
pub fn TopBar(theme: RwSignal<Theme>) -> impl IntoView {
    let doc = expect_context::<DocState>();
    let view = expect_context::<ViewState>();
    let tool = move |t: Tool, name: &'static str, label: &'static str, key: &'static str| {
        view! {
            <button
                class="iconbtn"
                aria-label=label
                title=format!("{label}  {key}")
                aria-pressed=move || (view.tool.get() == t).to_string()
                on:click=move |_| view.tool.set(t)
            >
                {icon(name)}
            </button>
        }
    };
    let theme_label = move || {
        if theme.get() == Theme::Light {
            "Switch to dark theme"
        } else {
            "Switch to light theme"
        }
    };
    view! {
        <header class="topbar">
            <div class="tb-left">
                <svg class="mark" viewBox="0 0 22 22" role="img" aria-label="Setsquare">
                    <path fill-rule="evenodd" d="M3 19V3l16 16zm3-3h6.4L6 9.6z"></path>
                </svg>
                <span class="sep"></span>
                <button class="iconbtn" aria-label="Undo" title="Undo  ⌘Z" disabled=move || !doc.can_undo() on:click=move |_| report(doc.undo())>
                    {icon("undo")}
                </button>
                <button class="iconbtn" aria-label="Redo" title="Redo  ⇧⌘Z" disabled=move || !doc.can_redo() on:click=move |_| report(doc.redo())>
                    {icon("redo")}
                </button>
            </div>
            <div class="tools" role="toolbar" aria-label="Tools">
                {tool(Tool::Select, "select", "Select", "V")}
                {tool(Tool::Hand, "hand", "Pan", "H")}
                {tool(Tool::Rectangle, "rect", "Rectangle", "R")}
                {tool(Tool::Ellipse, "ellipse", "Ellipse", "E")}
                {tool(Tool::Text, "text", "Text", "T")}
            </div>
            <div class="tb-right">
                <button
                    class="iconbtn"
                    aria-label=theme_label
                    title=theme_label
                    on:click=move |_| theme.update(|t| *t = if *t == Theme::Light { Theme::Dark } else { Theme::Light })
                >
                    {icon("theme")}
                </button>
                <button class="btn btn-primary" disabled title="Export arrives with the file format">
                    {icon("export")}
                    "Export"
                </button>
            </div>
        </header>
    }
}

/// Logs an edit the model refused. The model is unchanged when this happens.
pub fn report(result: Result<(), setsquare_core::ModelError>) {
    if let Err(err) = result {
        leptos::logging::error!("{err}");
    }
}

#[component]
pub fn TitleBlock(name: &'static str, page: String, pages: usize) -> impl IntoView {
    let doc = expect_context::<DocState>();
    let view = expect_context::<ViewState>();
    let layer = doc
        .read(|m| {
            m.layers()
                .first()
                .and_then(|l| m.cell(l))
                .map(|c| c.label.clone())
        })
        .unwrap_or_default();
    view! {
        <section class="titleblock" aria-label="Drawing">
            <div class="tb-cell tb-title">
                <span class="tb-label">"Drawing"</span>
                <span class="tb-name">{name}</span>
            </div>
            <div class="tb-cell tb-page">
                <span class="tb-label">{format!("Page 1 of {pages}")}</span>
                <span class="tb-value">{page}</span>
            </div>
            <div class="tb-cell first tb-hide-sm">
                <span class="tb-label">"Layer"</span>
                <span class="tb-value">{layer}</span>
            </div>
            <div class="tb-cell tb-zoomcell">
                <span class="tb-label">"Zoom"</span>
                <div class="tb-zoom">
                    <button class="iconbtn" aria-label="Zoom out" title="Zoom out  ⌘−" on:click=move |_| view.step_zoom(-1)>
                        {icon("minus")}
                    </button>
                    <output aria-live="polite">{move || format!("{}%", (view.zoom.get() * 100.0).round())}</output>
                    <button class="iconbtn" aria-label="Zoom in" title="Zoom in  ⌘+" on:click=move |_| view.step_zoom(1)>
                        {icon("plus")}
                    </button>
                </div>
            </div>
            <div class="tb-cell tb-hide-sm">
                <span class="tb-label">"Saved"</span>
                <span class="tb-value" style="font-weight:400">"Not yet"</span>
            </div>
        </section>
    }
}
