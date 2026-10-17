//! The drawing the app opens with until it can load files.

use setsquare_core::{Cell, CellId, Change, Document, Model, Page, PageSettings, Rect, Size};

/// A style preset: a fill and stroke pair for light and dark themes.
pub struct Swatch {
    pub name: &'static str,
    pub fill: &'static str,
    pub stroke: &'static str,
}

/// The inspector's style presets, matching design/tokens.md.
pub const SWATCHES: [Swatch; 6] = [
    Swatch {
        name: "Mist",
        fill: "light-dark(#DCEBF2,#1E3440)",
        stroke: "light-dark(#3C7A93,#6FB3CF)",
    },
    Swatch {
        name: "Sage",
        fill: "light-dark(#E1EEDD,#22362A)",
        stroke: "light-dark(#5B8A4E,#8DC07E)",
    },
    Swatch {
        name: "Ochre",
        fill: "light-dark(#F7EACB,#3A3220)",
        stroke: "light-dark(#A07617,#D9B05A)",
    },
    Swatch {
        name: "Rose",
        fill: "light-dark(#F6DEDC,#40292A)",
        stroke: "light-dark(#A54B48,#E08F8B)",
    },
    Swatch {
        name: "Lilac",
        fill: "light-dark(#E9E2F2,#312B41)",
        stroke: "light-dark(#6E5A99,#B7A2E0)",
    },
    Swatch {
        name: "Stone",
        fill: "light-dark(#EDEEEA,#2C322F)",
        stroke: "light-dark(#6B6E66,#A3ABA5)",
    },
];

const TEXT: &str = "fontColor=light-dark(#1F2421,#E2E8E3);";
const EDGE: &str = "edgeStyle=orthogonalEdgeStyle;html=1;endArrow=block;endFill=1;strokeColor=light-dark(#4A514C,#AEB8B1);fontSize=11;";

fn swatch(name: &str) -> String {
    let s = SWATCHES
        .iter()
        .find(|s| s.name == name)
        .unwrap_or(&SWATCHES[5]);
    format!("fillColor={};strokeColor={};{TEXT}", s.fill, s.stroke)
}

/// Returns the Greendale enrollment drawing.
pub fn document() -> Document {
    let layer = CellId::new("1");
    let vertex =
        |name: &str, parent: &CellId, r: (f64, f64, f64, f64), label: &str, style: String| {
            Cell::vertex(
                CellId::new(name),
                parent.clone(),
                Rect::new(r.0, r.1, r.2, r.3),
            )
            .with_label(label)
            .with_style(&style)
        };
    let edge = |from: &str, to: &str, label: &str| {
        Cell::edge(
            CellId::new(format!("{from}-{to}")),
            layer.clone(),
            CellId::new(from),
            CellId::new(to),
        )
        .with_label(label)
        .with_style(&format!("{EDGE}{TEXT}"))
    };
    let backend = CellId::new("backend");
    let cells = vec![
        vertex(
            "backend",
            &layer,
            (450.0, 20.0, 390.0, 520.0),
            "Enrollment backend",
            format!(
                "swimlane;html=1;startSize=28;align=left;spacingLeft=10;fontStyle=1;{}",
                swatch("Stone")
            ),
        ),
        vertex(
            "student",
            &layer,
            (20.0, 75.0, 40.0, 70.0),
            "Student",
            format!(
                "shape=umlActor;html=1;verticalLabelPosition=bottom;verticalAlign=top;strokeColor=light-dark(#1F2421,#E2E8E3);{TEXT}"
            ),
        ),
        vertex(
            "portal",
            &layer,
            (100.0, 80.0, 130.0, 60.0),
            "Student portal",
            format!("rounded=1;whiteSpace=wrap;html=1;{}", swatch("Mist")),
        ),
        vertex(
            "gateway",
            &layer,
            (280.0, 80.0, 120.0, 60.0),
            "API gateway",
            format!("whiteSpace=wrap;html=1;{}", swatch("Stone")),
        ),
        vertex(
            "note",
            &layer,
            (100.0, 230.0, 210.0, 90.0),
            "Seats open up when a<br>student drops a class before<br>the add/drop deadline.",
            format!(
                "shape=note;whiteSpace=wrap;html=1;size=14;{}",
                swatch("Ochre")
            ),
        ),
        vertex(
            "enroll",
            &backend,
            (20.0, 60.0, 150.0, 60.0),
            "Enrollment service",
            format!("whiteSpace=wrap;html=1;{}", swatch("Mist")),
        ),
        vertex(
            "seat",
            &backend,
            (40.0, 170.0, 110.0, 80.0),
            "Seat open?",
            format!("rhombus;whiteSpace=wrap;html=1;{}", swatch("Ochre")),
        ),
        vertex(
            "registrar",
            &backend,
            (260.0, 160.0, 100.0, 100.0),
            "Registrar DB",
            format!("shape=cylinder3;whiteSpace=wrap;html=1;{}", swatch("Sage")),
        ),
        vertex(
            "waitlist",
            &backend,
            (20.0, 300.0, 150.0, 60.0),
            "Waitlist queue",
            format!(
                "shape=cylinder3;direction=south;whiteSpace=wrap;html=1;{}",
                swatch("Lilac")
            ),
        ),
        vertex(
            "notify",
            &backend,
            (240.0, 300.0, 140.0, 60.0),
            "Notification<br>service",
            format!("whiteSpace=wrap;html=1;{}", swatch("Mist")),
        ),
        vertex(
            "email",
            &backend,
            (240.0, 420.0, 140.0, 70.0),
            "Email to student",
            format!("shape=document;whiteSpace=wrap;html=1;{}", swatch("Rose")),
        ),
        edge("student", "portal", ""),
        edge("portal", "gateway", "HTTPS"),
        edge("gateway", "enroll", "enroll"),
        edge("enroll", "seat", ""),
        edge("seat", "registrar", "Yes"),
        edge("seat", "waitlist", "No"),
        edge("waitlist", "notify", "seat freed"),
        edge("notify", "email", ""),
    ];
    let mut model = Model::new();
    let setup = Change::Batch(vec![
        Change::SetLabel {
            cell: layer.clone(),
            label: "Services".into(),
        },
        Change::Insert {
            cells: cells.into_iter().map(|c| (c, usize::MAX)).collect(),
        },
    ]);
    if let Err(err) = model.apply(setup) {
        leptos::logging::error!("sample drawing is invalid: {err}");
    }
    let settings = PageSettings {
        page_size: Size::new(1169.0, 827.0),
        ..PageSettings::default()
    };
    Document::new(Page {
        id: "enrollment".into(),
        name: "Enrollment flow".into(),
        settings,
        model,
    })
}

/// The drawing's name, shown in the title block.
pub const NAME: &str = "Greendale enrollment system";
