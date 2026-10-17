#!/usr/bin/env bash
# Asks draw.io how it routes and draws every connector in the routing and
# template fixtures, and writes the answers next to each drawing as
# <name>.oracle.tsv.
# Needs python3, curl, and playwright-cli. Run it from anywhere:
#   tools/drawio-oracle/oracle.sh

set -euo pipefail

readonly DRAWIO_COMMIT="9034053fba80a435e27d68d374bc564b83917ae9"
readonly VIEWER_URL="https://raw.githubusercontent.com/jgraph/drawio/${DRAWIO_COMMIT}/src/main/webapp/js/viewer-static.min.js"
server_pid=""

fetch_viewer() {
  local cache="$1"
  if [[ ! -s "${cache}/viewer-static.min.js" ]]; then
    mkdir -p "${cache}"
    curl -fsSL "${VIEWER_URL}" -o "${cache}/viewer-static.min.js"
  fi
}

free_port() {
  python3 -I -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'
}

# Writes a playwright-cli script that routes every fixture and returns one JSON object
# keyed by each drawing's path without its extension.
write_script() {
  local fixtures="$1" port="$2" out="$3"
  python3 -I - "${fixtures}" "${port}" > "${out}" <<'PY'
import json, pathlib, sys
fixtures, port = pathlib.Path(sys.argv[1]), sys.argv[2]
files = {str(p.with_suffix("")): p.read_text() for d in ("routing", "templates") for p in sorted((fixtures / d).glob("*.drawio"))}
print("async page => {")
print("  const ctx = await page.context().browser().newContext({ viewport: { width: 1600, height: 1200 } });")
print("  const p = await ctx.newPage();")
print(f"  await p.goto('http://127.0.0.1:{port}/harness.html');")
print("  await p.waitForFunction(() => window.ready === true, null, { timeout: 60000 });")
print(f"  const files = {json.dumps(files)};")
print("  const out = {};")
print("  for (const [name, text] of Object.entries(files)) out[name] = await p.evaluate(t => window.route(t), text);")
print("  await ctx.close();")
print("  return JSON.stringify(out);")
print("}")
PY
}

main() {
  local root fixtures cache www port script result session
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  fixtures="${root}/crates/setsquare-core/tests/fixtures"
  cache="${XDG_CACHE_HOME:-${HOME}/.cache}/setsquare/drawio-${DRAWIO_COMMIT}"
  www="$(mktemp -d)"
  script="$(mktemp)"
  result="$(mktemp)"
  session="drawio-oracle-$$"
  port="$(free_port)"

  fetch_viewer "${cache}"
  cp "${cache}/viewer-static.min.js" "${root}/tools/drawio-oracle/harness.html" "${www}/"
  python3 -I -m http.server "${port}" --bind 127.0.0.1 --directory "${www}" > /dev/null 2>&1 &
  server_pid=$!
  # Expand now: the locals are gone when the trap runs.
  # shellcheck disable=SC2064
  trap "kill ${server_pid} 2> /dev/null; playwright-cli -s='${session}' close > /dev/null 2>&1; rm -rf '${www}' '${script}' '${result}'" EXIT
  sleep 1

  write_script "${fixtures}" "${port}" "${script}"
  # playwright-cli keeps session files in the working directory, so stay in the temp dir.
  cd "${www}"
  playwright-cli -s="${session}" open about:blank > /dev/null
  playwright-cli -s="${session}" --raw run-code --filename="${script}" > "${result}"

  python3 -I - "${result}" <<'PY'
import json, pathlib, sys
raw = pathlib.Path(sys.argv[1]).read_text()
data = json.loads(json.loads(raw))
for name, pages in data.items():
    path = pathlib.Path(f"{name}.oracle.tsv")
    rows = ["# draw.io 9034053fba. route: page, edge, points. label: page, edge, point. "
            "path: page, edge, index, fill, dash, width, d. bounds: page, vertex, x y width height"]
    for i, page in enumerate(pages):
        for vertex, b in page["vertices"].items():
            rows.append(f"bounds\t{i}\t{vertex}\t{b[0]} {b[1]} {b[2]} {b[3]}")
        for edge, info in page["edges"].items():
            points = " ".join("null" if p is None else f"{p[0]},{p[1]}" for p in info["points"])
            rows.append(f"route\t{i}\t{edge}\t{points}")
            rows.append(f"label\t{i}\t{edge}\t{info['label'][0]},{info['label'][1]}")
            for n, d in enumerate(info["paths"]):
                rows.append(f"path\t{i}\t{edge}\t{n}\t{d['fill'] or '-'}\t{d['dash'] or '-'}\t{d['width'] or '-'}\t{d['d']}")
    path.write_text("\n".join(rows) + "\n")
    edges = sum(len(p["edges"]) for p in pages)
    print(f"{path.name}: {len(pages)} pages, {edges} connectors", file=sys.stderr)
PY
}

main "$@"
