import fs from 'node:fs/promises';

/**
 * When running `zx` on GitHub Actions,
 * the `zx` module cannot be found unless all Node packages are installed.
 * However, `zx` can be run without the actual import.
 * This workaround removes the zx imports from the files, which can make the action run faster.
 */
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
