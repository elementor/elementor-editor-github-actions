import fs from 'node:fs/promises';
import type { Options } from 'tsup';

/**
 * When running `zx` on GitHub Actions,
 * the `zx` module cannot be found unless all Node packages are installed.
 * However, `zx` can be run without the actual import.
 * This workaround removes the zx imports from the files, which can make the action run faster.
 */

type Plugin = NonNullable<Options['plugins']>[number];

export default function removeZxImportsTsupPlugin(): Plugin {
	return {
		name: 'remove-zx-imports',
		buildEnd: ({ writtenFiles }) => {
			void Promise.all(
				writtenFiles.map(async (file) => {
					const content = (
						await fs.readFile(file.name, 'utf-8')
					).replaceAll(/^import .+ from "zx";?$/gm, '');

					await fs.writeFile(file.name, content, 'utf-8');
				}),
			);
		},
	};
}
