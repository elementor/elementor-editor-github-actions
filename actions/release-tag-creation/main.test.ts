import { execSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	checkTagDoesNotExist,
	deriveBranch,
	extractChannel,
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

// ─── checkTagDoesNotExist ─────────────────────────────────────────────────────

describe('checkTagDoesNotExist', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('does not throw when ls-remote returns empty (tag absent)', () => {
		mockExecSync.mockReturnValue('' as never);
		expect(() => checkTagDoesNotExist('3.11.0')).not.toThrow();
	});

	it('throws when ls-remote returns a line (tag exists)', () => {
		mockExecSync.mockReturnValue(
			'abc123\trefs/tags/3.11.0\n' as never,
		);
		expect(() => checkTagDoesNotExist('3.11.0')).toThrow('already exists');
	});

	it('throws when execSync itself fails', () => {
		mockExecSync.mockImplementation(() => {
			throw new Error('git: not found');
		});
		expect(() => checkTagDoesNotExist('3.11.0')).toThrow('Failed to check remote tags');
	});

	it('queries the exact ref for the given version', () => {
		mockExecSync.mockReturnValue('' as never);
		checkTagDoesNotExist('4.1.0-beta1');
		expect(mockExecSync).toHaveBeenCalledWith(
			expect.stringContaining('refs/tags/v4.1.0-beta1'),
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
		['4.1.0', '4.01'],
		['5.20.15', '5.20'],
		['10.0.0', '10.00'],
		['4.1.0-beta1', '4.01'],
	])('derives branch %s → %s', (version, expected) => {
		expect(deriveBranch(version)).toBe(expected);
	});
});
