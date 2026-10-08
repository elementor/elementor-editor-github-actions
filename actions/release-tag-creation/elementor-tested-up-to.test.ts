import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	fetchCoreReleaseVersion,
	toTestedUpToVersion,
} from './elementor-tested-up-to.ts';

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

function mockFetchResponse(body: string, status = HTTP_OK) {
	const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status }));
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

describe('toTestedUpToVersion', () => {
	it.each([
		['4.3.0', '4.3.0'],
		['4.4.0-beta2', '4.4.0'],
		['4.10.12', '4.10.12'],
	])('%s → %s', (coreVersion, expected) => {
		expect(toTestedUpToVersion(coreVersion)).toBe(expected);
	});

	it('throws on an invalid version', () => {
		expect(() => toTestedUpToVersion('4.3')).toThrow('not valid semver');
	});
});

describe('fetchCoreReleaseVersion', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it.each(['stable', 'beta'] as const)(
		'reads Version from Core release/%s via GitHub Contents API',
		async (channel) => {
			const fetchMock = mockFetchResponse(
				['<?php', '/**', ' * Version: 4.4.0-beta2', ' */'].join('\n'),
			);

			await expect(fetchCoreReleaseVersion(channel)).resolves.toBe(
				'4.4.0-beta2',
			);
			expect(fetchMock).toHaveBeenCalledWith(
				`https://api.github.com/repos/elementor/elementor/contents/elementor.php?ref=release/${channel}`,
				{
					headers: {
						Accept: 'application/vnd.github.raw',
						'User-Agent': 'elementor-editor-github-actions',
					},
				},
			);
		},
	);

	it('includes Authorization header when token is provided', async () => {
		const fetchMock = mockFetchResponse(
			['<?php', '/**', ' * Version: 4.4.0-beta2', ' */'].join('\n'),
		);
		const token = 'ghp_test123';

		await expect(fetchCoreReleaseVersion('stable', token)).resolves.toBe(
			'4.4.0-beta2',
		);
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.github.com/repos/elementor/elementor/contents/elementor.php?ref=release/stable',
			{
				headers: {
					Accept: 'application/vnd.github.raw',
					Authorization: 'Bearer ghp_test123',
					'User-Agent': 'elementor-editor-github-actions',
				},
			},
		);
	});

	it('throws when the request fails', async () => {
		mockFetchResponse('Not Found', HTTP_NOT_FOUND);

		await expect(fetchCoreReleaseVersion('beta')).rejects.toThrow(
			'HTTP 404',
		);
	});

	it('throws when the Version header is missing', async () => {
		mockFetchResponse('<?php // no header');

		await expect(fetchCoreReleaseVersion('stable')).rejects.toThrow(
			'No "Version:" header found',
		);
	});
});
