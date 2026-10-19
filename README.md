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

## Check your changes

`yarn test:all` runs the type check, ESLint, Prettier, and the Vitest suite.

## License

Setsquare is released under the MIT license. See [LICENSE](LICENSE).
