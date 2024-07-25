import { defineConfig } from 'tsup';
import removeZxImportsTsupPlugin from './scripts/remove-zx-imports-tsup-plugin.js';

export default [
	defineActionConfig('setup-wp-env'),
	defineActionConfig('setup-elementor-env', ['index.ts'], true),
];

function defineActionConfig(
	action: string,
	files: string[] = [],
	bundle: boolean = false,
) {
	return defineConfig({
		entry: [`actions/${action}/${files.join(',') || '*.ts'}`],
		outDir: `actions/${action}/dist`,
		format: 'esm',
		plugins: [removeZxImportsTsupPlugin()],
		noExternal: bundle ? [/.+/] : [],
	});
}
