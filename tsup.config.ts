import { defineConfig } from 'tsup';

export default [defineActionConfig('log')];

function defineActionConfig(action: string) {
	return defineConfig({
		entry: [`actions/${action}/index.ts`],
		outDir: `actions/${action}/dist`,
		format: 'esm',
		noExternal: [/.+/],
	});
}
