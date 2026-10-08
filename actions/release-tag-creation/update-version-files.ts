import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import {
	patchPhpHeaderField,
	patchPhpVersion,
	patchReadmeTxt,
} from '@elementor/editor-github-actions-utils';
import {
	fetchCoreReleaseVersion,
	toTestedUpToVersion,
	type ReleaseChannel,
} from './elementor-tested-up-to.ts';
import { resolvePluginConfig } from './plugin-config.ts';

const README_PATH = 'readme.txt';
const ELEMENTOR_TESTED_UP_TO_HEADER = 'Elementor tested up to';

export function resolveReadmeTags(
	version: string,
	channel: string,
	companionTag: string,
): { stable: string; beta: string } {
	if (channel === 'stable') {
		return { stable: version, beta: companionTag };
	}
	return { stable: companionTag, beta: version };
}

function getEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

function getChannelEnv(name: string): ReleaseChannel {
	const value = getEnv(name);
	if (value !== 'stable' && value !== 'beta') {
		throw new Error(`${name} must be "stable" or "beta", got "${value}"`);
	}
	return value;
}

function setOutput(name: string, value: string): void {
	const outputFile = process.env['GITHUB_OUTPUT'];
	if (outputFile) {
		appendFileSync(outputFile, `${name}=${value}\n`);
	} else {
		console.log(`OUTPUT ${name}=${value}`);
	}
}

function updateReadme(
	version: string,
	channel: ReleaseChannel,
	companionTag: string,
): void {
	const readmeTags = resolveReadmeTags(version, channel, companionTag);

	const patchedReadme = patchReadmeTxt(
		readFileSync(README_PATH, 'utf8'),
		readmeTags,
	);
	writeFileSync(README_PATH, patchedReadme, 'utf8');
	console.log(
		`✅ ${README_PATH} patched — Stable: ${readmeTags.stable}, Beta: ${readmeTags.beta}`,
	);

	setOutput('readme_stable_tag', readmeTags.stable);
	setOutput('readme_beta_tag', readmeTags.beta);
}

async function resolveElementorTestedUpTo(
	channel: ReleaseChannel,
	token?: string,
): Promise<string> {
	const coreVersion = await fetchCoreReleaseVersion(channel, token);
	const testedUpTo = toTestedUpToVersion(coreVersion);
	console.log(
		`✅ Core release/${channel} is at ${coreVersion} — ${ELEMENTOR_TESTED_UP_TO_HEADER}: ${testedUpTo}`,
	);

	return testedUpTo;
}

export async function run(): Promise<void> {
	try {
		const version = getEnv('INPUT_VERSION');
		const channel = getChannelEnv('INPUT_CHANNEL');
		const plugin = getEnv('INPUT_PLUGIN');
		const githubToken = process.env['INPUT_GITHUB_TOKEN'];
		const {
			pluginFile,
			versionConstant,
			updateReadme: shouldUpdateReadme,
			updateElementorTestedUpTo: shouldUpdateTestedUpTo,
		} = resolvePluginConfig(plugin);

		console.log('INPUT_VERSION', version);
		console.log('INPUT_CHANNEL', channel);
		console.log('INPUT_PLUGIN', plugin);
		console.log('Plugin file', pluginFile);
		console.log('Version constant', versionConstant);
		console.log('Update readme', shouldUpdateReadme);
		console.log('Update Elementor tested up to', shouldUpdateTestedUpTo);

		let patchedPhp = patchPhpVersion(
			readFileSync(pluginFile, 'utf8'),
			version,
			versionConstant,
		);

		if (shouldUpdateTestedUpTo) {
			const testedUpTo = await resolveElementorTestedUpTo(
				channel,
				githubToken,
			);
			patchedPhp = patchPhpHeaderField(
				patchedPhp,
				ELEMENTOR_TESTED_UP_TO_HEADER,
				testedUpTo,
			);
			setOutput('elementor_tested_up_to', testedUpTo);
		}

		writeFileSync(pluginFile, patchedPhp, 'utf8');
		console.log(`✅ ${pluginFile} patched to ${version}`);

		setOutput('plugin_file', pluginFile);
		setOutput('update_readme', String(shouldUpdateReadme));

		if (shouldUpdateReadme) {
			updateReadme(version, channel, getEnv('INPUT_COMPANION_TAG'));
		}
	} catch (err) {
		console.error(`\n::error::${(err as Error).message}\n`);
		process.exit(1);
	}
}

if (process.env['NODE_ENV'] !== 'test') {
	void run();
}
