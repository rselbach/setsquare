# Setsquare

Setsquare is a diagram tool that runs in your browser. It is a fork of [Excalidraw](https://github.com/excalidraw/excalidraw) and keeps Excalidraw's full history.

## Run it locally

You need Node.js 18 or later and Yarn 1.

```sh
yarn install
yarn start
```

The app opens at `http://localhost:3001`.

## Repository layout

The fork keeps Excalidraw's monorepo layout and `@excalidraw/*` package names. Renaming them would turn every upstream merge into a conflict.

- `excalidraw-app/` is the Setsquare web app.
- `packages/excalidraw/` is the editor component that the app embeds.
- `packages/common/`, `packages/element/`, `packages/math/`, and `packages/utils/` hold the code the editor builds on.

## Check your changes

`yarn test:all` runs the type check, ESLint, Prettier, and the Vitest suite.

## Merge changes from Excalidraw

Add Excalidraw as the `upstream` remote once, then merge its `master` branch:

```sh
git remote add upstream https://github.com/excalidraw/excalidraw.git
git fetch upstream master
git merge upstream/master
```

## License

Setsquare is released under the MIT license, the same license as Excalidraw. [LICENSE](LICENSE) keeps Excalidraw's copyright notice.
