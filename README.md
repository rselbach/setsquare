# Setsquare

Setsquare is a diagram tool that runs in your browser.

## Run it locally

You need Node.js 18 or later and Yarn 1.

```sh
yarn install
yarn start
```

The app opens at `http://localhost:3001`.

## Repository layout

- `setsquare-app/` is the Setsquare web app.
- `packages/setsquare/` is the editor component that the app embeds.
- `packages/common/`, `packages/element/`, `packages/math/`, and `packages/utils/` hold the code the editor builds on.
- `packages/mermaid-to-setsquare/` converts Mermaid diagrams into Setsquare elements.

## Agent access (desktop)

Run the desktop app with `yarn tauri dev`, then choose **Setsquare → Agent access… → Enable agent access**. Add the displayed URL to your MCP client's Streamable HTTP configuration, with an `Authorization: Bearer <token>` header. **Copy connection settings** copies the URL and headers as JSON.

The server listens on `127.0.0.1` and operates on the drawing in the open window. Access lasts until you disable it or quit. Each activation gets a new port and token; reconnect using the new settings. The same settings are saved in `mcp-connection.json` in the app's configuration directory (shown in the dialog), with owner-only permissions on Unix. Disabling access removes that file. The browser version does not start an MCP server.

| Tool | What it does |
| --- | --- |
| `get_document` | Reads the document ID, revision, selection, shapes, labels, and connections. |
| `apply_operations` | Creates shapes or text, moves or resizes shapes, changes labels or styles, connects shapes, and deletes elements. A batch is one undo step. |
| `import_mermaid` | Appends a diagram using the built-in Mermaid converter. |
| `render_document` | Returns a PNG for visual inspection, with the rendered document ID and revision. |
| `set_view` | Selects and fits elements in the viewport. |
| `new_document` | Starts a named drawing. |
| `open_document` | Opens an absolute `.setsquare` file path. |
| `save_document` | Writes the drawing to an absolute `.setsquare` file path. |

Start with `get_document`. Pass its `documentId` and `revision` as `baseRevision` to each mutation, along with a fresh `requestId`. For example, the operations in one `apply_operations` call can be:

```json
[
  {
    "kind": "create",
    "id": "troy",
    "type": "rectangle",
    "x": 0,
    "y": 0,
    "width": 160,
    "height": 80,
    "label": "Troy Barnes"
  },
  {
    "kind": "create",
    "id": "abed",
    "type": "ellipse",
    "x": 350,
    "y": 0,
    "width": 160,
    "height": 80,
    "label": "Abed Nadir"
  },
  {
    "kind": "connect",
    "fromId": "troy",
    "toId": "abed",
    "label": "Dreamatorium"
  }
]
```

Coordinates are canvas units. Supplied element IDs can be referenced by later operations in the same batch. Read the tool schemas for supported fields and limits. A stale revision rejects the edit; read the document again and apply the intended change to its current state. Retry an uncertain call with the same arguments and `requestId`: the last 100 completed mutations are retained for that editor session.

Edits are persisted to local recovery storage even with the window hidden. Check `persisted` and `persistenceError` in mutation results. Use `save_document` to write an actual drawing file; existing files require `overwrite: true`. Starting or opening a drawing over a nonempty canvas requires `replace: true`. New/open operations start a new undo history.

The TypeScript command layer lives in `packages/setsquare/automation/`. `setsquare-app/desktop/AgentAccess.tsx` connects it to Tauri, and `setsquare-app/src-tauri/src/mcp/` hosts the Rust MCP transport. Tool schemas come from the same Zod definitions used to validate editor commands.

## Check your changes

`yarn test:all` runs the type check, ESLint, Prettier, and the Vitest suite.

## License

Setsquare is released under the MIT license. See [LICENSE](LICENSE).
