import { defineConfig } from 'tsup';
import removeZxImportsTsupPlugin from './scripts/remove-zx-imports-tsup-plugin.js';

export default [defineActionConfig('setup-wp-env')];

function defineActionConfig(action: string) {
	return defineConfig({
		entry: [`src/${action}/*.ts`],
		outDir: `dist/${action}`,
		format: 'esm',
		plugins: [removeZxImportsTsupPlugin()],
	});
}
