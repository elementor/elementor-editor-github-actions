import { defineConfig } from 'tsup';
import * as fs from 'node:fs/promises';

export default [defineActionConfig('log')];

function defineActionConfig(action: string) {
	return defineConfig({
		entry: [`actions/${action}/index.ts`],
		outDir: `actions/${action}/dist`,
		format: 'esm',

		esbuildPlugins: [
			{
				name: 'remove-import-zx',
				setup(build) {
					build.onLoad({ filter: /.*/ }, async (args) => {
						const content = await fs.readFile(args.path, 'utf-8');

						return {
							contents: content.replaceAll(
								/^import .+ from 'zx';?$/gm,
								'',
							),
						};
					});
				},
			},
		],
	});
}
