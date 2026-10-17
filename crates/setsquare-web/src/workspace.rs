//! The open drawing: its pages, the page being edited, its name, and file input and output.
//!
//! The page being edited lives in [`DocState`]. The other pages wait here with their own
//! undo histories, and switching pages swaps them.

use leptos::prelude::*;
use setsquare_core::{Document, History, Page, drawio};
use wasm_bindgen::JsCast;
use wasm_bindgen::closure::Closure;

use crate::canvas::ViewState;
use crate::doc::DocState;

/// The status the title block shows in its "Saved" cell.
#[derive(Clone, Debug, PartialEq)]
pub enum SaveState {
    /// The drawing was neither opened from a file nor saved.
    Never,
    /// The drawing matches the file it was opened from.
    Opened,
    /// The drawing was saved at this clock time.
    Saved(String),
}

#[derive(Clone, Copy)]
pub struct Workspace {
    pub name: RwSignal<String>,
    pub current: RwSignal<usize>,
    pub page_names: RwSignal<Vec<String>>,
    pages: StoredValue<Vec<Page>>,
    histories: StoredValue<Vec<History>>,
    saved: RwSignal<(SaveState, u64)>,
    /// A message for the person using the app, such as why a file did not open.
    pub notice: RwSignal<Option<String>>,
}

impl Workspace {
    /// Starts with `document` and loads its first page into `doc`.
    pub fn new(doc: DocState, document: Document, name: &str) -> Workspace {
        let workspace = Workspace {
            name: RwSignal::new(name.to_owned()),
            current: RwSignal::new(0),
            page_names: RwSignal::new(Vec::new()),
            pages: StoredValue::new(Vec::new()),
            histories: StoredValue::new(Vec::new()),
            saved: RwSignal::new((SaveState::Never, 0)),
            notice: RwSignal::new(None),
        };
        workspace.load(doc, document);
        workspace
            .saved
            .set((SaveState::Never, doc.revision.get_untracked()));
        workspace
    }

    /// Replaces the drawing with `document` and shows its first page.
    pub fn open(&self, doc: DocState, view: ViewState, document: Document, name: String) {
        self.load(doc, document);
        self.name.set(name);
        self.saved
            .set((SaveState::Opened, doc.revision.get_untracked()));
        view.fit(doc);
    }

    /// Moves the first page into `doc` and keeps the rest here. The current page's slot
    /// keeps only its id and name while the page is being edited.
    fn load(&self, doc: DocState, document: Document) {
        let mut pages = document.pages().to_vec();
        let model = std::mem::take(&mut pages[0].model);
        let settings = std::mem::take(&mut pages[0].settings);
        doc.swap(model, settings, History::default());
        self.histories
            .set_value(vec![History::default(); pages.len()]);
        self.page_names
            .set(pages.iter().map(|p| p.name.clone()).collect());
        self.pages.set_value(pages);
        self.current.set(0);
    }

    /// Switches to the page at `index`, keeping each page's undo history.
    pub fn go_to(&self, doc: DocState, view: ViewState, index: usize) {
        let current = self.current.get_untracked();
        let count = self.pages.with_value(Vec::len);
        if index == current || index >= count {
            return;
        }
        let next = self.pages.try_update_value(|p| {
            (
                std::mem::take(&mut p[index].model),
                std::mem::take(&mut p[index].settings),
            )
        });
        let next_history = self
            .histories
            .try_update_value(|h| std::mem::take(&mut h[index]))
            .unwrap_or_default();
        let Some((next_model, next_settings)) = next else {
            return;
        };
        let (model, settings, history) = doc.swap(next_model, next_settings, next_history);
        self.pages.update_value(|pages| {
            pages[current].model = model;
            pages[current].settings = settings;
        });
        self.histories.update_value(|h| h[current] = history);
        self.current.set(index);
        view.fit(doc);
    }

