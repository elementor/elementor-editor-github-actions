import { defineConfig } from 'tsup';
import removeZxImportsTsupPlugin from './scripts/remove-zx-imports-tsup-plugin.js';

export default [defineActionConfig('setup-wp-env')];

function defineActionConfig(action: string) {
	return defineConfig({
		entry: [`actions/${action}/*.ts`],
		outDir: `actions/${action}/dist`,
		format: 'esm',
		plugins: [removeZxImportsTsupPlugin()],
	});
}
