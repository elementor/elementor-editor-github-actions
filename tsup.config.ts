import { defineConfig } from 'tsup';

const actions = ['setup-wp-env', 'setup-elementor-env', 'run-lighthouse-tests'];

export default actions.map((action) =>
	defineConfig({
		entry: [`actions/${action}/index.ts`],
		outDir: `actions/${action}/dist`,
		format: 'cjs',
		noExternal: [/.+/],
		platform: 'node',
		minify: true,
	}),
);
