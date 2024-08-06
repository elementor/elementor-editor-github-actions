import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as fs from 'fs-extra';
import * as path from 'node:path';
import { z } from 'zod';
import {
	getArrayInput,
	getBooleanInput,
	getMapInput,
	getNumberInput,
} from '../inputs';
import { setOutput } from '../outputs';

const LHCI_VERSION = '0.14.x';
const OUTPUT_DIR = path.resolve(process.cwd(), './.lhci');

const AVAILABLE_CATEGORIES = [
	'performance',
	'seo',
	'best-practices',
	'accessibility',
] as const;

const lhciConfig = {
	ci: {
		collect: {
			headful: false,
			numberOfRuns: 1,
			url: [] as string[], // Will be filled in later.
			settings: {
				maxWaitForLoad: 90000,
				throttlingMethod: 'devtools',
				onlyCategories: [] as string[], // Will be filled in later.
			},
		},
		upload: {
			target: 'filesystem',
			outputDir: '', // Will be filled in later.
		},
	},
};

export async function run() {
	try {
		const inputs = await core.group('Parsing inputs', parseInputs);

		if (!inputs.skipLHCIInstall) {
			await core.group('Installing lighthouse-ci', async () => {
				await exec.exec('npm', [
					'install',
					'-g',
					`@lhci/cli@${LHCI_VERSION}`,
				]);
			});
		}

		for (const [urlAlias, url] of Object.entries(inputs.urls)) {
			const outputPath = path.resolve(OUTPUT_DIR, urlAlias);

			await core.group(
				`Creating Lighthouse CI configuration file for "${urlAlias}"`,
				async () => {
					const config = {
						...lhciConfig,
						ci: {
							...lhciConfig.ci,
							collect: {
								...lhciConfig.ci.collect,
								numberOfRuns: inputs.numberOfRuns,
								url: [url],
								settings: {
									...lhciConfig.ci.collect.settings,
									onlyCategories: inputs.categories,
								},
							},
							upload: {
								...lhciConfig.ci.upload,
								outputDir: outputPath,
							},
						},
					} satisfies typeof lhciConfig;

					await fs.writeJSON('.lighthouserc.json', config);

					setOutput(`${urlAlias}-path`, outputPath);
				},
			);

			await core.group(
				`Running lighthouse-ci test on "${urlAlias}"`,
				async () => {
					await exec.exec('rm', ['-rf', OUTPUT_DIR]);
					await exec.exec('rm', ['-rf', './.lighthouseci']);

					await exec.exec('npx', [
						'lhci',
						'autorun',
						'--config=./.lighthouserc.json',
					]);
				},
			);

			await core.group(
				`Declare score outputs for "${urlAlias}"`,
				async () => {
					const manifest = await parseManifest(
						path.resolve(outputPath, 'manifest.json'),
						inputs.categories,
					);

					const summary = manifest.find(
						(run) => run.isRepresentativeRun,
					)?.summary;

					for (const [category, value] of Object.entries(
						summary || [],
					)) {
						setOutput(`${urlAlias}-${category}-score`, value);
					}
				},
			);
		}
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
				urls: z.record(
					z.string().regex(/^[a-z0-9-_]+$/),
					z.string().url(),
				),
				categories: z.array(z.enum(AVAILABLE_CATEGORIES)),
				skipLHCIInstall: z.boolean(),
				numberOfRuns: z.number().int().min(1),
			})
			.parse({
				urls: getMapInput('urls'),
				categories: getArrayInput('categories'),
				skipLHCIInstall: getBooleanInput('skip-lhci-install'),
				numberOfRuns: getNumberInput('number-of-runs'),
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

async function parseManifest(path: string, categories: string[]) {
	const content = (await fs.readJSON(path)) as unknown;

	const categoriesEntries = categories.map(
		(category) => [category, z.number()] as const,
	);

	return z
		.array(
			z.object({
				isRepresentativeRun: z.boolean(),
				summary: z.object(Object.fromEntries(categoriesEntries)),
			}),
		)
		.parse(content);
}
