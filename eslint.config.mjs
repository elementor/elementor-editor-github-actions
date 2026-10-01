import globals from 'globals';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.strictTypeChecked,
	{
		languageOptions: {
			globals: globals.node,
			parserOptions: {
				project: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		files: ['actions/playwright-test-healer/**/*.js'],
		...tseslint.configs.disableTypeChecked,
		languageOptions: {
			sourceType: 'commonjs',
			globals: { ...globals.node, ...globals.vitest },
		},
		rules: {
			...tseslint.configs.disableTypeChecked.rules,
			'@typescript-eslint/no-require-imports': 'off',
		},
	},
	{
		ignores: [
			'**/coverage/**',
			'**/dist/**',
			'**/node_modules/**',
			'**/__snapshots__/**',
			'actions/visual-proof*/**',
		],
	},
);
