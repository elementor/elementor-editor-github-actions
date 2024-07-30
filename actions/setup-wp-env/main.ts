import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as fs from 'fs-extra';
import * as path from 'node:path';
import { z } from 'zod';
import {
	getArrayInput,
	getBooleanInput,
	getMapInput,
	getStringInput,
} from '../inputs';

export async function run() {
	try {
		const inputs = await core.group('Parsing inputs', parseInputs);

		if (!inputs.skipWpEnvInstall) {
			await core.group('Installing wp-env', async () => {
				await exec.exec('npm', ['install', '-g', '@wordpress/env@10']);
			});
		}

		await core.group('Creating wp-env.json config', async () => {
			const configDir = '.action-config';

			const afterStartCommands = [
				`WP_CLI_CONFIG_PATH=${configDir}/wp-cli.yml wp rewrite structure '/%postname%/' --hard`,
				'wp rewrite flush --hard',
			];

			if (inputs.activeTheme) {
				afterStartCommands.unshift(
					`INPUT_ACTIVE_THEME="${inputs.activeTheme}"`,
					'wp theme activate "$INPUT_ACTIVE_THEME"',
				);
			}

			const config = {
				core: inputs.wp ? `WordPress/Wordpress#${inputs.wp}` : null,
				phpVersion: inputs.php ? inputs.php : null,
				themes: inputs.themes,
				plugins: inputs.plugins,
				config: inputs.config,
				mappings: {
					...inputs.mappings,
					[configDir]: path.resolve(inputs.actionPath, './config'),
				},
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

async function parseInputs() {
	try {
		return z
			.object({
				wp: z.string(),
				php: z.string().regex(/^(\d+\.)?(\d+\.)?(\d+)$/),
				plugins: z.array(z.string()),
				themes: z.array(z.string()),
				mappings: z.record(z.string(), z.string()),
				config: z.record(z.string(), z.string()),
				activeTheme: z.string().regex(/^[a-z0-9-]+$/),
				actionPath: z.string(),
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
				actionPath: process.env.GITHUB_ACTION_PATH,
				skipWpEnvInstall: getBooleanInput('skip-wp-env-install'),
			});
	} catch (error) {
		let message = 'Failed to parse inputs';

		if (error instanceof z.ZodError) {
			message = `${message}: ${error.errors
				.map((error) => `${error.path} - ${error.message}`)
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
