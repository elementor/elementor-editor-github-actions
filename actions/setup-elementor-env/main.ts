import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as path from 'node:path';
import { z } from 'zod';
import { WP_ENV_TMP_DIR } from '../consts';

const wpEnvWorkingDir = path.resolve(process.cwd(), WP_ENV_TMP_DIR);

export async function run() {
	try {
		const { container, experiments, templates } = await core.group(
			'Parsing inputs',
			parseInputs,
		);

		await core.group('Validating setup-wp-env being used', async () => {
			await runOnContainer({
				container,
				command: ['wp', 'core', 'version'],
				error: 'Please use setup-wp-env action before running this action',
			});
		});

		await core.group('Validating elementor being activated', async () => {
			await runOnContainer({
				container,
				command: ['wp', 'plugin', 'is-active', 'elementor'],
				error: 'Elementor is not installed',
			});
		});

		if (experiments.on.length > 0) {
			await core.group('Activating Experiments', async () => {
				await runOnContainer({
					container,
					command: [
						'wp',
						'--user',
						'admin',
						'elementor',
						'experiments',
						'activate',
						experiments.on.join(','),
					],
					error: 'Failed to activate experiments',
				});
			});
		}

		if (experiments.off.length > 0) {
			await core.group('Deactivating Experiments', async () => {
				await runOnContainer({
					container,
					command: [
						'wp',
						'--user',
						'admin',
						'elementor',
						'experiments',
						'deactivate',
						experiments.off.join(','),
					],
					error: 'Failed to deactivate experiments',
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
							'--user',
							'admin',
							'elementor',
							'library',
							'import-dir',
							template,
						],
						error: 'Failed to import templates',
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

async function parseInputs() {
	try {
		const parsed = z
			.object({
				env: z.union([z.literal('development'), z.literal('testing')]),
				templates: z.array(z.string().regex(/^[a-z0-9-_./]+$/)),
				experiments: z.array(
					z.tuple([
						z.string().regex(/^[a-z0-9-_]+$/),
						z.union([z.literal('true'), z.literal('false')]),
					]),
				),
			})
			.parse({
				env: core.getInput('env'),
				templates: core.getInput('templates'),
				experiments: core
					.getMultilineInput('experiments')
					.map((experiment) => experiment.split(':'))
					.map(([key, value]) => [key, value?.toLowerCase()]),
			});

		return {
			container:
				parsed.env === 'development'
					? ('cli' as const)
					: ('tests-cli' as const),
			templates: parsed.templates,
			experiments: {
				on: parsed.experiments
					.filter(([, value]) => value === 'true')
					.map(([key]) => key),
				off: parsed.experiments
					.filter(([, value]) => value === 'false')
					.map(([key]) => key),
			},
		};
	} catch (error) {
		let message = 'Failed to parse inputs';

		if (error instanceof z.ZodError) {
			message = `${message}: ${error.errors.map((error) => error.message).join('\n')}`;
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
		await exec.exec(`npx`, ['wp-env', 'run', container, ...command], {
			cwd: wpEnvWorkingDir,
		});
	} catch (e) {
		throw new Error(error, { cause: e });
	}
}
