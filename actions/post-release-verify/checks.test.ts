import { describe, expect, it } from 'vitest';

import { runVerify } from './checks';
import type { HttpGet, HttpGetBuffer } from './http';
import { renderSummary } from './summary';

const CORE_CHANGELOG = [
	'= 4.2.2 - 2026-08-06 =',
	'',
	'* Fix: something important',
	'',
	'= 4.2.1 - 2026-07-28 =',
	'',
	'* Fix: older',
].join('\n');

const CORE_README = [
	'Stable tag: 4.2.2',
	'Beta tag: 4.3.0-beta1',
	'',
	'= 4.2.2 - 2026-08-06 =',
	'',
	'* Fix: something important',
].join('\n');

const CORE_RELEASE = JSON.stringify({
	tag_name: '4.2.2',
	assets: [
		{
			name: 'elementor-4.2.2.zip',
			url: 'https://api.github.com/repos/elementor/elementor/releases/assets/1',
			browser_download_url:
				'https://github.com/elementor/elementor/releases/download/4.2.2/elementor-4.2.2.zip',
		},
	],
});

function mockGet(
	routes: Record<string, { status: number; body: string }>,
): HttpGet {
	return (url) => {
		const match = Object.entries(routes).find(([pattern]) =>
			url.includes(pattern),
		);

		if (!match) {
			return Promise.resolve({
				status: 404,
				ok: false,
				body: `unmocked ${url}`,
			});
		}

		const [, response] = match;

		return Promise.resolve({
			status: response.status,
			ok: response.status >= 200 && response.status < 300,
			body: response.body,
		});
	};
}

const unusedBuffer: HttpGetBuffer = () =>
	Promise.resolve({
		status: 500,
		ok: false,
		body: Buffer.from(''),
	});

describe('runVerify', () => {
	it('records a wordpress.org 404 as skipped and still checks GitHub + main', async () => {
		const outcome = await runVerify(
			{
				coreVersion: '4.2.2',
				proVersion: null,
				githubToken: 'token',
				skipWordpressOrg: false,
				workDir: '/tmp/post-release-unused',
			},
			{
				get: mockGet({
					'/repos/elementor/elementor/releases/tags/4.2.2': {
						status: 200,
						body: CORE_RELEASE,
					},
					'/repos/elementor/elementor/contents/changelog.txt': {
						status: 200,
						body: CORE_CHANGELOG,
					},
					'/repos/elementor/elementor/contents/readme.txt': {
						status: 200,
						body: CORE_README,
					},
					'plugins.svn.wordpress.org/elementor/tags/4.2.2/readme.txt':
						{
							status: 404,
							body: 'Not found',
						},
				}),
				getBuffer: unusedBuffer,
			},
		);

		expect(
			outcome.checks.find((check) => check.id === 'core-github-release')
				?.status,
		).toBe('pass');
		expect(
			outcome.checks.find((check) => check.id === 'core-changelog-main')
				?.status,
		).toBe('pass');
		expect(
			outcome.checks.find((check) => check.id === 'wordpress-org')
				?.status,
		).toBe('skipped');
		expect(outcome.failed).toBe(true);
	});

	it('fails when the GitHub release tag is missing', async () => {
		const outcome = await runVerify(
			{
				coreVersion: '4.2.2',
				proVersion: null,
				githubToken: 'token',
				skipWordpressOrg: true,
				workDir: '/tmp/post-release-unused',
			},
			{
				get: mockGet({
					'/repos/elementor/elementor/releases/tags/4.2.2': {
						status: 404,
						body: 'Not Found',
					},
					'/repos/elementor/elementor/contents/changelog.txt': {
						status: 200,
						body: CORE_CHANGELOG,
					},
					'/repos/elementor/elementor/contents/readme.txt': {
						status: 200,
						body: CORE_README,
					},
				}),
				getBuffer: unusedBuffer,
			},
		);

		expect(
			outcome.checks.find((check) => check.id === 'core-github-release')
				?.status,
		).toBe('fail');
		expect(outcome.failed).toBe(true);
	});

	it('fails when main changelog is missing the version', async () => {
		const outcome = await runVerify(
			{
				coreVersion: '4.2.2',
				proVersion: null,
				githubToken: 'token',
				skipWordpressOrg: true,
				workDir: '/tmp/post-release-unused',
			},
			{
				get: mockGet({
					'/repos/elementor/elementor/releases/tags/4.2.2': {
						status: 200,
						body: CORE_RELEASE,
					},
					'/repos/elementor/elementor/contents/changelog.txt': {
						status: 200,
						body: '= 1.0.0 - 2020-01-01 =\n\n* old\n',
					},
					'/repos/elementor/elementor/contents/readme.txt': {
						status: 200,
						body: CORE_README,
					},
				}),
				getBuffer: unusedBuffer,
			},
		);

		expect(
			outcome.checks.find((check) => check.id === 'core-changelog-main')
				?.status,
		).toBe('fail');
	});
});

describe('renderSummary', () => {
	it('renders checklist rows', () => {
		const markdown = renderSummary({
			coreVersion: '4.2.2',
			proVersion: null,
			dryRun: false,
			skipWordpressOrg: false,
			checks: [
				{
					id: 'core-github-release',
					title: 'GitHub release API (Core)',
					status: 'pass',
					detail: 'ok',
				},
			],
			changelogSections: [{ title: 'Core', body: '* Fix: foo' }],
		});

		expect(markdown).toContain('✅ Pass');
		expect(markdown).toContain('* Fix: foo');
	});
});
