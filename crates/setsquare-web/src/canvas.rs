//! The drawing surface: page, grid, cells, construction marks, rulers, and pointer input.

use std::collections::HashSet;
use std::fmt::Write;

use leptos::ev;
use leptos::prelude::*;
use setsquare_core::geometry::snap;
use setsquare_core::{Cell, CellId, CellKind, Change, Guide, Point, Rect, Size};
use wasm_bindgen::JsCast;

use crate::doc::DocState;
use crate::draw::CellDraw;
use crate::workspace::Workspace;

/// The active tool in the top bar.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tool {
    Select,
    Hand,
    Rectangle,
    Ellipse,
    Text,
}

impl Tool {
    /// Returns the style, size, and label a placing tool inserts.
    fn places(self) -> Option<(&'static str, Size, &'static str)> {
        match self {
            Tool::Rectangle => Some(("whiteSpace=wrap;html=1;", Size::new(120.0, 60.0), "")),
            Tool::Ellipse => Some((
                "ellipse;whiteSpace=wrap;html=1;",
                Size::new(120.0, 80.0),
                "",
            )),
            Tool::Text => Some((
                "text;html=1;align=center;verticalAlign=middle;",
                Size::new(100.0, 30.0),
                "Text",
            )),
            Tool::Select | Tool::Hand => None,
        }
    }
}

/// Zoom, scroll, tool, and transient marks shared by the canvas and the chrome around it.
#[derive(Clone, Copy)]
pub struct ViewState {
    pub zoom: RwSignal<f64>,
    /// Where the page origin sits on screen, relative to the canvas.
    pub origin: RwSignal<Point>,
    pub size: RwSignal<Size>,
    pub tool: RwSignal<Tool>,
    pub guides: RwSignal<Vec<Guide>>,
    pub moving: RwSignal<bool>,
    pub space: RwSignal<bool>,
}

const ZOOM_STEPS: [f64; 12] = [
    0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0,
];
const RULER: f64 = 22.0;

impl ViewState {
    pub fn new() -> ViewState {
        ViewState {
            zoom: RwSignal::new(1.0),
            origin: RwSignal::new(Point::new(40.0, 36.0)),
            size: RwSignal::new(Size::default()),
            tool: RwSignal::new(Tool::Select),
            guides: RwSignal::new(Vec::new()),
            moving: RwSignal::new(false),
            space: RwSignal::new(false),
        }
    }

    fn to_world(self, screen: Point) -> Point {
        let (o, z) = (self.origin.get_untracked(), self.zoom.get_untracked());
        Point::new((screen.x - o.x) / z, (screen.y - o.y) / z)
    }

    /// Returns the page point at the middle of the canvas.
    pub fn center(&self) -> Point {
        let s = self.size.get_untracked();
        self.to_world(Point::new(s.width / 2.0, s.height / 2.0))
    }

    /// Zooms to `zoom`, keeping the page point under `at` fixed on screen.
    pub fn zoom_at(&self, zoom: f64, at: Point) {
        let zoom = zoom.clamp(ZOOM_STEPS[0], ZOOM_STEPS[ZOOM_STEPS.len() - 1]);
        let k = zoom / self.zoom.get_untracked();
        self.origin
            .update(|o| *o = Point::new(at.x - (at.x - o.x) * k, at.y - (at.y - o.y) * k));
        self.zoom.set(zoom);
    }

    /// Moves to the next zoom step in `direction`, around the middle of the canvas.
    pub fn step_zoom(&self, direction: i32) {
        let z = self.zoom.get_untracked();
        let next = if direction > 0 {
            ZOOM_STEPS.iter().copied().find(|s| *s > z + 1e-3)
        } else {
            ZOOM_STEPS.iter().rev().copied().find(|s| *s < z - 1e-3)
        };
        let s = self.size.get_untracked();
        if let Some(next) = next {
            self.zoom_at(next, Point::new(s.width / 2.0, s.height / 2.0));
        }
    }