    /// Returns the whole drawing, including unsaved edits on the current page.
    pub fn document(&self, doc: DocState) -> Document {
        let current = self.current.get_untracked();
        let mut pages = self.pages.with_value(Clone::clone);
        pages[current].model = doc.snapshot();
        pages[current].settings = doc.settings.get_untracked();
        let mut pages = pages.into_iter();
        let first = pages.next().unwrap_or_else(|| Page {
            id: "page-1".into(),
            name: "Page-1".into(),
            settings: Default::default(),
            model: Default::default(),
        });
        let mut document = Document::new(first);
        for page in pages {
            document.push_page(page);
        }
        document
    }

    /// Returns the "Saved" status text for the title block.
    pub fn save_status(&self, doc: DocState) -> String {
        let (state, at) = self.saved.get();
        let changed = doc.revision.get() != at;
        match state {
            SaveState::Never => "Not yet".to_owned(),
            _ if changed => "Unsaved changes".to_owned(),
            SaveState::Opened => "No changes".to_owned(),
            SaveState::Saved(time) => time,
        }
    }

    /// Downloads the drawing as a `.drawio` file.
    pub fn save(&self, doc: DocState) {
        let xml = drawio::write(&self.document(doc));
        let file = format!("{}.drawio", self.name.get_untracked());
        match download(&file, &xml) {
            Ok(()) => {
                let options = js_sys::Object::new();
                let _ = js_sys::Reflect::set(&options, &"hour".into(), &"numeric".into());
                let _ = js_sys::Reflect::set(&options, &"minute".into(), &"2-digit".into());
                let time = js_sys::Date::new_0()
                    .to_locale_time_string_with_options("default", &options)
                    .as_string()
                    .unwrap_or_default();
                self.saved
                    .set((SaveState::Saved(time), doc.revision.get_untracked()));
                self.notice
                    .set(Some(format!("Saved {file} to your downloads.")));
            }
            Err(err) => self.notice.set(Some(format!(
                "Couldn't save {file}. The browser refused the download: {err}"
            ))),
        }
    }

    /// Reads `file` and opens it, or explains why it can't be opened.
    pub fn open_file(&self, doc: DocState, view: ViewState, file: web_sys::File) {
        let workspace = *self;
        let file_name = file.name();
        let Ok(reader) = web_sys::FileReader::new() else {
            return;
        };
        let source = reader.clone();
        let onload = Closure::once(move |_: web_sys::ProgressEvent| {
            let text = source
                .result()
                .ok()
                .and_then(|r| r.as_string())
                .unwrap_or_default();
            match drawio::read(&text) {
                Ok(document) => {
                    let name = file_name
                        .rsplit_once('.')
                        .map_or(file_name.as_str(), |(stem, _)| stem)
                        .to_owned();
                    workspace.open(doc, view, document, name);
                    workspace.notice.set(None);
                }
                Err(err) => workspace.notice.set(Some(format!(
                    "Couldn't open {file_name}. {}.",
                    capitalize(&err.to_string())
                ))),
            }
        });
        reader.set_onload(Some(onload.as_ref().unchecked_ref()));
        onload.forget();
        if reader.read_as_text(&file).is_err() {
            self.notice.set(Some(format!(
                "Couldn't read {}. The browser refused to open it.",
                file.name()
            )));
        }
    }
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    chars
        .next()
        .map_or_else(String::new, |c| c.to_uppercase().chain(chars).collect())
}

fn download(file: &str, text: &str) -> Result<(), String> {
    let error = |e: wasm_bindgen::JsValue| e.as_string().unwrap_or_else(|| format!("{e:?}"));
    let parts = js_sys::Array::of1(&wasm_bindgen::JsValue::from_str(text));
    let options = web_sys::BlobPropertyBag::new();
    options.set_type("application/vnd.jgraph.mxfile");
    let blob = web_sys::Blob::new_with_str_sequence_and_options(&parts, &options).map_err(error)?;
    let url = web_sys::Url::create_object_url_with_blob(&blob).map_err(error)?;
    let document = web_sys::window()
        .and_then(|w| w.document())
        .ok_or("no document")?;
    let link: web_sys::HtmlAnchorElement = document
        .create_element("a")
        .map_err(error)?
        .unchecked_into();
    link.set_href(&url);
    link.set_download(file);
    link.click();
    web_sys::Url::revoke_object_url(&url).map_err(error)
}
