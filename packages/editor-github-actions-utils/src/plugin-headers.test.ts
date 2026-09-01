import { describe, expect, it } from 'vitest';

import {
	isVersionAtLeast,
	majorMinor,
	parseHeaderField,
	parsePhpDefine,
	parseReadmeTag,
} from './plugin-headers';

const CORE_PHP = [
	'<?php',
	'/**',
	' * Plugin Name: Elementor',
	' * Version: 4.2.2',
	' */',
	"define( 'ELEMENTOR_VERSION', '4.2.2' );",
].join('\n');

const PRO_PHP = [
	'<?php',
	'/**',
	' * Plugin Name: Elementor Pro',
	' * Version: 4.2.0',
	' * Elementor tested up to: 4.2.0',
	' */',
	"define( 'ELEMENTOR_PRO_VERSION', '4.2.0' );",
	"define( 'ELEMENTOR_PRO_REQUIRED_CORE_VERSION', '4.0' );",
	"define( 'ELEMENTOR_PRO_RECOMMENDED_CORE_VERSION', '4.2' );",
].join('\n');

describe('parseHeaderField', () => {
	it('reads the plugin Version header', () => {
		expect(parseHeaderField(CORE_PHP, 'Version')).toBe('4.2.2');
		expect(parseHeaderField(PRO_PHP, 'Version')).toBe('4.2.0');
	});
});

describe('parsePhpDefine', () => {
	it('reads Core and Pro version constants', () => {
		expect(parsePhpDefine(CORE_PHP, 'ELEMENTOR_VERSION')).toBe('4.2.2');
		expect(
			parsePhpDefine(PRO_PHP, 'ELEMENTOR_PRO_REQUIRED_CORE_VERSION'),
		).toBe('4.0');
		expect(
			parsePhpDefine(PRO_PHP, 'ELEMENTOR_PRO_RECOMMENDED_CORE_VERSION'),
		).toBe('4.2');
	});

	it('returns null for a missing constant', () => {
		expect(parsePhpDefine(CORE_PHP, 'MISSING')).toBeNull();
	});
});

describe('parseReadmeTag', () => {
	const readme = ['Stable tag: 4.2.2', 'Beta tag: 4.3.0-beta1'].join('\n');

	it('reads stable and beta tags', () => {
		expect(parseReadmeTag(readme, 'Stable tag')).toBe('4.2.2');
		expect(parseReadmeTag(readme, 'Beta tag')).toBe('4.3.0-beta1');
	});
});

describe('majorMinor', () => {
	it('strips the patch segment', () => {
		expect(majorMinor('4.2.2')).toBe('4.2');
		expect(majorMinor('4.3.0-beta1')).toBe('4.3');
	});
});

describe('isVersionAtLeast', () => {
	it('compares major.minor and patch', () => {
		expect(isVersionAtLeast('4.2.3', '4.2')).toBe(true);
		expect(isVersionAtLeast('4.2.0', '4.2')).toBe(true);
		expect(isVersionAtLeast('4.1.9', '4.2')).toBe(false);
		expect(isVersionAtLeast('4.2.0-beta1', '4.0')).toBe(true);
	});
});
