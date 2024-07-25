import { defineConfig } from 'tsup';
import removeZxImportsTsupPlugin from './scripts/remove-zx-imports-tsup-plugin.js';

export default [
	defineConfig({
		entry: [`actions/setup-wp-env/*.ts`],
		outDir: `actions/setup-wp-env/dist`,
		format: 'esm',
		plugins: [removeZxImportsTsupPlugin()],
		platform: 'node',
	}),
	defineConfig({
		entry: [`actions/setup-elementor-env/index.ts`],
		outDir: `actions/setup-elementor-env/dist`,
		format: 'cjs',
		noExternal: [/.+/],
		platform: 'node',
	}),
];
