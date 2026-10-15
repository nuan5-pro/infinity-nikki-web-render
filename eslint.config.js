import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';

import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';

export default defineConfig(
	globalIgnores([
		'**/dist/**',
		'**/node_modules/**',
	]),

	{
		files: ['**/*.{ts,tsx,mts,cts}'],

		extends: [
			js.configs.recommended,
			tseslint.configs.recommended,
		],

		plugins: {
			'@stylistic': stylistic,
		},

		languageOptions: {
			parserOptions: {
				ecmaVersion: 'latest',
			},
		},

		rules: {
			'@stylistic/semi': ['error', 'always'],
			'@stylistic/quotes': ['error', 'single'],
			'@stylistic/indent': ['error', 'tab', { SwitchCase: 0 }],
			'@stylistic/linebreak-style': ['error', 'unix'],
			'@stylistic/comma-dangle': ['error', 'always-multiline'],
			'@stylistic/object-curly-spacing': ['error', 'always'],
			'@stylistic/space-in-parens': 'error',
			'@stylistic/space-infix-ops': 'error',
			'@stylistic/space-before-blocks': 'error',
			'@stylistic/space-unary-ops': 'error',
			'@stylistic/spaced-comment': 'error',
			'@stylistic/keyword-spacing': 'error',
			'@stylistic/no-multi-spaces': 'error',
			'@stylistic/space-before-function-paren': ['error', {
				anonymous: 'always',
				named: 'never',
				asyncArrow: 'always',
			}],

			'no-unused-labels': 'off',
			'no-unused-vars': 'off',

			'@typescript-eslint/no-unused-vars': 'warn',
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-non-null-assertion': 'off',
			'@typescript-eslint/explicit-module-boundary-types': 'off',
		},
	},
);
