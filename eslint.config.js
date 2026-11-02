import { defineConfig, globalIgnores } from "eslint/config"
import tseslint from "typescript-eslint"

export default defineConfig(
  globalIgnores([
    "**/node_modules",
    "**/dist",
    "**/src/generated*",
    "**/*.gen.ts",
    "**/*.d.ts",
    "**/e2e/**",
    "artifacts/",
    "sdks/vscode/",
  ]),
  {
    files: ["packages/*/src/**/*.ts"],
    extends: [tseslint.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
)
