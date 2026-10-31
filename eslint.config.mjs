import { fileURLToPath } from "node:url";

import { fixupPluginRules, includeIgnoreFile } from "@eslint/compat";
import importX from "eslint-plugin-import-x";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// Rules reproduce what eslint-config-react-app 7 and the old .eslintrc files
// enabled, with options pinned where ESLint 9-10 or typescript-eslint 8
// changed the defaults. Prettier checks formatting on its own.
export default [
  // Prettier and ESLint share one ignore file.
  includeIgnoreFile(fileURLToPath(new URL(".prettierignore", import.meta.url))),
  {
    files: ["**/*.{js,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.commonjs,
        ...globals.jest,
        ...globals.node,
      },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "import-x": importX,
      // neither plugin declares ESLint 10 support yet
      "jsx-a11y": fixupPluginRules(jsxA11y),
      react: fixupPluginRules(react),
      "react-hooks": reactHooks,
    },
    settings: { react: { version: "detect" } },
    rules: {
      "array-callback-return": "warn",
      curly: "warn",
      "dot-location": ["warn", "property"],
      "dot-notation": "warn",
      eqeqeq: ["warn", "smart"],
      "getter-return": "warn",
      "import-x/first": "error",
      "import-x/no-amd": "error",
      "import-x/no-webpack-loader-syntax": "error",
      "import-x/order": [
        "warn",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
            "object",
            "type",
          ],
          pathGroups: [
            {
              pattern: "@setsquare/**",
              group: "external",
              position: "after",
            },
          ],
          "newlines-between": "always-and-inside-groups",
          warnOnUnassignedImports: true,
        },
      ],
      "jsx-a11y/alt-text": "warn",
      "jsx-a11y/anchor-has-content": "warn",
      "jsx-a11y/anchor-is-valid": [
        "warn",
        {
          aspects: ["noHref", "invalidHref"],
        },
      ],
      "jsx-a11y/aria-activedescendant-has-tabindex": "warn",
      "jsx-a11y/aria-props": "warn",
      "jsx-a11y/aria-proptypes": "warn",
      "jsx-a11y/aria-role": [
        "warn",
        {
          ignoreNonDOM: true,
        },
      ],
      "jsx-a11y/aria-unsupported-elements": "warn",
      "jsx-a11y/heading-has-content": "warn",
      "jsx-a11y/iframe-has-title": "warn",
      "jsx-a11y/img-redundant-alt": "warn",
      "jsx-a11y/no-access-key": "warn",
      "jsx-a11y/no-distracting-elements": "warn",
      "jsx-a11y/no-redundant-roles": "warn",
      "jsx-a11y/role-has-required-aria-props": "warn",
      "jsx-a11y/role-supports-aria-props": "warn",
      "jsx-a11y/scope": "warn",
      "new-parens": "warn",
      "no-caller": "warn",
      "no-cond-assign": ["warn", "except-parens"],
      "no-console": [
        "warn",
        {
          allow: ["warn", "error", "info"],
        },
      ],
      "no-const-assign": "warn",
      "no-control-regex": "warn",
      "no-delete-var": "warn",
      "no-dupe-args": "warn",
      "no-dupe-keys": "warn",
      "no-duplicate-case": "warn",
      "no-else-return": "warn",
      "no-empty-character-class": "warn",
      "no-empty-pattern": "warn",
      "no-eval": "warn",
      "no-ex-assign": "warn",
      "no-extend-native": "warn",
      "no-extra-bind": "warn",
      "no-extra-label": "warn",
      "no-fallthrough": "warn",
      "no-func-assign": "warn",
      "no-global-assign": "warn",
      "no-implied-eval": "warn",
      "no-invalid-regexp": "warn",
      "no-iterator": "warn",
      "no-label-var": "warn",
      "no-labels": [
        "warn",
        {
          allowLoop: true,
          allowSwitch: false,
        },
      ],
      "no-lone-blocks": "warn",
      "no-lonely-if": "warn",
      "no-loop-func": "warn",
      "no-mixed-operators": [
        "warn",
        {
          groups: [
            ["&", "|", "^", "~", "<<", ">>", ">>>"],
            ["==", "!=", "===", "!==", ">", ">=", "<", "<="],
            ["&&", "||"],
            ["in", "instanceof"],
          ],
          allowSamePrecedence: false,
        },
      ],
      "no-multi-str": "warn",
      "no-new-func": "warn",
      "no-new-object": "warn",
      "no-new-symbol": "warn",
      "no-new-wrappers": "warn",
      "no-obj-calls": "warn",
      "no-octal": "warn",
      "no-octal-escape": "warn",
      "no-regex-spaces": "warn",
      "no-restricted-imports": [
        "error",
        {
          name: "jotai",
          message:
            'Do not import from "jotai" directly. Use our app-specific modules ("editor-jotai" or "app-jotai").',
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "require",
          property: "ensure",
          message:
            "Please use import() instead. More info: https://facebook.github.io/create-react-app/docs/code-splitting",
        },
        {
          object: "System",
          property: "import",
          message:
            "Please use import() instead. More info: https://facebook.github.io/create-react-app/docs/code-splitting",
        },
      ],
      "no-restricted-syntax": ["warn", "WithStatement"],
      "no-script-url": "warn",
      "no-self-assign": "warn",
      "no-self-compare": "warn",
      "no-sequences": "warn",
      "no-shadow-restricted-names": [
        "warn",
        {
          reportGlobalThis: false,
        },
      ],
      "no-sparse-arrays": "warn",
      "no-template-curly-in-string": "warn",
      "no-this-before-super": "warn",
      "no-throw-literal": "warn",
      "no-unneeded-ternary": "warn",
      "no-unreachable": "warn",
      "no-unsafe-negation": "warn",
      "no-unused-labels": "warn",
      "no-useless-computed-key": [
        "warn",
        {
          enforceForClassMembers: false,
        },
      ],
      "no-useless-concat": "warn",
      "no-useless-escape": "warn",
      "no-useless-rename": [
        "warn",
        {
          ignoreDestructuring: false,
          ignoreImport: false,
          ignoreExport: false,
        },
      ],
      "no-useless-return": "warn",
      "no-var": "warn",
      "no-whitespace-before-property": "warn",
      "no-with": "warn",
      "object-shorthand": "warn",
      "one-var": ["warn", "never"],
      "prefer-arrow-callback": "warn",
      "prefer-const": [
        "warn",
        {
          destructuring: "all",
        },
      ],
      "prefer-template": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react/forbid-foreign-prop-types": [
        "warn",
        {
          allowInPropTypes: true,
        },
      ],
      "react/jsx-no-comment-textnodes": "warn",
      "react/jsx-no-duplicate-props": "warn",
      "react/jsx-no-target-blank": [
        "error",
        {
          allowReferrer: true,
        },
      ],
      "react/jsx-no-undef": "error",
      "react/jsx-pascal-case": [
        "warn",
        {
          allowAllCaps: true,
          ignore: [],
        },
      ],
      "react/jsx-uses-react": "warn",
      "react/jsx-uses-vars": "warn",
      "react/no-danger-with-children": "warn",
      "react/no-direct-mutation-state": "warn",
      "react/no-is-mounted": "warn",
      "react/no-typos": "error",
      "react/require-render-return": "error",
      "react/style-prop-object": "warn",
      "require-yield": "warn",
      "rest-spread-spacing": ["warn", "never"],
      strict: ["warn", "never"],
      "unicode-bom": ["warn", "never"],
      "use-isnan": "warn",
      "valid-typeof": "warn",
    },
  },
  {
    files: ["**/*.js"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          caughtErrors: "none",
        },
      ],
      "default-case": [
        "warn",
        {
          commentPattern: "^no default$",
        },
      ],
      "no-array-constructor": "warn",
      "no-dupe-class-members": "warn",
      "no-redeclare": "warn",
      "no-undef": "error",
      "no-unused-expressions": [
        "error",
        {
          allowShortCircuit: true,
          allowTernary: true,
          allowTaggedTemplates: true,
        },
      ],
      "no-unused-vars": [
        "warn",
        {
          args: "none",
          ignoreRestSiblings: true,
          caughtErrors: "none",
        },
      ],
      "no-use-before-define": [
        "warn",
        {
          functions: false,
          classes: false,
          variables: false,
        },
      ],
      "no-useless-constructor": "warn",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          disallowTypeAnnotations: false,
          fixStyle: "separate-type-imports",
        },
      ],
      "@typescript-eslint/consistent-type-assertions": "warn",
      "@typescript-eslint/no-array-constructor": "warn",
      "@typescript-eslint/no-redeclare": "warn",
      "@typescript-eslint/no-unused-expressions": [
        "error",
        {
          allowShortCircuit: true,
          allowTernary: true,
          allowTaggedTemplates: true,
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          args: "none",
          ignoreRestSiblings: true,
          caughtErrors: "none",
        },
      ],
      "@typescript-eslint/no-use-before-define": [
        "warn",
        {
          functions: false,
          classes: false,
          variables: false,
          typedefs: false,
        },
      ],
      "@typescript-eslint/no-useless-constructor": "warn",
    },
  },
  {
    files: ["packages/setsquare/**/*.{ts,tsx}"],
    ignores: [
      "packages/setsquare/**/*.test.{ts,tsx}",
      "packages/setsquare/**/*.test.*.{ts,tsx}",
    ],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@setsquare/setsquare"],
              message:
                "Do not import from the barrel 'index.tsx' files. Use direct relative imports to the specific module instead.",
              allowTypeImports: true,
            },
          ],
          paths: [
            ".",
            "..",
            "../..",
            "../../..",
            "../../../..",
            "../../../../..",
            "../index",
            "../../index",
            "../../../index",
            "../../../../index",
          ],
        },
      ],
    },
  },
  {
    files: ["packages/{common,element}/src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../../setsquare",
                "../../../packages/setsquare",
                "@setsquare/setsquare",
              ],
              message:
                "Do not import from '@setsquare/setsquare' package anything but types, as this package must be independent.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
];