    /// Zooms and scrolls so the whole drawing fits, never above 100%.
    pub fn fit(&self, doc: DocState) {
        let bounds = doc.read(|m| {
            m.paint_order()
                .iter()
                .filter(|c| matches!(c.kind, CellKind::Vertex(_)))
                .filter_map(|c| m.bounds(&c.id))
                .reduce(|a, b| a.union(&b))
        });
        let (Some(b), s) = (bounds, self.size.get_untracked()) else {
            return;
        };
        let pad = 56.0_f64.min(s.width * 0.06);
        let zoom = ZOOM_STEPS
            .iter()
            .rev()
            .copied()
            .filter(|z| *z <= 1.0)
            .find(|z| {
                b.width * z + pad * 2.0 <= s.width && b.height * z + pad * 2.0 <= s.height - 70.0
            })
            .unwrap_or(ZOOM_STEPS[0]);
        self.zoom.set(zoom);
        self.origin.set(Point::new(
            pad.max((s.width - b.width * zoom) / 2.0) - b.x * zoom,
            pad * 0.7 - b.y * zoom,
        ));
    }
}

/// Inserts a vertex centered on `at` in the first layer and selects it.
pub fn insert_vertex(doc: DocState, at: Point, style: &str, size: Size, label: &str) {
    let Some(layer) = doc.read(|m| m.layers().first().cloned()) else {
        return;
    };
    let grid = doc
        .settings
        .with_untracked(|s| if s.grid { s.grid_size } else { 1.0 });
    let snap_to = |v: f64| (v / grid).round() * grid;
    let id = doc.new_id();
    let rect = Rect::new(
        snap_to(at.x - size.width / 2.0),
        snap_to(at.y - size.height / 2.0),
        size.width,
        size.height,
    );
    let cell = Cell::vertex(id.clone(), layer, rect)
        .with_label(label)
        .with_style(style);
    match doc.perform(Change::Insert {
        cells: vec![(cell, usize::MAX)],
    }) {
        Ok(()) => doc.selection.set(Some(id)),
        Err(err) => leptos::logging::error!("insert failed: {err}"),
    }
}

#[derive(Clone)]
enum Gesture {
    Pan {
        from: Point,
        origin: Point,
    },
    Move {
        cells: Vec<CellId>,
        start: Rect,
        pointer: Point,
        applied: Point,
        others: Vec<Rect>,
    },
}

fn client(e: &ev::PointerEvent) -> Point {
    Point::new(e.client_x() as f64, e.client_y() as f64)
}

