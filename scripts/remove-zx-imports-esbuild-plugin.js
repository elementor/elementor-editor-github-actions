import fs from 'node:fs/promises';

export default function removeZxImportsEsbuildPlugin() {
	return {
		name: 'remove-zx-imports',
		setup(build) {
			build.onLoad({ filter: /.*/ }, async (args) => ({
				contents: await fs
					.readFile(args.path, 'utf-8')
					.then((res) =>
						res.replaceAll(/^import .+ from 'zx';?$/gm, ''),
					),
			}));
		},
	};
}
