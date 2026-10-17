//! draw.io's stylesheet: the default vertex and edge styles and the named styles, such as
//! `ellipse` or `edgeLabel`, that a cell's style string can refer to.
//!
//! A cell's effective style starts from the default vertex or edge style, applies each
//! named style in order, then applies the cell's own keys. A key set to `none` is removed,
//! and a removed color means "do not paint".

use std::collections::HashMap;
use std::sync::LazyLock;

use quick_xml::Reader;
use quick_xml::events::Event;

use crate::style::Style;

/// Named styles, each an ordered list of key and value pairs.
#[derive(Debug)]
pub struct Stylesheet {
    styles: HashMap<String, Vec<(String, String)>>,
}

static DRAWIO: LazyLock<Stylesheet> = LazyLock::new(|| {
    Stylesheet::parse(include_str!("../assets/drawio-default.xml"))
        .expect("the bundled draw.io stylesheet parses")
});

impl Stylesheet {
    /// Returns draw.io's default stylesheet.
    pub fn drawio() -> &'static Stylesheet {
        &DRAWIO
    }

    /// Parses an `mxStylesheet` document. A style that extends another starts with the
    /// other style's pairs.
    pub fn parse(xml: &str) -> Result<Stylesheet, String> {
        let mut reader = Reader::from_str(xml);
        let mut styles: HashMap<String, Vec<(String, String)>> = HashMap::new();
        let mut current: Option<(String, Vec<(String, String)>)> = None;
        loop {
            let event = reader.read_event().map_err(|e| e.to_string())?;
            let start = match &event {
                Event::Start(e) | Event::Empty(e) if e.name().as_ref() == "add" => e,
                Event::End(e) if e.name().as_ref() == "add" => {
                    if let Some((name, pairs)) = current.take() {
                        styles.insert(name, pairs);
                    }
                    continue;
                }
                Event::Eof => break,
                _ => continue,
            };
            let attr = |key: &str| -> Result<Option<String>, String> {
                match start.try_get_attribute(key).map_err(|e| e.to_string())? {
                    Some(a) => Ok(Some(
                        a.normalized_value(quick_xml::XmlVersion::Implicit1_0)
                            .map_err(|e| e.to_string())?
                            .into_owned(),
                    )),
                    None => Ok(None),
                }
            };
            let name = attr("as")?.ok_or("an <add> element has no as attribute")?;
            match (&mut current, attr("value")?) {
                (Some((_, pairs)), Some(value)) => pairs.push((name, value)),
                (None, _) => {
                    let base = match attr("extend")? {
                        Some(parent) => styles
                            .get(&parent)
                            .cloned()
                            .ok_or(format!("{name} extends unknown style {parent}"))?,
                        None => Vec::new(),
                    };
                    if matches!(event, Event::Empty(_)) {
                        styles.insert(name, base);
                    } else {
                        current = Some((name, base));
                    }
                }
                (Some(_), None) => return Err(format!("{name} has no value")),
            }
        }
        Ok(Stylesheet { styles })
    }

    /// Returns the effective style of a cell whose own style is `style`.
    pub fn resolve(&self, style: &Style, edge: bool) -> Style {
        let mut out = Style::default();
        if !style.skips_defaults() {
            let defaults = if edge { "defaultEdge" } else { "defaultVertex" };
            for (k, v) in self.styles.get(defaults).into_iter().flatten() {
                out.set(k, v.as_str());
            }
        }
        for (key, value) in style.entries() {
            match value {
                Some("none") => out.remove(key),
                Some(v) => out.set(key, v),
                None => {
                    for (k, v) in self.styles.get(key).into_iter().flatten() {
                        out.set(k, v.as_str());
                    }
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_layers_defaults_named_styles_and_own_keys() {
        let sheet = Stylesheet::drawio();
        let tests = [
            (
                "default vertex",
                "",
                false,
                "perimeter",
                Some("rectanglePerimeter"),
            ),
            (
                "default edge has an arrow",
                "",
                true,
                "endArrow",
                Some("classic"),
            ),
            (
                "default edge is rounded",
                "html=1;",
                true,
                "rounded",
                Some("1"),
            ),
            (
                "named style sets the shape",
                "ellipse;whiteSpace=wrap;",
                false,
                "perimeter",
                Some("ellipsePerimeter"),
            ),
            (
                "own keys win",
                "ellipse;perimeter=rhombusPerimeter;",
                false,
                "perimeter",
                Some("rhombusPerimeter"),
            ),
            (
                "none removes a key",
                "endArrow=none;",
                true,
                "endArrow",
                None,
            ),
            (
                "none removes a color",
                "fillColor=none;",
                false,
                "fillColor",
                None,
            ),
            (
                "extended styles inherit",
                "edgeLabel;",
                false,
                "verticalAlign",
                Some("top"),
            ),
            (
                "leading separator skips defaults",
                ";html=1;",
                true,
                "endArrow",
                None,
            ),
        ];
        for (name, style, edge, key, want) in tests {
            let resolved = sheet.resolve(&Style::parse(style), edge);
            assert_eq!(resolved.get(key), want, "{name}");
        }
    }
}
