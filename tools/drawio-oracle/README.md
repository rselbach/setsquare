# draw.io oracle

These tools record how draw.io itself routes and paints connectors, so Setsquare's
tests can compare against it.

- `make_corpus.py` writes the test drawings in
  `crates/setsquare-core/tests/fixtures/routing`. Each one covers one part of connector
  geometry: perimeters, connection points, edge styles, and arrowheads.
- `oracle.sh` renders every drawing in `tests/fixtures/routing` and
  `tests/fixtures/templates` with draw.io's viewer, pinned to commit `9034053fba`, and
  writes `<name>.oracle.tsv` next to each drawing.
- `harness.html` is the page `oracle.sh` loads. It decodes each page into a draw.io
  `Graph` and reports each connector's points and painted SVG elements.

To change the test drawings, edit `make_corpus.py`, then regenerate both sets of files:

```sh
python3 tools/drawio-oracle/make_corpus.py
tools/drawio-oracle/oracle.sh
```

`oracle.sh` needs python3, curl, and playwright-cli. It downloads draw.io's viewer once
into `~/.cache/setsquare`.

The `.oracle.tsv` format has two kinds of rows. A `route` row holds a connector's
points as draw.io computed them. A `path` row holds one SVG element draw.io painted
for it: the line first, then each arrowhead. Elements other than paths are written as
their tag and geometry, such as `ellipse cx cy rx ry`.
