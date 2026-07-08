import { execSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	checkCurrentTagDoesNotExist,
	checkVersionIsNext,
	deriveBranch,
	extractChannel,
	fetchTagsByChannel,
	getVersion,
	setOutput,
	validateFormat,
} from './main';

vi.mock('node:child_process');
vi.mock('node:fs');

const mockExecSync = vi.mocked(execSync);
const mockAppendFileSync = vi.mocked(appendFileSync);

// ─── getVersion ───────────────────────────────────────────────────────────────

describe('getVersion', () => {
	afterEach(() => {
		delete process.env['INPUT_VERSION'];
	});

	it('returns the trimmed version from INPUT_VERSION', () => {
		process.env['INPUT_VERSION'] = '  3.11.0  ';
		expect(getVersion()).toBe('3.11.0');
	});

	it('throws when INPUT_VERSION is not set', () => {
		delete process.env['INPUT_VERSION'];
		expect(() => getVersion()).toThrow('No version provided');
	});

	it('throws when INPUT_VERSION is an empty string', () => {
		process.env['INPUT_VERSION'] = '   ';
		expect(() => getVersion()).toThrow('No version provided');
	});
});

// ─── setOutput ────────────────────────────────────────────────────────────────

describe('setOutput', () => {
	afterEach(() => {
		delete process.env['GITHUB_OUTPUT'];
		vi.clearAllMocks();
	});

	it('writes to GITHUB_OUTPUT file when env var is set', () => {
		process.env['GITHUB_OUTPUT'] = '/tmp/output';
		setOutput('channel', 'stable');
		expect(mockAppendFileSync).toHaveBeenCalledWith('/tmp/output', 'channel=stable\n');
	});

	it('logs to console when GITHUB_OUTPUT is not set', () => {
		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		setOutput('channel', 'beta');
		expect(consoleSpy).toHaveBeenCalledWith('OUTPUT channel=beta');
		consoleSpy.mockRestore();
	});
});

// ─── validateFormat ───────────────────────────────────────────────────────────

describe('validateFormat', () => {
	it.each([
		['4.1.0'],
		['5.20.15'],
		['4.1.0-beta1'],
		['5.20.0-beta3'],
		['10.0.0-beta10'],
	])('accepts valid version %s', (version) => {
		expect(() => { validateFormat(version); }).not.toThrow();
	});

	it.each([
		['v4.1.0'],
		['4.1'],
		['4.1.0-rc1'],
		['4.1.0-beta.1'],
		['4.1.0-beta 1'],
		['not-a-version'],
		[''],
	])('rejects invalid version %s', (version) => {
		expect(() => { validateFormat(version); }).toThrow('not in the correct format');
	});
});

// ─── checkCurrentTagDoesNotExist ─────────────────────────────────────────────

describe('checkCurrentTagDoesNotExist', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('does not throw when ls-remote returns empty (tag absent)', () => {
		mockExecSync.mockReturnValue('' as never);
		expect(() => checkCurrentTagDoesNotExist('3.11.0')).not.toThrow();
	});

	it('throws when ls-remote returns a line (tag exists)', () => {
		mockExecSync.mockReturnValue(
			'abc123\trefs/tags/3.11.0\n' as never,
		);
		expect(() => checkCurrentTagDoesNotExist('3.11.0')).toThrow('already exists');
	});

	it('throws when execSync itself fails', () => {
		mockExecSync.mockImplementation(() => {
			throw new Error('git: not found');
		});
		expect(() => checkCurrentTagDoesNotExist('3.11.0')).toThrow('Failed to check remote tags');
	});

	it('queries the exact ref for the given version', () => {
		mockExecSync.mockReturnValue('' as never);
		checkCurrentTagDoesNotExist('4.1.0-beta1');
		expect(mockExecSync).toHaveBeenCalledWith(
			expect.stringContaining('refs/tags/4.1.0-beta1'),
			expect.any(Object),
		);
	});
});

// ─── extractChannel ───────────────────────────────────────────────────────────

describe('extractChannel', () => {
	it('returns "stable" for a plain release version', () => {
		expect(extractChannel('4.1.0')).toBe('stable');
	});

	it('returns "beta" for a beta pre-release', () => {
		expect(extractChannel('4.1.0-beta1')).toBe('beta');
	});

	it('returns "beta" for a higher beta number', () => {
		expect(extractChannel('5.20.0-beta3')).toBe('beta');
	});

	it('throws for an unrecognised pre-release identifier', () => {
		expect(() => extractChannel('4.1.0-rc1')).toThrow('Could not determine channel');
	});
});

