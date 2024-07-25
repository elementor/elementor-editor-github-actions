import fs from 'node:fs/promises';

/**
 * When running `zx` on GitHub Actions,
 * the `zx` module cannot be found unless all Node packages are installed.
 * However, `zx` can be run without the actual import.
 * This workaround removes the zx imports from the files, which can make the action run faster.
 *
 * @returns {import('tsup').Plugin}
 */
export default function removeZxImportsTsupPlugin() {
	return {
		name: 'remove-zx-imports',
		buildEnd: ({ writtenFiles }) =>
			Promise.all(
				writtenFiles.map(async (file) => {
					const content = (await fs.readFile(file.name, 'utf-8'))
						.replaceAll(/^import .+ from "zx";?$/gm, '')
						.replaceAll('var import_zx = require("zx");', '');

					await fs.writeFile(file.name, content, 'utf-8');
				}),
			),
	};
}
