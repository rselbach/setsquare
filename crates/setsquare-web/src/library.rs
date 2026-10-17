//! The shape library. Tiles draw with the same outlines as the canvas.

use leptos::prelude::*;
use setsquare_core::{Rect, Shape, Size, Style};

use crate::canvas::{ViewState, insert_vertex};
use crate::doc::DocState;

struct Tile {
    name: &'static str,
    style: &'static str,
    size: (f64, f64),
}

const GENERAL: [Tile; 18] = [
    Tile {
        name: "Rectangle",
        style: "whiteSpace=wrap;html=1;",
        size: (120.0, 60.0),
    },
    Tile {
        name: "Rounded rectangle",
        style: "rounded=1;whiteSpace=wrap;html=1;",
        size: (120.0, 60.0),
    },
    Tile {
        name: "Ellipse",
        style: "ellipse;whiteSpace=wrap;html=1;",
        size: (120.0, 80.0),
    },
    Tile {
        name: "Decision",
        style: "rhombus;whiteSpace=wrap;html=1;",
        size: (110.0, 80.0),
    },
    Tile {
        name: "Triangle",
        style: "triangle;whiteSpace=wrap;html=1;",
        size: (80.0, 70.0),
    },
    Tile {
        name: "Preparation",
        style: "shape=hexagon;whiteSpace=wrap;html=1;",
        size: (120.0, 60.0),
    },
    Tile {
        name: "Data",
        style: "shape=parallelogram;whiteSpace=wrap;html=1;",
        size: (120.0, 60.0),
    },
    Tile {
        name: "Trapezoid",
        style: "shape=trapezoid;whiteSpace=wrap;html=1;",
        size: (120.0, 60.0),
    },
    Tile {
        name: "Step",
        style: "shape=step;whiteSpace=wrap;html=1;",
        size: (120.0, 60.0),
    },
    Tile {
        name: "Database",
        style: "shape=cylinder3;whiteSpace=wrap;html=1;",
        size: (100.0, 100.0),
    },
    Tile {
        name: "Queue",
        style: "shape=cylinder3;direction=south;whiteSpace=wrap;html=1;",
        size: (150.0, 60.0),
    },
    Tile {
        name: "Document",
        style: "shape=document;whiteSpace=wrap;html=1;",
        size: (120.0, 70.0),
    },
    Tile {
        name: "Note",
        style: "shape=note;whiteSpace=wrap;html=1;",
        size: (160.0, 90.0),
    },
    Tile {
        name: "Cloud",
        style: "ellipse;shape=cloud;whiteSpace=wrap;html=1;",
        size: (130.0, 80.0),
    },
    Tile {
        name: "Predefined process",
        style: "shape=process;whiteSpace=wrap;html=1;",
        size: (130.0, 60.0),
    },
    Tile {
        name: "Actor",
        style: "shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;",
        size: (40.0, 70.0),
    },
    Tile {
        name: "Container",
        style: "swimlane;startSize=26;html=1;",
        size: (260.0, 180.0),
    },
    Tile {
        name: "Text",
        style: "text;html=1;align=center;verticalAlign=middle;",
        size: (100.0, 30.0),
    },
];

fn tile_art(tile: &Tile) -> String {
    let style = Style::parse(tile.style);
    let shape = Shape::of(&style);
    let (w, h) = tile.size;
    let k = 24.0 / w.max(h);
    let r = Rect::new(15.0 - w * k / 2.0, 15.0 - h * k / 2.0, w * k, h * k);
    if shape == Shape::Text {
        return r#"<path d="M8 8h14M15 8v14M12.5 22h5"/>"#.to_owned();
    }
    // Scale a container's header with the tile so it stays visible.
    let style = style
        .get("startSize")
        .and_then(|s| s.parse::<f64>().ok())
        .map_or(style.clone(), |size| {
            let mut scaled = style.clone();
            scaled.set("startSize", (size * k).to_string());
            scaled
        });
    let mut out = format!(r#"<path d="{}"/>"#, shape.outline(r));
    if let Some(d) = shape.detail(r, &style) {
        out += &format!(r#"<path d="{d}"/>"#);
    }
    out
}

#[component]
pub fn Library() -> impl IntoView {
    let doc = expect_context::<DocState>();
    let view = expect_context::<ViewState>();
    let open = RwSignal::new(true);
    let tiles = GENERAL
        .iter()
        .map(|tile| {
            let art = tile_art(tile);
            let (name, style, (w, h)) = (tile.name, tile.style, tile.size);
            view! {
                <button
                    class="tile"
                    title=name
                    aria-label=format!("Insert {name}")
                    on:click=move |_| insert_vertex(doc, view.center(), style, Size::new(w, h), name)
                >
                    <svg viewBox="0 0 30 30" inner_html=art></svg>
                </button>
            }
        })
        .collect_view();
    view! {
        <aside class="library" aria-label="Shape library">
            <div class="lib-scroll">
                <button class="lib-head" aria-expanded=move || open.get().to_string() on:click=move |_| open.update(|o| *o = !*o)>
                    <svg class="icon chev" aria-hidden="true" inner_html=r##"<use href="#i-chev"/>"##></svg>
                    "General"
                    <span class="count">{GENERAL.len()}</span>
                </button>
                <div class="tiles" hidden=move || !open.get()>{tiles}</div>
            </div>
        </aside>
    }
}
