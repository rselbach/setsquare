//! The inspector: page details with nothing selected, otherwise the selected cell's style
//! and geometry.

use leptos::prelude::*;
use setsquare_core::{CellId, CellKind, Change, Rect, Shape, VertexGeometry};

use crate::chrome::report;
use crate::doc::DocState;
use crate::sample::SWATCHES;
use crate::workspace::Workspace;

fn shape_name(shape: Shape) -> &'static str {
    match shape {
        Shape::Rectangle => "Rectangle",
        Shape::RoundedRectangle => "Rounded rectangle",
        Shape::Ellipse => "Ellipse",
        Shape::Rhombus => "Decision",
        Shape::Triangle => "Triangle",
        Shape::Hexagon => "Preparation",
        Shape::Parallelogram => "Data",
        Shape::Trapezoid => "Trapezoid",
        Shape::Step => "Step",
        Shape::Cylinder => "Database",
        Shape::HorizontalCylinder => "Queue",
        Shape::Document => "Document",
        Shape::Note => "Note",
        Shape::Cloud => "Cloud",
        Shape::Actor => "Actor",
        Shape::Process => "Predefined process",
        Shape::Swimlane => "Container",
        Shape::Line | Shape::VerticalLine => "Line",
    }
}

/// Returns a label as one plain line for headings.
fn heading(label: &str) -> String {
    let text: String = label
        .replace("<br>", " ")
        .split('<')
        .map(|part| part.split_once('>').map_or(part, |(_, rest)| rest))
        .collect();
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        "Untitled".to_owned()
    } else {
        text
    }
}

#[component]
pub fn Inspector() -> impl IntoView {
    let doc = expect_context::<DocState>();
    let workspace = expect_context::<Workspace>();
    let page = move || {
        workspace
            .page_names
            .with(|n| n.get(workspace.current.get()).cloned().unwrap_or_default())
    };
    let pages = move || {
        format!(
            "Page {} of {}",
            workspace.current.get() + 1,
            workspace.page_names.with(Vec::len)
        )
    };
    let size = move || {
        doc.settings
            .with(|s| format!("{} × {} pt", s.page_size.width, s.page_size.height))
    };
    let grid = move || {
        doc.settings.with(|s| {
            if s.grid {
                format!("{} pt", s.grid_size)
            } else {
                "Off".to_owned()
            }
        })
    };
    view! {
        <aside class="inspector" aria-label="Inspector">
            {move || match doc.selection.get() {
                Some(id) => view! { <Selected id/> }.into_any(),
                None => view! {
                    <div class="insp-head">
                        <h2 class="insp-name">{page}</h2>
                        <p class="insp-kind">{pages}</p>
                    </div>
                    <section class="sec">
                        <h3 class="sec-title">"Page"</h3>
                        <div class="sec-body">
                            <div class="row"><span class="lbl">"Size"</span><span>{size}</span></div>
                            <div class="row"><span class="lbl">"Grid"</span><span>{grid}</span></div>
                            <p class="note">"Select a shape to style it."</p>
                        </div>
                    </section>
                }.into_any(),
            }}
        </aside>
    }
}

#[component]
fn Selected(id: CellId) -> impl IntoView {
    let doc = expect_context::<DocState>();
    let tracked = {
        let id = id.clone();
        move || doc.track(&id)
    };
    let title = {
        let (id, tracked) = (id.clone(), tracked.clone());
        move || {
            tracked();
            doc.read(|m| m.cell(&id).map(|c| heading(&c.label)))
                .unwrap_or_default()
        }
    };
    let kind = doc.read(|m| match (m.cell(&id), m.style(&id)) {
        (Some(c), _) if matches!(c.kind, CellKind::Edge(_)) => "Connector",
        (Some(c), _) if c.style.has_name("text") => "Text",
        (Some(_), Some(style)) => shape_name(Shape::of(&style)),
        _ => "",
    });
    let is_vertex = doc.read(|m| matches!(m.cell(&id).map(|c| &c.kind), Some(CellKind::Vertex(_))));

    let swatches = SWATCHES
        .iter()
        .map(|s| {
            let (id, tracked) = (id.clone(), tracked.clone());
            let pressed = {
                let id = id.clone();
                move || {
                    tracked();
                    doc.read(|m| m.cell(&id).and_then(|c| c.style.get("fillColor").map(|f| f == s.fill))).unwrap_or(false).to_string()
                }
            };
            view! {
                <button
                    class="sw"
                    title=s.name
                    aria-label=format!("{} style", s.name)
                    aria-pressed=pressed
                    style=format!("background:{};border-color:{}", s.fill, s.stroke)
                    on:click=move |_| {
                        let Some(mut style) = doc.read(|m| m.cell(&id).map(|c| c.style.clone())) else { return };
                        style.set("fillColor", s.fill);
                        style.set("strokeColor", s.stroke);
                        report(doc.perform(Change::SetStyle { cell: id.clone(), style }));
                    }
                ></button>
            }
        })
        .collect_view();

    let field = move |key: &'static str,
                      label: &'static str,
                      read: fn(&Rect) -> f64,
                      write: fn(&mut Rect, f64)| {
        let (id, tracked) = (id.clone(), tracked.clone());
        let bounds = {
            let id = id.clone();
            move || {
                tracked();
                doc.read(|m| match m.cell(&id).map(|c| &c.kind) {
                    Some(CellKind::Vertex(v)) => match v.geometry {
                        VertexGeometry::Bounds(r) => Some(r),
                        VertexGeometry::Relative { .. } => None,
                    },
                    _ => None,
                })
            }
        };
        let value = {
            let bounds = bounds.clone();
            move || {
                bounds()
                    .map(|r| read(&r).round().to_string())
                    .unwrap_or_default()
            }
        };
        view! {
            <label class="ctl num">
                <b>{key}</b>
                <span class="sr">{label}</span>
                <input
                    inputmode="decimal"
                    prop:value=value
                    on:change=move |e| {
                        let (Some(mut r), Ok(v)) = (bounds(), event_target_value(&e).trim().parse::<f64>()) else { return };
                        write(&mut r, v);
                        r.width = r.width.max(1.0);
                        r.height = r.height.max(1.0);
                        report(doc.perform(Change::SetBounds { cell: id.clone(), bounds: r }));
                    }
                />
            </label>
        }
    };

    view! {
        <div class="insp-head">
            <h2 class="insp-name">{title}</h2>
            <p class="insp-kind">{kind}</p>
        </div>
        <section class="sec">
            <h3 class="sec-title">"Style"</h3>
            <div class="sec-body"><div class="swatches">{swatches}</div></div>
        </section>
        {is_vertex.then(|| view! {
            <section class="sec">
                <h3 class="sec-title">"Arrange"</h3>
                <div class="sec-body">
                    <div class="pair">
                        {field("X", "X position", |r| r.x, |r, v| r.x = v)}
                        {field("Y", "Y position", |r| r.y, |r, v| r.y = v)}
                        {field("W", "Width", |r| r.width, |r, v| r.width = v)}
                        {field("H", "Height", |r| r.height, |r, v| r.height = v)}
                    </div>
                </div>
            </section>
        })}
    }
}
