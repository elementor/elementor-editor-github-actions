import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['index.ts', 'update-version-files.ts'],
	outDir: 'dist',
	format: 'cjs',
	noExternal: [/.+/],
	platform: 'node',
	minify: true,
	clean: true,
});
