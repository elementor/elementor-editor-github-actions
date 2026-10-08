import { describe, expect, it } from 'vitest';

import { resolvePluginConfig } from './plugin-config.ts';

describe('resolvePluginConfig', () => {
	it('resolves Core to elementor.php with readme updates', () => {
		expect(resolvePluginConfig('core')).toEqual({
			pluginFile: 'elementor.php',
			versionConstant: 'ELEMENTOR_VERSION',
			updateReadme: true,
			updateElementorTestedUpTo: false,
		});
	});

	it('resolves Pro to elementor-pro.php with Elementor tested up to updates', () => {
		expect(resolvePluginConfig('pro')).toEqual({
			pluginFile: 'elementor-pro.php',
			versionConstant: 'ELEMENTOR_PRO_VERSION',
			updateReadme: false,
			updateElementorTestedUpTo: true,
		});
	});

	it.each(['', 'Core', 'elementor', 'koko'])('throws on "%s"', (plugin) => {
		expect(() => resolvePluginConfig(plugin)).toThrow(
			'plugin must be "core" or "pro"',
		);
	});
});