/// The canvas with its rulers. The title block sits on top of it.
#[component]
pub fn Canvas() -> impl IntoView {
    let doc = expect_context::<DocState>();
    let view = expect_context::<ViewState>();
    let workspace = expect_context::<Workspace>();
    let canvas = NodeRef::<leptos::svg::Svg>::new();
    let gesture = StoredValue::new(None::<Gesture>);

    let local = move |p: Point| -> Point {
        canvas.get_untracked().map_or(p, |el| {
            let r = el.get_bounding_client_rect();
            Point::new(p.x - r.left(), p.y - r.top())
        })
    };
    let measure = move || {
        if let Some(el) = canvas.get_untracked() {
            let r = el.get_bounding_client_rect();
            view.size.set(Size::new(r.width(), r.height()));
        }
    };
    Effect::new(move |fitted: Option<bool>| {
        if fitted == Some(true) || canvas.get().is_none() {
            return fitted.unwrap_or(false);
        }
        measure();
        view.fit(doc);
        true
    });
    let _resize = window_event_listener(ev::resize, move |_| measure());

    let on_down = move |e: ev::PointerEvent| {
        let Some(el) = canvas.get_untracked() else {
            return;
        };
        let at = local(client(&e));
        let tool = view.tool.get_untracked();
        if tool == Tool::Hand || view.space.get_untracked() || e.button() == 1 {
            gesture.set_value(Some(Gesture::Pan {
                from: client(&e),
                origin: view.origin.get_untracked(),
            }));
            let _ = el.set_pointer_capture(e.pointer_id());
            return;
        }
        let pointer = view.to_world(at);
        if let Some((style, size, label)) = tool.places() {
            insert_vertex(doc, pointer, style, size, label);
            view.tool.set(Tool::Select);
            return;
        }
        let hit = e
            .target()
            .and_then(|t| t.dyn_into::<web_sys::Element>().ok())
            .and_then(|t| t.closest("[data-id]").ok().flatten())
            .and_then(|t| t.get_attribute("data-id"))
            .map(CellId::new);
        let Some(id) = hit else {
            doc.selection.set(None);
            return;
        };
        doc.selection.set(Some(id.clone()));
        let Some(start) = doc.read(|m| m.bounds(&id)) else {
            return;
        };
        let others = doc.read(|m| {
            let moving: HashSet<CellId> = m
                .with_descendants(std::slice::from_ref(&id))
                .into_iter()
                .collect();
            m.paint_order()
                .iter()
                .filter(|c| {
                    c.visible && matches!(c.kind, CellKind::Vertex(_)) && !moving.contains(&c.id)
                })
                .filter_map(|c| m.bounds(&c.id))
                .collect()
        });
        gesture.set_value(Some(Gesture::Move {
            cells: vec![id],
            start,
            pointer,
            applied: Point::default(),
            others,
        }));
        let _ = el.set_pointer_capture(e.pointer_id());
    };

    let on_move = move |e: ev::PointerEvent| {
        let at = local(client(&e));
        gesture.update_value(|g| match g {
            Some(Gesture::Pan { from, origin }) => view.origin.set(*origin + (client(&e) - *from)),
            Some(Gesture::Move {
                cells,
                start,
                pointer,
                applied,
                others,
            }) => {
                let wanted = start.translate(view.to_world(at) - *pointer);
                let grid = doc
                    .settings
                    .with_untracked(|s| if s.grid { s.grid_size } else { 0.0 });
                let snapped = snap(wanted, others, 6.0 / view.zoom.get_untracked(), grid);
                let delta = snapped.rect.origin() - (start.origin() + *applied);
                if delta != Point::default() {
                    match doc.preview(Change::Translate {
                        cells: cells.clone(),
                        by: delta,
                    }) {
                        Ok(()) => *applied = *applied + delta,
                        Err(err) => leptos::logging::error!("move failed: {err}"),
                    }
                }
                view.guides.set(snapped.guides);
                view.moving.set(true);
            }
            None => {}
        });
    };

    let on_up = move |_: ev::PointerEvent| {
        if let Some(Some(Gesture::Move { cells, applied, .. })) =
            gesture.try_update_value(Option::take)
            && applied != Point::default()
        {
            doc.record(Change::Translate {
                cells,
                by: -applied,
            });
        }
        view.guides.set(Vec::new());
        view.moving.set(false);
    };

    let on_wheel = move |e: ev::WheelEvent| {
        e.prevent_default();
        if e.ctrl_key() || e.meta_key() {
            let at = local(Point::new(e.client_x() as f64, e.client_y() as f64));
            view.zoom_at(view.zoom.get_untracked() * (-e.delta_y() * 0.002).exp(), at);
        } else {
            view.origin
                .update(|o| *o = *o - Point::new(e.delta_x(), e.delta_y()));
        }
    };

    let defs = move || {
        let g = doc.settings.with(|s| s.grid_size);
        format!(
            r#"<pattern id="grid-minor" width="{g}" height="{g}" patternUnits="userSpaceOnUse"><path d="M{g} 0H0V{g}" fill="none" style="stroke:var(--grid-minor)" vector-effect="non-scaling-stroke"/></pattern>
<pattern id="grid-major" width="{m}" height="{m}" patternUnits="userSpaceOnUse"><path d="M{m} 0H0V{m}" fill="none" style="stroke:var(--grid-major)" vector-effect="non-scaling-stroke"/></pattern>"#,
            m = g * 5.0,
        )
    };
    let sheet = move || {
        let (size, show_grid) = doc.settings.with(|s| (s.page_size, s.grid));
        let (w, h) = (size.width, size.height);
        let grid = if show_grid {
            format!(
                r#"<rect width="{w}" height="{h}" fill="url(#grid-minor)"/><rect width="{w}" height="{h}" fill="url(#grid-major)"/>"#
            )
        } else {
            String::new()
        };
        format!(
            r#"<rect class="sheet-edge" x="-1" y="-1" width="{}" height="{}"/><rect class="sheet" width="{w}" height="{h}"/>{grid}"#,
            w + 2.0,
            h + 2.0
        )
    };

    view! {
        <div class="ruler ruler-corner"></div>
        <div class="ruler ruler-x"><svg inner_html=move || ruler(doc, view, true)></svg></div>
        <div class="ruler ruler-y"><svg inner_html=move || ruler(doc, view, false)></svg></div>
        <svg
            node_ref=canvas
            class="canvas"
            class:hand=move || view.tool.get() == Tool::Hand || view.space.get()
            class:place=move || view.tool.get().places().is_some()
            aria-label="Drawing canvas"
            on:pointerdown=on_down
            on:pointermove=on_move
            on:pointerup=on_up
            on:pointercancel=on_up
            on:wheel=on_wheel
            on:dragover=|e: ev::DragEvent| e.prevent_default()
            on:drop=move |e: ev::DragEvent| {
                e.prevent_default();
                if let Some(file) = e.data_transfer().and_then(|d| d.files()).and_then(|f| f.get(0)) {
                    workspace.open_file(doc, view, file);
                }
            }
        >
            <defs inner_html=defs></defs>
            <g transform=move || {
                let (o, z) = (view.origin.get(), view.zoom.get());
                format!("translate({} {}) scale({z})", o.x, o.y)
            }>
                <g inner_html=sheet></g>
                <For each=move || doc.cells() key=CellId::clone children=move |id| view! { <CellView id/> } />
            </g>
            <g class="construct" inner_html=move || construction(doc, view)></g>
        </svg>
    }
}

