module.exports = {
  // ESLint runs first because its fixes can leave code Prettier would change.
  "*.{js,ts,tsx}": [
    "eslint --max-warnings=0 --fix --no-warn-ignored",
    "prettier --write",
  ],
  "*.{css,scss,json,md,html,yml,jsx,mjs,cjs,mts,cts}": "prettier --write",
};
