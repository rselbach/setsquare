# Setsquare tasks. Run `just` to list them.

default:
    @just --list

# Serve the web app with live reload at http://127.0.0.1:8080
dev:
    cd crates/setsquare-web && trunk serve

# Build the web app for release into crates/setsquare-web/dist
build:
    cd crates/setsquare-web && trunk build --release

# Run the core tests
test:
    cargo test -p setsquare-core

# Check formatting and lints for both crates
lint:
    cargo fmt --all --check
    cargo clippy -p setsquare-core --all-targets -- -D warnings
    cargo clippy -p setsquare-web --target wasm32-unknown-unknown -- -D warnings

# Format all code
fmt:
    cargo fmt --all

# Run lints, tests, and a release build
check: lint test build
