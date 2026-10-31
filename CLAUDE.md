# CLAUDE.md

@AGENTS.md

## Repository layout

Setsquare is a Yarn 1 workspaces monorepo. `README.md` covers setup, deployment, and the MCP endpoints in detail.

- `setsquare-app/` is the web app, built with Vite.
  - `web/` holds routing, drawing saves, account controls, and imports.
  - `workspace/` holds the workspace types, the UI in `ui/`, the browser store in `local/`, and the account-server store in `remote/`. `workspace/api.ts` defines the API types shared with the server.
  - `editor/` holds `EditorShell`, the editor for one scene, and the `ScenePersistence` interface it loads and saves through.
  - `tests/` holds the app tests. `tests/workspace/fakeAccountServer.ts` is an in-memory account server for web tests. It imports server modules such as `src/validation.ts`, so a server change can break web tests.
- `setsquare-server/` is the account server: Fastify and PostgreSQL, GitHub sign-in, workspaces, the `/mcp` endpoint in `src/mcp/`, and its OAuth server.
  - `src/config.ts` parses the environment. `.env.example` lists the local settings. The README table under "Deploy the account server" lists the production settings, such as `TRUST_PROXY`.
  - `migrations/` holds the SQL migrations. The server discovers them from disk and stores a SHA-256 checksum for each applied file. It refuses to start if an applied file changes or disappears. Never edit, rename, or delete a migration that has shipped. Add a new file with the next number, such as `007-description.sql`.
- `packages/` holds the editor and the libraries it builds on:
  - `setsquare/` is the editor component, `@setsquare/setsquare`.
  - `common/`, `element/`, `math/`, `utils/`, `fractional-indexing/`, and `laser-pointer/` are its libraries.
  - `mermaid-to-setsquare/` converts Mermaid diagrams into Setsquare elements.
- `examples/` holds the Next.js and browser-script integration examples.
- `.claude/skills/deploy-web/` is the only supported way to deploy production.

The desktop app is legacy code due for removal. Don't build on it or extend it. It consists of `setsquare-app/desktop/`, the Tauri app in `setsquare-app/src-tauri/`, and `packages/setsquare/automation/`, which only its local MCP server uses. No CI job builds the Tauri app or runs its Rust tests.

## Check your changes

Run `yarn test:all` before you commit. It runs, in order:

1. `yarn test:typecheck`: `tsc` on `packages/` and `setsquare-app/`.
2. `yarn test:server:typecheck`: `tsc` on `setsquare-server/`.
3. `yarn test:code`: ESLint with `--max-warnings=0`.
4. `yarn test:other`: Prettier `--list-different`.
5. `yarn test:app --watch=false`: Vitest on `packages/` and `setsquare-app/`.
6. `yarn test:server`: Vitest on `setsquare-server/`.

The server tests need PostgreSQL. Set `TEST_DATABASE_URL` to a database where the tests can create schemas. Without it, they connect to `postgresql:///postgres?host=/tmp`. The tests create temporary schemas and drop them afterwards.

For a narrow change, run only the matching checks:

- Web app or packages: `yarn test:typecheck` and `yarn test:app --watch=false`.
- Server: `yarn test:server:typecheck` and `yarn test:server`.

`yarn test:update` runs the app tests and rewrites any snapshot that no longer matches. Run it only when you intend a snapshot change, then review the `.snap` diff before you commit. `yarn fix` runs Prettier and ESLint with fixes.

CI runs the same checks in `.github/workflows/lint.yml` and `test.yml`. `build-docker.yml` also builds the Docker image and checks that the server starts.

## Pre-commit hook

`yarn install` installs a husky hook that runs `lint-staged`, configured in `.lintstagedrc.js`. On staged `.js`, `.ts`, and `.tsx` files it runs `eslint --fix` and then `prettier --write`. The commit fails if any lint warning or error remains. On other formatted files, such as CSS, SCSS, JSON, Markdown, and YAML, it runs `prettier --write`. The hook does not run tests or type checks. To skip it, run `git commit --no-verify`.
