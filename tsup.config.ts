import { defineConfig } from 'tsup';
import removeZxImportsEsbuildPlugin from './scripts/remove-zx-imports-esbuild-plugin.js';

export default [defineActionConfig('log')];

function defineActionConfig(action: string) {
	return defineConfig({
		entry: [`actions/${action}/index.ts`],
		outDir: `actions/${action}/dist`,
		format: 'esm',
		esbuildPlugins: [removeZxImportsEsbuildPlugin()],
	});
}