// ─── deriveBranch ─────────────────────────────────────────────────────────────

describe('deriveBranch', () => {
	it.each([
		['stable', 'release/stable'],
		['beta',   'release/beta'],
	] as const)('derives branch for channel=%s → %s', (channel, expected) => {
		expect(deriveBranch(channel)).toBe(expected);
	});
});

// ─── fetchTagsByChannel ───────────────────────────────────────────────────────

function makeLsRemoteTags(tags: string[]): string {
	return tags.map((t) => `abc123\trefs/tags/${t}`).join('\n');
}

describe('fetchTagsByChannel', () => {
	beforeEach(() => vi.clearAllMocks());

	it('throws when execSync fails', () => {
		mockExecSync.mockImplementation(() => { throw new Error('network error'); });
		expect(() => fetchTagsByChannel('stable')).toThrow('Failed to fetch remote tags');
	});

	it.each([
		['stable', ['4.1.0', '4.2.0', '4.2.0-beta1', '4.2.0-beta2'], ['4.1.0', '4.2.0']],
		['beta',   ['4.1.0', '4.2.0-beta1', '4.2.0-beta2'],           ['4.2.0-beta1', '4.2.0-beta2']],
		['stable', ['4.1.0', 'v4.2.0', '4.2.0-rc1', 'not-a-version'], ['4.1.0']],
		['stable', ['4.1.0-beta1'],                                     []],
	] as const)('filters channel=%s correctly', (channel, tags, expected) => {
		mockExecSync.mockReturnValue(makeLsRemoteTags([...tags]) as never);
		expect(fetchTagsByChannel(channel)).toEqual(expected);
	});
});

// ─── checkVersionIsNext ───────────────────────────────────────────────────────

describe('checkVersionIsNext', () => {
	beforeEach(() => vi.clearAllMocks());

	it.each([
		// stable — patch
		['stable', ['4.2.0', '4.2.1', '4.2.2'], '4.2.3', true,  null],
		['stable', ['4.2.0', '4.2.1', '4.2.2'], '4.2.4', false, 'Expected next patch release to be 4.2.3'],
		['stable', ['4.2.0', '4.2.1', '4.2.2'], '4.2.2', false, 'Expected next patch release to be 4.2.3'],
		// stable — minor
		['stable', ['4.1.0', '4.2.0', '4.2.5'], '4.3.0', true,  null],
		['stable', ['4.1.0', '4.2.0', '4.2.5'], '4.4.0', false, 'Expected next minor release to be 4.3.0'],
		// stable — no existing tags
		['stable', ['4.1.0-beta1'],              '4.1.0', true,  null],
		// beta — next in same series
		['beta',   ['4.2.0-beta1', '4.2.0-beta2'], '4.2.0-beta3', true,  null],
		['beta',   ['4.2.0-beta1', '4.2.0-beta2'], '4.2.0-beta4', false, 'Expected next beta to be 4.2.0-beta3'],
		['beta',   ['4.2.0-beta1', '4.2.0-beta2'], '4.2.0-beta2', false, 'Expected next beta to be 4.2.0-beta3'],
		// beta — new version line
		['beta',   ['4.2.0-beta1', '4.2.0-beta2'], '4.3.0-beta1', true,  null],
		['beta',   ['4.2.0-beta1', '4.2.0-beta2'], '4.3.0-beta2', false, 'must be beta1'],
		// beta — no existing tags
		['beta',   ['4.1.0', '4.2.0'],             '4.2.0-beta1', true,  null],
	] as const)('%s %s → %s (valid=%s)', (channel, existingTags, version, valid, errorMsg) => {
		mockExecSync.mockReturnValue(makeLsRemoteTags([...existingTags]) as never);
		const fn = () => checkVersionIsNext(version, channel);
		if (valid) {
			expect(fn).not.toThrow();
		} else {
			expect(fn).toThrow(errorMsg!);
		}
	});

	it('throws when git ls-remote fails', () => {
		mockExecSync.mockImplementation(() => { throw new Error('network error'); });
		expect(() => checkVersionIsNext('4.2.3', 'stable')).toThrow('Failed to fetch remote tags');
	});
});
