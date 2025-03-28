import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['index.ts'],
	outDir: 'dist',
	format: 'cjs',
	noExternal: [/.+/],
	platform: 'node',
	minify: true,
	clean: true,
});
