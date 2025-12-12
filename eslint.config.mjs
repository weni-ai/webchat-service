import { defineConfig } from "eslint/config";
import prettier from "eslint-plugin-prettier";
import globals from "globals";

export default defineConfig([
  {
    languageOptions: {
      ecmaVersion: 12,
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },

    plugins: {
      prettier,
    },

    rules: {
      "prettier/prettier": [
        "error",
        {
          tabWidth: 2,
          semi: true,
          singleQuote: true,
          bracketSpacing: true,
          printWidth: 80,
          trailingComma: "all",
          endOfLine: "lf",
          singleAttributePerLine: true,
        },
      ],
    },
  },
]);
