use std::fs;
use std::path::Path;

use setsquare_core::drawio;

#[test]
fn reads_and_round_trips_draw_io_templates() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/templates");
    let mut read = 0;
    for entry in fs::read_dir(&dir).expect("fixtures directory") {
        let path = entry.expect("fixture entry").path();
        if path.extension().is_none_or(|e| e != "drawio") {
            continue;
        }
        let name = path.display();
        let text = fs::read_to_string(&path).unwrap_or_else(|e| panic!("{name}: {e}"));
        let doc = drawio::read(&text).unwrap_or_else(|e| panic!("{name}: {e}"));
        let cells: usize = doc.pages().iter().map(|p| p.model.len()).sum();
        assert!(cells > 3, "{name}: only {cells} cells");
        let again =
            drawio::read(&drawio::write(&doc)).unwrap_or_else(|e| panic!("{name}: rereading: {e}"));
        assert_eq!(again, doc, "{name}: changed after a round trip");
        read += 1;
    }
    assert_eq!(read, 4, "expected four fixtures");
}
