//! The top bar and the title block.

use leptos::prelude::*;

use crate::canvas::{Tool, ViewState};
use crate::doc::DocState;
use crate::workspace::Workspace;

/// The id of the hidden file input that **Open** and ⌘O use.
pub const OPEN_INPUT: &str = "open-file";

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
    let workspace = expect_context::<Workspace>();
    let file_input = NodeRef::<leptos::html::Input>::new();
    let on_file = move |_| {
        let Some(input) = file_input.get_untracked() else {
            return;
        };
        if let Some(file) = input.files().and_then(|f| f.get(0)) {
            workspace.open_file(doc, view, file);
        }
        input.set_value("");
    };
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
                <input
                    node_ref=file_input
                    id=OPEN_INPUT
                    class="file-input"
                    type="file"
                    accept=".drawio,.xml,application/xml"
                    on:change=on_file
                />
                <button class="btn" title="Open a draw.io file  ⌘O" on:click=move |_| {
                    if let Some(input) = file_input.get_untracked() {
                        input.click();
                    }
                }>
                    {icon("open")}
                    "Open"
                </button>
                <button class="btn btn-primary" title="Save as a draw.io file  ⌘S" on:click=move |_| workspace.save(doc)>
                    {icon("export")}
                    "Save"
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
pub fn TitleBlock() -> impl IntoView {
    let doc = expect_context::<DocState>();
    let view = expect_context::<ViewState>();
    let workspace = expect_context::<Workspace>();
    let layer = move || {
        doc.revision.get();
        doc.read(|m| {
            m.layers()
                .first()
                .and_then(|l| m.cell(l))
                .map(|c| c.label.clone())
        })
        .filter(|l| !l.is_empty())
    };
    let count = move || workspace.page_names.with(Vec::len);
    let page_name = move || {
        workspace.page_names.with(|names| {
            names
                .get(workspace.current.get())
                .cloned()
                .unwrap_or_default()
        })
    };
    // Comparisons stay outside view! because a `>` in an attribute closes the tag there.
    let at_first = move || workspace.current.get() == 0;
    let at_last = move || workspace.current.get() + 1 >= count();
    let go = move |step: isize| {
        let next = workspace
            .current
            .get_untracked()
            .saturating_add_signed(step);
        workspace.go_to(doc, view, next);
    };
    view! {
        <section class="titleblock" aria-label="Drawing">
            <div class="tb-cell tb-title">
                <span class="tb-label">"Drawing"</span>
                <span class="tb-name">{move || workspace.name.get()}</span>
            </div>
            <div class="tb-cell tb-page">
                <div class="tb-page-head">
                    <span class="tb-label">{move || format!("Page {} of {}", workspace.current.get() + 1, count())}</span>
                    <span class="tb-pager">
                        <button class="iconbtn" aria-label="Previous page" title="Previous page" disabled=at_first on:click=move |_| go(-1)>
                            {icon("chev-l")}
                        </button>
                        <button class="iconbtn" aria-label="Next page" title="Next page" disabled=at_last on:click=move |_| go(1)>
                            {icon("chev")}
                        </button>
                    </span>
                </div>
                <span class="tb-value">{page_name}</span>
            </div>
            <div class="tb-cell first tb-hide-sm">
                <span class="tb-label">"Layer"</span>
                <span class="tb-value">{move || layer().unwrap_or_else(|| "Default".to_owned())}</span>
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
                <span class="tb-value" style="font-weight:400">{move || workspace.save_status(doc)}</span>
            </div>
        </section>
    }
}

/// Shows the workspace notice, such as why a file did not open, until it is dismissed.
#[component]
pub fn Notice() -> impl IntoView {
    let workspace = expect_context::<Workspace>();
    Effect::new(move |_| {
        if let Some(shown) = workspace.notice.get() {
            set_timeout(
                move || {
                    if workspace.notice.get_untracked().as_ref() == Some(&shown) {
                        workspace.notice.set(None);
                    }
                },
                std::time::Duration::from_secs(6),
            );
        }
    });
    move || {
        workspace.notice.get().map(|text| {
            view! {
                <div class="toast" role="status">
                    <span>{text}</span>
                    <button class="iconbtn" aria-label="Dismiss" on:click=move |_| workspace.notice.set(None)>
                        {icon("close")}
                    </button>
                </div>
            }
        })
    }
}
