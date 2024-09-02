import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { z } from 'zod';
import { getArrayInput, getMapInput, getStringInput } from '../inputs';

export async function run() {
	try {
		const { container, experiments, templates, media } = await core.group(
			'Parsing inputs',
			parseInputs,
		);

		await core.group('Validating wp-env installation', async () => {
			await runOnContainer({
				container,
				command: ['wp', 'core', 'version'],
				error: "Can't find a running `wp-env` instance. Please make sure it's running an accessible. (try using `setup-wp-env` action before this one)",
			});
		});

		await core.group('Validating elementor being activated', async () => {
			await runOnContainer({
				container,
				command: ['wp', 'plugin', 'is-active', 'elementor'],
				error: "Can't find an active Elementor installation. Please make sure it's installed and activated.",
			});
		});

		if (experiments.on.length > 0) {
			await core.group('Activating Experiments', async () => {
				await runOnContainer({
					container,
					command: [
						'wp',
						'--user=admin',
						'elementor',
						'experiments',
						'activate',
						experiments.on.join(','),
					],
					error: `Failed to activate experiments: ${experiments.on.join(', ')}`,
				});
			});
		}

		if (experiments.off.length > 0) {
			await core.group('Deactivating Experiments', async () => {
				await runOnContainer({
					container,
					command: [
						'wp',
						'--user=admin',
						'elementor',
						'experiments',
						'deactivate',
						experiments.off.join(','),
					],
					error: `Failed to deactivate experiments: ${experiments.on.join(', ')}`,
				});
			});
		}

		if (templates.length > 0) {
			await core.group('Importing Templates', async () => {
				for (const template of templates) {
					await runOnContainer({
						container,
						command: [
							'wp',
							'--user=admin',
							'elementor',
							'library',
							'import-dir',
							template,
						],
						error: `Failed to import templates: ${template}`,
					});
				}
			});
		}

		if (media.length > 0) {
			await core.group('Importing media', async () => {
				for (const mediaDir of media) {
					await runOnContainer({
						container,
						command: [
							'bash',
							'-c',
							`for mediafile in \\$\\(ls -1 ${mediaDir}\\); do wp media import ${mediaDir}/\\"\\$mediafile\\"; done`,
						],
						error: `Failed to import media: ${mediaDir}`,
					});
				}
			});
		}

		await core.group('Clearing Elementor and WP Cache', async () => {
			await runOnContainer({
				container,
				command: ['wp', 'cache', 'flush'],
				error: 'Failed to flush wp cache',
			});

			await runOnContainer({
				container,
				command: ['wp', 'elementor', 'flush-css'],
				error: 'Failed to flush elementor css cache',
			});
		});
	} catch (e) {
		const error = e instanceof Error ? e : new Error('An error occurred');

		core.setFailed(error);
	}
}

// eslint-disable-next-line @typescript-eslint/require-await -- `core.group` requires a promise.
async function parseInputs() {
	try {
		const parsed = z
			.object({
				env: z.union([z.literal('development'), z.literal('testing')]),
				templates: z.array(z.string().regex(/^[a-z0-9-_./]+$/)),
				media: z.array(z.string().regex(/^[a-z0-9-_./]+$/)),
				experiments: z.record(
					z.string().regex(/^[a-z0-9-_]+$/),
					z.union([z.literal('true'), z.literal('false')]),
				),
			})
			.parse({
				env: getStringInput('env'),
				templates: getArrayInput('templates'),
				media: getArrayInput('media'),
				experiments: getMapInput('experiments'),
			});

		const experimentsEntries = Object.entries(parsed.experiments);

		return {
			container:
				parsed.env === 'development'
					? ('cli' as const)
					: ('tests-cli' as const),
			templates: parsed.templates,
			media: parsed.media,
			experiments: {
				on: experimentsEntries
					.filter(([, value]) => value === 'true')
					.map(([key]) => key),
				off: experimentsEntries
					.filter(([, value]) => value === 'false')
					.map(([key]) => key),
			},
		};
	} catch (error) {
		let message = 'Failed to parse inputs';

		if (error instanceof z.ZodError) {
			message = `${message}: ${error.errors
				.map((e) => `${e.path.join(', ')} - ${e.message}`)
				.join('\n')}`;
		}

		throw new Error(message, { cause: error });
	}
}

async function runOnContainer({
	container,
	command,
	error,
}: {
	container: 'cli' | 'tests-cli';
	command: string[];
	error: string;
}) {
	try {
		await exec.exec(`npx`, ['wp-env', 'run', container, ...command]);
	} catch (e) {
		throw new Error(error, { cause: e });
	}
}
