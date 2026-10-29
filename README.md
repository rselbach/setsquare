# Setsquare

Setsquare is a diagram tool that runs in your browser.

## Run it locally

You need Node.js 22 or later and Yarn 1. CI and Docker use Node.js 24.

```sh
yarn install
yarn start
```

The app opens at `http://localhost:3001`.

## Run with accounts

The web app supports private workspaces stored in PostgreSQL. Without an account server, drawings stay in the browser. Desktop drawing storage stays local.

1. Create a PostgreSQL database and copy the server settings.

   ```sh
   createdb setsquare
   cp setsquare-server/.env.example setsquare-server/.env.local
   ```

2. Set `DATABASE_URL` in `setsquare-server/.env.local`. For a local Unix socket, use `postgresql:///setsquare?host=/tmp`. The server applies migrations on startup. Use a dedicated database whose schema the server can manage.

3. Register a GitHub OAuth app. For local development, set its homepage to `http://localhost:3001` and callback to `http://localhost:3001/api/auth/github/callback`. Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in the server's `.env.local` file. Keep secrets out of `VITE_` variables.

4. Start the API in one terminal.

   ```sh
   yarn start:server
   ```

5. Start the frontend with its API proxy in another terminal.

   ```sh
   SETSQUARE_API_URL=http://127.0.0.1:3002 yarn start
   ```

Sign in from the workspace navigation. **Import browser drawings** copies the browser's existing folders, drawings, and images into the account. Repeating an import resumes unfinished work. It retains the browser originals.

Saves check the revision last loaded by the editor. A conflicting edit stays in local recovery and offers **Save my changes as a copy**. Recovery records and image caches are separate for each account. Open tabs also have separate draft records. The app warns before closing while recovery is not durable and offers an export if browser storage fails. Opening uncached cloud drawings requires a connection.

## Deploy the account server

The Docker image serves the frontend and API on port 3002. Put it behind an HTTPS reverse proxy and configure the OAuth callback for the public origin. Use a separate OAuth registration for development and production.

Set these environment variables before running `docker compose up --build -d`.

| Variable | Value |
| --- | --- |
| `APP_ORIGIN` | The public HTTPS origin, without a path |
| `GITHUB_CLIENT_ID` | The production OAuth app's client ID |
| `GITHUB_CLIENT_SECRET` | The production OAuth app's secret |
| `POSTGRES_PASSWORD` | A URL-safe database password, such as a random hex string |

Compose keeps PostgreSQL in the `database` volume and does not expose its port. For an existing database, run the app image with `DATABASE_URL` instead of the Compose database service. Production startup requires HTTPS and OAuth credentials. `/api/health` checks the database connection.

Back up the PostgreSQL database, including image bytes. Test restoring backups to a separate database. The server expires trash after 30 days and removes unreferenced images after a grace period. Referenced images in the Trash are retained. Individual image uploads are limited to 5 MiB.

To run the production bundle without Docker, run `yarn build:app` and `yarn build:server`, set the server environment, and run `yarn serve`.

## Repository layout

- `setsquare-app/` is the Setsquare web app.
- `setsquare-server/` owns authentication, PostgreSQL persistence, and static hosting.
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

`yarn test:all` runs type checks, ESLint, Prettier, frontend tests, and backend integration tests. Backend tests need PostgreSQL. Set `TEST_DATABASE_URL` to a test database. Without it, tests use the local `postgres` database through the `/tmp` socket. Each run creates and removes its own temporary schema.

Run `yarn test:server` for backend tests alone. They exercise real PostgreSQL and an external GitHub provider stub. Live GitHub login needs your registered OAuth app's credentials.

## License

Setsquare is released under the MIT license. See [LICENSE](LICENSE).
