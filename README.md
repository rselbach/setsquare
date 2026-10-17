# Setsquare

Setsquare is a diagram editor written in Rust. It aims for full feature parity with [draw.io](https://github.com/jgraph/drawio) under its own interface, and it runs in the browser first.

The project is at its first milestone. The web app opens a sample drawing that you can select, drag with snapping, restyle, resize from the inspector, add to from the shape library, and undo. It cannot open or save `.drawio` files yet.

## Repository layout

- `crates/setsquare-core` holds the diagram model: the cell tree of each page, draw.io style strings, geometry, built-in shapes, and undoable changes. It has no dependencies and no browser code.
- `crates/setsquare-web` holds the web app, built with [Leptos](https://leptos.dev) and compiled to WebAssembly.
- `design/` holds the interface design: its rationale, the design tokens, and an interactive HTML mockup.
- `docs/parity/drawio-inventory.md` lists draw.io's features with source citations. It is the checklist for parity.

## Build and run

You need [rustup](https://rustup.rs), [trunk](https://trunkrs.dev), and [just](https://just.systems). The pinned toolchain in `rust-toolchain.toml` installs the `wasm32-unknown-unknown` target on first use.

```sh
cargo install trunk --locked
just dev
```

`just dev` serves the app at `http://127.0.0.1:8080` and rebuilds on every change. Run `just` to list the other tasks:

| Task | What it does |
| --- | --- |
| `just test` | Runs the core tests. |
| `just lint` | Checks formatting and runs clippy on both crates. |
| `just build` | Builds the web app for release into `crates/setsquare-web/dist`. |
| `just check` | Runs lint, tests, and the release build. |
