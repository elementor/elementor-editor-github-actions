import { execSync } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkVersionIsNext } from './current-version-validation.ts';

vi.mock('node:child_process');
vi.mock('node:fs');

const mockExecSync = vi.mocked(execSync);

function makeLsRemoteTags(tags: string[]): string {
	return tags.map((t) => `abc123\trefs/tags/${t}`).join('\n');
}

describe('checkVersionIsNext', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each([
		// stable — patch
		['stable', ['4.2.0', '4.2.1', '4.2.2'], '4.2.3', true, null],
		[
			'stable',
			['4.2.0', '4.2.1', '4.2.2'],
			'4.2.4',
			false,
			'Expected next patch release to be 4.2.3',
		],
		[
			'stable',
			['4.2.0', '4.2.1', '4.2.2'],
			'4.2.2',
			false,
			'Expected next patch release to be 4.2.3',
		],
		// stable — minor
		['stable', ['4.1.0', '4.2.0', '4.2.5'], '4.3.0', true, null],
		[
			'stable',
			['4.1.0', '4.2.0', '4.2.5'],
			'4.4.0',
			false,
			'Expected next minor release to be 4.3.0',
		],
		// stable — no existing tags
		['stable', ['4.1.0-beta1'], '4.1.0', true, null],
		// beta — next in same series
		['beta', ['4.2.0-beta1', '4.2.0-beta2'], '4.2.0-beta3', true, null],
		[
			'beta',
			['4.2.0-beta1', '4.2.0-beta2'],
			'4.2.0-beta4',
			false,
			'Expected next beta to be 4.2.0-beta3',
		],
		[
			'beta',
			['4.2.0-beta1', '4.2.0-beta2'],
			'4.2.0-beta2',
			false,
			'Expected next beta to be 4.2.0-beta3',
		],
		// beta — new version line
		['beta', ['4.2.0-beta1', '4.2.0-beta2'], '4.3.0-beta1', true, null],
		[
			'beta',
			['4.2.0-beta1', '4.2.0-beta2'],
			'4.3.0-beta2',
			false,
			'must be beta1',
		],
		// beta — no existing tags
		['beta', ['4.1.0', '4.2.0'], '4.2.0-beta1', true, null],
	] as const)(
		'%s %s → %s (valid=%s)',
		(channel, existingTags, version, valid, errorMsg) => {
			mockExecSync.mockReturnValue(
				makeLsRemoteTags([...existingTags]) as never,
			);
			const fn = () => {
				checkVersionIsNext(version, channel);
			};
			if (valid) {
				expect(fn).not.toThrow();
			} else {
				expect(fn).toThrow(errorMsg);
			}
		},
	);

	it('throws when git ls-remote fails', () => {
		mockExecSync.mockImplementation(() => {
			throw new Error('network error');
		});
		expect(() => {
			checkVersionIsNext('4.2.3', 'stable');
		}).toThrow('Failed to fetch remote tags');
	});
});