#[component]
fn CellView(id: CellId) -> impl IntoView {
    let doc = expect_context::<DocState>();
    let key = id.clone();
    let draw = Memo::new(move |_| {
        doc.track(&key);
        doc.read(|m| CellDraw::of(m, &key))
    });
    view! { <g class="cell" data-id=id.to_string() inner_html=move || draw.with(CellDraw::markup)></g> }
}

/// Returns the selection, guides, and size readout as SVG, in screen space.
fn construction(doc: DocState, view: ViewState) -> String {
    let (o, z) = (view.origin.get(), view.zoom.get());
    let to = |p: Point| Point::new(o.x + p.x * z, o.y + p.y * z);
    let mut out = String::new();
    for g in view.guides.get() {
        let (a, b) = (to(g.from), to(g.to));
        let _ = write!(
            out,
            r#"<line class="guide" x1="{}" y1="{}" x2="{}" y2="{}"/>"#,
            a.x, a.y, b.x, b.y
        );
    }
    let Some(id) = doc.selection.get() else {
        return out;
    };
    doc.track(&id);
    match doc.read(|m| (m.bounds(&id), m.route(&id))) {
        (Some(b), _) => {
            let (p, w, h) = (to(b.origin()), b.width * z, b.height * z);
            let _ = write!(
                out,
                r#"<rect class="sel-box" x="{}" y="{}" width="{}" height="{}"/>"#,
                p.x - 0.5,
                p.y - 0.5,
                w + 1.0,
                h + 1.0
            );
            for (hx, hy) in [
                (0.0, 0.0),
                (0.5, 0.0),
                (1.0, 0.0),
                (1.0, 0.5),
                (1.0, 1.0),
                (0.5, 1.0),
                (0.0, 1.0),
                (0.0, 0.5),
            ] {
                let _ = write!(
                    out,
                    r#"<rect class="handle" x="{}" y="{}" width="7" height="7"/>"#,
                    p.x + w * hx - 3.5,
                    p.y + h * hy - 3.5
                );
            }
            if view.moving.get() {
                let text = format!("{} × {}", b.width.round(), b.height.round());
                let width = text.chars().count() as f64 * 6.0 + 10.0;
                let (cx, cy) = (p.x + w / 2.0, p.y + h + 16.0);
                let _ = write!(
                    out,
                    r#"<rect class="chip" x="{}" y="{}" width="{width}" height="16" rx="2"/><text class="chip-text" x="{cx}" y="{}">{text}</text>"#,
                    cx - width / 2.0,
                    cy - 8.0,
                    cy + 0.5
                );
            }
        }
        (None, Some(route)) => {
            let d: String = route
                .iter()
                .enumerate()
                .map(|(i, p)| {
                    let p = to(*p);
                    format!("{}{} {}", if i == 0 { 'M' } else { 'L' }, p.x, p.y)
                })
                .collect();
            let _ = write!(out, r#"<path class="sel-route" d="{d}"/>"#);
        }
        (None, None) => {}
    }
    out
}

/// Returns tick marks and labels for one ruler, with the selection's extent highlighted.
fn ruler(doc: DocState, view: ViewState, horizontal: bool) -> String {
    let (o, z, size) = (view.origin.get(), view.zoom.get(), view.size.get());
    let (offset, length) = if horizontal {
        (o.x, size.width)
    } else {
        (o.y, size.height)
    };
    let minor = [5.0, 10.0, 20.0, 50.0, 100.0]
        .into_iter()
        .find(|m| m * z >= 6.0)
        .unwrap_or(200.0);
    let major = [50.0, 100.0, 200.0, 500.0, 1000.0]
        .into_iter()
        .find(|m| m * z >= 60.0)
        .unwrap_or(2000.0);
    let mut out = String::new();
    if let Some(id) = doc.selection.get() {
        doc.track(&id);
        if let Some(b) = doc.read(|m| m.bounds(&id)) {
            let (a, len) = if horizontal {
                (offset + b.x * z, b.width * z)
            } else {
                (offset + b.y * z, b.height * z)
            };
            let _ = if horizontal {
                write!(
                    out,
                    r#"<rect class="band" x="{a}" y="0" width="{len}" height="{RULER}"/><line class="band-edge" x1="{a}" x2="{a}" y1="0" y2="{RULER}"/><line class="band-edge" x1="{0}" x2="{0}" y1="0" y2="{RULER}"/>"#,
                    a + len
                )
            } else {
                write!(
                    out,
                    r#"<rect class="band" x="0" y="{a}" width="{RULER}" height="{len}"/><line class="band-edge" y1="{a}" y2="{a}" x1="0" x2="{RULER}"/><line class="band-edge" y1="{0}" y2="{0}" x1="0" x2="{RULER}"/>"#,
                    a + len
                )
            };
        }
    }
    let mut v = (-offset / z / minor).floor() * minor;
    while v <= (length - offset) / z {
        let p = (offset + v * z).round() + 0.5;
        let is_major = (v % major).abs() < 1e-6;
        let tick = if is_major {
            RULER
        } else if (v % (major / 2.0)).abs() < 1e-6 {
            8.0
        } else {
            4.0
        };
        let _ = if horizontal {
            write!(
                out,
                r#"<line x1="{p}" x2="{p}" y1="{}" y2="{RULER}"/>"#,
                RULER - tick
            )
        } else {
            write!(
                out,
                r#"<line y1="{p}" y2="{p}" x1="{}" x2="{RULER}"/>"#,
                RULER - tick
            )
        };
        if is_major {
            let _ = if horizontal {
                write!(out, r#"<text x="{}" y="10">{v}</text>"#, p + 3.0)
            } else {
                write!(
                    out,
                    r#"<text transform="translate(10 {}) rotate(-90)" text-anchor="end">{v}</text>"#,
                    p + 3.0
                )
            };
        }
        v += minor;
    }
    out
}
