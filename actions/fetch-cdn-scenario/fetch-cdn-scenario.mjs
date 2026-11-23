import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const CDN_ORIGIN = 'https://assets.elementor.com';
const HTTP_NOT_FOUND = 404;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;
const REQUEST_TIMEOUT_MS = 15000;

const CDN_PATHS = [
	'editor-promotions/v1/connect-page.json',
	'editor-promotions/v1/conversion-banner.json',
	'editor-promotions/v1/plugins-page.json',
	'editor-promotions/v1/pointer.json',
	'editor-promotions/v1/pro-setup-panel.json',
	'editor-promotions/v1/side-menu.json',
	'editor-promotions/v1/sticky-panel.json',
	'editor-promotions/v1/theme-builder.json',
	'notifications/v1/notifications.json',
	'home-screen/v1/home-screen.json',
];

const {
	values: {
		from: source = CDN_ORIGIN,
		'allow-failure': allowFailure = false,
		output: outputDir,
	},
} = parseArgs({
	options: {
		from: { type: 'string' },
		'allow-failure': { type: 'boolean' },
		output: { type: 'string' },
	},
});

if (!outputDir) {
	console.error(
		'Error: --output is required. Specify the target directory for CDN files.',
	);
	process.exitCode = 1;
	throw new Error('Missing required --output argument');
}

const LIVE_SCENARIO_DIR = resolve(outputDir);
const STAGING_DIR = `${LIVE_SCENARIO_DIR}.tmp-${String(process.pid)}`;
const isUrl = /^https?:\/\//.test(source);

/** @param {unknown} error */
const getErrorMessage = (error) =>
	error instanceof Error ? error.message : String(error);

/**
 * @param {string} path
 * @returns {Promise<unknown>}
 */
const fetchOnce = async (path) => {
	const response = await fetch(`${source.replace(/\/$/, '')}/${path}`, {
		cache: 'no-store',
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});

	if (HTTP_NOT_FOUND === response.status) {
		return null;
	}

	if (!response.ok) {
		throw new Error(
			`${source} answered ${String(response.status)} for ${path}`,
		);
	}

	const data = /** @type {unknown} */ (await response.json());
	return data;
};

/**
 * @param {string} path
 * @returns {Promise<unknown>}
 */
const readFromUrl = async (path) => {
	for (let attempt = 1; ; attempt++) {
		try {
			return await fetchOnce(path);
		} catch (error) {
			if (attempt >= MAX_ATTEMPTS) {
				throw error;
			}

			console.warn(
				`Attempt ${String(attempt)} of ${String(MAX_ATTEMPTS)} failed for ${path}: ${getErrorMessage(error)}`,
			);
			await sleep(RETRY_DELAY_MS * attempt);
		}
	}
};

/**
 * @param {string} path
 * @returns {Promise<unknown>}
 */
const readFromDir = async (path) => {
	const file = resolve(source, path);

	if (!existsSync(file)) {
		return null;
	}

	const data = /** @type {unknown} */ (
		JSON.parse(await readFile(file, 'utf8'))
	);
	return data;
};

/** @param {string} path */
const copyCdnFile = async (path) => {
	const json = await (isUrl ? readFromUrl(path) : readFromDir(path));

	if (null === json) {
		console.warn(
			`Missing in ${source}, the default scenario answers instead: ${path}`,
		);
		return;
	}

	const target = resolve(STAGING_DIR, path);

	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, JSON.stringify(json, null, '\t') + '\n');
	console.log(`Saved ${path}`);
};

try {
	await rm(STAGING_DIR, { recursive: true, force: true });
	await mkdir(STAGING_DIR, { recursive: true });
	await Promise.all(CDN_PATHS.map(copyCdnFile));
	await rm(LIVE_SCENARIO_DIR, { recursive: true, force: true });
	await rename(STAGING_DIR, LIVE_SCENARIO_DIR);
} catch (error) {
	await rm(STAGING_DIR, { recursive: true, force: true });

	const kept = existsSync(LIVE_SCENARIO_DIR)
		? 'The previous live scenario is kept.'
		: 'There is no live scenario, so the live CDN promotion tests will fail.';
	console.error(
		`Could not fetch the CDN scenario from ${source}: ${getErrorMessage(error)}. ${kept}`,
	);

	if (!allowFailure) {
		process.exitCode = 1;
	}
}
