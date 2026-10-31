const { ESLint } = require("eslint");

module.exports = {
  // ESLint warns about explicitly passed ignored files, which
  // --max-warnings=0 turns into a failure, so filter them out first.
  "*.{js,ts,tsx}": async (files) => {
    const eslint = new ESLint();
    const ignored = await Promise.all(
      files.map((file) => eslint.isPathIgnored(file)),
    );
    const linted = files.filter((_, index) => !ignored[index]);
    return linted.length
      ? `eslint --max-warnings=0 --fix ${linted
          .map((file) => JSON.stringify(file))
          .join(" ")}`
      : [];
  },
  "*.{css,scss,json,md,html,yml}": [
    "prettier --write --ignore-path=.eslintignore",
  ],
};
