import { describe, expect, it } from 'vitest';

import { parseLatestTagFromLsRemote, patchPhpVersion, patchReadmeTxt } from './version-files';

// ─── patchPhpVersion ──────────────────────────────────────────────────────────

describe('patchPhpVersion', () => {
	const original = [
		'<?php',
		'/**',
		' * Plugin Name: Elementor',
		' * Version: 3.10.0',
		" * Description: Drag & drop website builder",
		' */',
		"define( 'ELEMENTOR_VERSION', '3.10.0' );",
	].join('\n');

	it('updates the header Version line', () => {
		const result = patchPhpVersion(original, '4.1.0');
		expect(result).toContain(' * Version: 4.1.0');
	});

	it('updates the ELEMENTOR_VERSION constant', () => {
		const result = patchPhpVersion(original, '4.1.0');
		expect(result).toContain("define( 'ELEMENTOR_VERSION', '4.1.0' );");
	});

	it('updates both markers in a single call', () => {
		const result = patchPhpVersion(original, '5.20.0-beta3');
		expect(result).toContain(' * Version: 5.20.0-beta3');
		expect(result).toContain("define( 'ELEMENTOR_VERSION', '5.20.0-beta3' );");
	});

	it('does not alter other lines', () => {
		const result = patchPhpVersion(original, '4.1.0');
		expect(result).toContain(' * Plugin Name: Elementor');
		expect(result).toContain(" * Description: Drag & drop website builder");
	});
});

// ─── patchReadmeTxt ───────────────────────────────────────────────────────────

describe('patchReadmeTxt', () => {
	const original = [
		'=== Elementor ===',
		'Stable tag: 3.10.0',
		'Beta tag: 3.11.0-beta2',
		'',
		'Some other content.',
	].join('\n');

	it('updates both stable and beta tags', () => {
		const result = patchReadmeTxt(original, { stable: '4.0.0', beta: '4.1.0-beta1' });
		expect(result).toContain('Stable tag: 4.0.0');
		expect(result).toContain('Beta tag: 4.1.0-beta1');
	});

	it('does not alter unrelated lines', () => {
		const result = patchReadmeTxt(original, { stable: '4.0.0', beta: '4.1.0-beta1' });
		expect(result).toContain('=== Elementor ===');
		expect(result).toContain('Some other content.');
	});

	it('throws when "Stable tag:" line is missing from content', () => {
		const noStable = 'Beta tag: 3.11.0-beta2\n';
		expect(() => { patchReadmeTxt(noStable, { stable: '4.0.0', beta: '4.1.0-beta1' }); })
			.toThrow('"Stable tag:" line not found');
	});

	it('throws when "Beta tag:" line is missing from content', () => {
		const noBeta = 'Stable tag: 3.10.0\n';
		expect(() => { patchReadmeTxt(noBeta, { stable: '4.0.0', beta: '4.1.0-beta1' }); })
			.toThrow('"Beta tag:" line not found');
	});
});

// ─── parseLatestTagFromLsRemote ───────────────────────────────────────────────

const STABLE_PATTERN = /^\d+\.\d+\.\d+$/;
const BETA_PATTERN = /^\d+\.\d+\.\d+-beta\d+$/;

const LS_REMOTE_OUTPUT = [
	'abc1\trefs/tags/3.9.0',
	'abc2\trefs/tags/3.10.0',
	'abc3\trefs/tags/3.11.0',
	'abc4\trefs/tags/3.11.0-beta1',
	'abc5\trefs/tags/3.11.0-beta2',
	'abc6\trefs/tags/v4.0.0',
	'abc7\trefs/tags/4.1.0-beta1',
	'',
].join('\n');

describe('parseLatestTagFromLsRemote', () => {
	it('returns the latest stable tag', () => {
		expect(parseLatestTagFromLsRemote(LS_REMOTE_OUTPUT, STABLE_PATTERN)).toBe('4.0.0');
	});

	it('returns the latest beta tag', () => {
		expect(parseLatestTagFromLsRemote(LS_REMOTE_OUTPUT, BETA_PATTERN)).toBe('4.1.0-beta1');
	});

	it('strips refs/tags/ prefix', () => {
		const output = 'abc\trefs/tags/1.2.3\n';
		expect(parseLatestTagFromLsRemote(output, STABLE_PATTERN)).toBe('1.2.3');
	});

	it('strips leading v from refs/tags/vX.Y.Z', () => {
		const output = 'abc\trefs/tags/v5.0.0\n';
		expect(parseLatestTagFromLsRemote(output, STABLE_PATTERN)).toBe('5.0.0');
	});

	it('returns null when nothing matches the pattern', () => {
		const output = 'abc\trefs/tags/not-a-semver\n';
		expect(parseLatestTagFromLsRemote(output, STABLE_PATTERN)).toBeNull();
	});

	it('returns null for empty output', () => {
		expect(parseLatestTagFromLsRemote('', STABLE_PATTERN)).toBeNull();
	});

	it('correctly sorts versions numerically not lexicographically', () => {
		const output = [
			'a\trefs/tags/3.9.0',
			'b\trefs/tags/3.10.0',
			'c\trefs/tags/3.2.0',
		].join('\n');
		expect(parseLatestTagFromLsRemote(output, STABLE_PATTERN)).toBe('3.10.0');
	});
});
