import { describe, expect, it } from 'vitest';

import {
	assertValidVersion,
	getChangelogSection,
	isPrereleaseVersion,
} from './changelog';

const CORE_CHANGELOG = [
	'== Changelog ==',
	'',
	'= 4.2.2 - 2026-08-06 =',
	'',
	'* Fix: Editor top bar integrations may not appear in non-English languages',
	'',
	'= 4.2.1 - 2026-07-28 =',
	'',
	'* Fix: Improved code security enforcement in template handling',
].join('\n');

const PRO_CHANGELOG = [
	'# Elementor Pro',
	'',
	'#### 4.2.1 - 2026-07-28',
	'',
	'* Fix: Child product categories display the parent category image',
	'',
	'#### 4.2.0 - 2026-07-20',
	'',
	'* New: Introducing Loop for building dynamic content layouts',
].join('\n');

describe('assertValidVersion', () => {
	it('accepts stable and prerelease versions', () => {
		expect(() => {
			assertValidVersion('4.2.2');
		}).not.toThrow();
		expect(() => {
			assertValidVersion('4.3.0-beta1');
		}).not.toThrow();
	});

	it('rejects invalid versions', () => {
		expect(() => {
			assertValidVersion('v4.2.2');
		}).toThrow('Invalid version format');
	});
});

describe('isPrereleaseVersion', () => {
	it('detects prerelease suffixes', () => {
		expect(isPrereleaseVersion('4.2.2')).toBe(false);
		expect(isPrereleaseVersion('4.3.0-beta1')).toBe(true);
	});
});

describe('getChangelogSection', () => {
	it('returns the Core readme-style section body', () => {
		expect(getChangelogSection(CORE_CHANGELOG, '4.2.2')).toBe(
			'* Fix: Editor top bar integrations may not appear in non-English languages',
		);
	});

	it('returns the Pro markdown-style section body', () => {
		expect(getChangelogSection(PRO_CHANGELOG, '4.2.1')).toBe(
			'* Fix: Child product categories display the parent category image',
		);
	});

	it('returns null when the version header is missing', () => {
		expect(getChangelogSection(CORE_CHANGELOG, '9.9.9')).toBeNull();
	});

	it('returns null when the section is empty', () => {
		const emptySection = [
			'= 4.2.2 - 2026-08-06 =',
			'',
			'= 4.2.1 - 2026-07-28 =',
			'',
			'* Fix: something',
		].join('\n');

		expect(getChangelogSection(emptySection, '4.2.2')).toBeNull();
	});
});
