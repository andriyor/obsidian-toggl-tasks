import e18e from "@e18e/eslint-plugin";
import obsidianmd from "eslint-plugin-obsidianmd";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
	{ ignores: ["main.js"] },
	e18e.configs.recommended,
	...obsidianmd.configs.recommended,
	{
		// Type-checked rules need type information, which tsconfig.json's include
		// gives code files; JSON files are linted without types.
		files: ["**/*.{ts,mts,mjs}"],
		extends: [tseslint.configs.recommendedTypeChecked],
		languageOptions: { parserOptions: { projectService: true } },
	},
	{
		rules: {
			// Toggl is a brand; URL placeholders are not sentences.
			"obsidianmd/ui/sentence-case": [
				"warn",
				{ ignoreWords: ["Toggl"], ignoreRegex: ["^https?://"] },
			],
		},
	},
	{
		// The build script and the tests run under Node, not inside Obsidian.
		files: ["esbuild.config.mjs", "test/**/*.mts"],
		rules: {
			"obsidianmd/no-nodejs-modules": "off",
			"@typescript-eslint/no-floating-promises": "off",
		},
	},
]);
