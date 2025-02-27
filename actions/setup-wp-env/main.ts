import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as fs from 'fs-extra';
import { z } from 'zod';
import {
	getArrayInput,
	getBooleanInput,
	getMapInput,
	getStringInput,
} from '@elementor-editor-github-actions/utils';

const WP_ENV_VERSION = '10.4.0';

const wpCLIYml = `
apache_modules:
    - mod_rewrite
`;

export async function run() {
	try {
		const inputs = await core.group('Parsing inputs', parseInputs);

		if (!inputs.skipWpEnvInstall) {
			await core.group('Installing wp-env', async () => {
				await exec.exec('npm', [
					'install',
					'-g',
					`@wordpress/env@${WP_ENV_VERSION}`,
				]);
			});
		}

		await core.group('Creating wp-env.json config', async () => {
			const wpCLIConfigDir = './.action-config';
			const wpCLIPath = `${wpCLIConfigDir}/wp-cli.yml`;

			const afterStartCommands = [
				`mkdir -p ${wpCLIConfigDir}`,
				`echo "${wpCLIYml}" > ${wpCLIPath}`,
				`WP_CLI_CONFIG_PATH=${wpCLIPath} wp rewrite structure '/%postname%/' --hard`,
				'wp rewrite flush --hard',
			];

			if (inputs.activeTheme) {
				afterStartCommands.push(
					`wp theme activate "${inputs.activeTheme}"`,
				);
			}

			const config = {
				core: inputs.wp ? `WordPress/Wordpress#${inputs.wp}` : null,
				phpVersion: inputs.php,
				themes: inputs.themes,
				plugins: inputs.plugins,
				config: inputs.config,
				mappings: inputs.mappings,
				lifecycleScripts: {
					afterStart: prepareCommands(
						['cli', 'tests-cli'],
						afterStartCommands,
					),
				},
			};

			await fs.writeJSON('./.wp-env.json', config);
		});

		await core.group('Starting wp-env', async () => {
			await exec.exec('npx', ['wp-env', 'start']);
		});
	} catch (e) {
		const error = e instanceof Error ? e : new Error('An error occurred');

		core.setFailed(error);
	}
}

// eslint-disable-next-line @typescript-eslint/require-await -- `core.group` requires a promise.
async function parseInputs() {
	try {
		return z
			.object({
				wp: z.string().nullable(),
				php: z
					.string()
					.regex(/^(\d+\.)?(\d+\.)?(\d+)$/)
					.nullable(),
				plugins: z.array(z.string()),
				themes: z.array(z.string()),
				mappings: z.record(z.string(), z.string()),
				config: z.record(z.string(), z.string()),
				activeTheme: z.string().regex(/^[a-z0-9-]+$/),
				skipWpEnvInstall: z.boolean(),
			})
			.parse({
				wp: getStringInput('wp'),
				php: getStringInput('php'),
				plugins: getArrayInput('plugins'),
				themes: getArrayInput('themes'),
				mappings: getMapInput('mappings'),
				config: getMapInput('config'),
				activeTheme: getStringInput('active-theme'),
				skipWpEnvInstall: getBooleanInput('skip-wp-env-install'),
			});
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

function prepareCommands(envs: Array<'cli' | 'tests-cli'>, commands: string[]) {
	const mergedCommands = commands.filter(Boolean).join(' && ');

	return envs
		.map((env) => `npx wp-env run ${env} bash -c '${mergedCommands}'`)
		.join(' && ');
}
