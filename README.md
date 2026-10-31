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
| `ALLOWED_GITHUB_IDS` | The numeric GitHub user ids that may sign in, separated by commas. `gh api users/<login> --jq .id` prints an account's id |
| `POSTGRES_PASSWORD` | A URL-safe database password, such as a random hex string |

Compose keeps PostgreSQL in the `database` volume and does not expose its port. For an existing database, run the app image with `DATABASE_URL` instead of the Compose database service. Production startup requires HTTPS, OAuth credentials, and either `ALLOWED_GITHUB_IDS` or `ALLOW_ANY_GITHUB_ACCOUNT=true`. Accounts have no storage quotas, so `ALLOW_ANY_GITHUB_ACCOUNT=true` lets any GitHub user fill the database. Removing an id from `ALLOWED_GITHUB_IDS` ends that account's sessions and MCP access when the server restarts. `/api/health` checks the database connection.

Back up the PostgreSQL database, including image bytes. Test restoring backups to a separate database. The server expires trash after 30 days and removes unreferenced images after a grace period. Referenced images in the Trash are retained. Individual image uploads are limited to 5 MiB.

To run the production bundle without Docker, run `yarn build:app` and `yarn build:server`, set the server environment, and run `yarn serve`.

## Repository layout

- `setsquare-app/` is the Setsquare web app.
- `setsquare-server/` owns authentication, PostgreSQL persistence, and static hosting.
- `packages/setsquare/` is the editor component that the app embeds.
- `packages/common/`, `packages/element/`, `packages/math/`, and `packages/utils/` hold the code the editor builds on.
- `packages/mermaid-to-setsquare/` converts Mermaid diagrams into Setsquare elements.

## Remote MCP with OAuth

The account server exposes a Streamable HTTP MCP endpoint at **`https://your-setsquare-host/mcp`**. Add this URL to an MCP client that supports OAuth. It discovers the authorization endpoints, registers itself, opens GitHub sign-in when necessary, and asks you to approve access to your Setsquare account. No GitHub token is shared with the client. Accounts and `APP_ORIGIN` must be configured as described above.

The remote MCP operates on **saved account drawings**, including when no browser editor is open. Read before updating: an open editor with older content will encounter the existing revision conflict handling on its next save. Browser-local and desktop drawings must be imported into an account to use this endpoint.

| Tools | Purpose |
| --- | --- |
| `list_workspace` | Search and paginate drawing/folder metadata; optionally include Trash. |
| `get_drawing`, `create_drawing`, `update_drawing` | Read, create, and atomically update native drawing content. |
| `rename_drawing`, `duplicate_drawing` | Rename with a revision check, or copy a drawing and its image references. |
| `create_folder`, `rename_folder`, `move_item` | Organize drawings and folders. |
| `trash_item`, `restore_item` | Reversible removal and recovery; Trash expires after 30 days. |
| `get_images`, `upload_images` | Read and upload account-owned image assets. |
| `get_drawing_preview` | Return the saved thumbnail when its revision matches the drawing. |

`setsquare://schema/drawing` publishes the native content schema. `setsquare://drawings/{drawingId}` exposes a drawing as an MCP resource. Creating and updating content uses the same validation as browser saves, including image ownership checks. `update_drawing` replaces the complete content: preserve untouched elements and fields from `get_drawing`. The remote endpoint does not run the browser's layout, Mermaid conversion, or image renderer; `get_drawing_preview` reports when a current saved thumbnail is unavailable. The live desktop MCP below provides editor operations and rendering.

Each workspace mutation requires a unique `requestId`. Retry an uncertain request with the same ID **and arguments**. Receipts persist across restarts for 30 days. Updates and renames also require `baseRevision` from `get_drawing`. A conflict returns `isError: true` and the latest metadata; read the drawing again, reapply the intended change, and use a fresh request ID. Image uploads use image ID/version checks instead of mutation receipts.

OAuth uses authorization code grants with mandatory **S256 PKCE**, exact registered redirect URIs, and the resource/audience `${APP_ORIGIN}/mcp`. Both authorization and token requests must include `resource`. The supported scopes are `drawings:read` and `drawings:write`; read access is required, and editing needs both. The initial MCP challenge advertises both scopes. When a client requests both, the consent screen lets you choose **Read only** or **Read and edit**, with the requested access selected initially. The token receives only the permissions you approve. Requests that omit `scope` default to read-only, and consent cannot grant permissions the client did not request. A read-only token receives a `403` scope challenge for writes. Client registration supports public clients (`token_endpoint_auth_method: "none"`) and confidential clients (`client_secret_basic` or `client_secret_post`). Dynamic registration is limited to 30 registrations per source IP per hour. Client ID Metadata Documents are not advertised or fetched.

Access tokens expire after 15 minutes. Refresh tokens rotate on use; replay revokes the grant. A grant lasts at most 30 days, then requires approval again. Codes expire after five minutes, can be exchanged once, and are bound to the client, redirect URI, resource, and PKCE verifier. Tokens and client secrets are hashed in PostgreSQL. **Account menu → Connected clients** opens `/oauth/connections`, where you can revoke a client's grant immediately. Clients may also use `/oauth/revoke`.

Expose `/mcp`, `/oauth/*`, and `/.well-known/*` through the same HTTPS reverse proxy as the app, preserving the public `Host` and `Authorization` headers. Discovery lives at `/.well-known/oauth-protected-resource/mcp` (also available at the root protected-resource path) and `/.well-known/oauth-authorization-server`. The development proxy and service-worker navigation exclusions include these routes. Non-browser clients need no CORS setting; browser clients from other origins require the exact origins in `MCP_ALLOWED_ORIGINS`. Do not cache OAuth or MCP responses. The transport uses the official MCP SDK, serves both current and legacy Streamable HTTP clients, and requires no in-memory session affinity.

For local development, use `http://localhost:3001/mcp` with the account API proxy enabled. To inspect discovery:

```sh
curl -i http://localhost:3001/mcp
curl http://localhost:3001/.well-known/oauth-protected-resource/mcp
curl http://localhost:3001/.well-known/oauth-authorization-server
```

The first request should return `401` and a `WWW-Authenticate` discovery challenge. HTTP/protocol tests run with `yarn workspace setsquare-server test tests/mcp.test.ts`; the real PostgreSQL authorization and persistence tests run with `yarn workspace setsquare-server test tests/mcp-oauth.test.ts` and the same `TEST_DATABASE_URL` setting as the other backend tests.

## Agent access (desktop)

Run the desktop app with `yarn tauri dev`, then choose **Setsquare → Agent access… → Enable agent access**. Add the displayed URL to your MCP client's Streamable HTTP configuration, with an `Authorization: Bearer <token>` header. **Copy connection settings** copies the URL and headers as JSON.

The desktop server listens on `127.0.0.1` and operates on the drawing in the open window. Access lasts until you disable it or quit. Each activation gets a new port and token; reconnect using the new settings. The same settings are saved in `mcp-connection.json` in the app's configuration directory (shown in the dialog), with owner-only permissions on Unix. Disabling access removes that file. This is separate from the account server's OAuth MCP endpoint above.

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
