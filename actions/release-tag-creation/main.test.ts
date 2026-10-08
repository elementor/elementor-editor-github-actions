import { describe, expect, it } from 'vitest';

import { resolvePluginConfig } from './plugin-config.ts';

describe('plugin validation in main.ts context', () => {
	it('resolvePluginConfig is imported and used for early validation', () => {
		expect(resolvePluginConfig('core')).toEqual({
			pluginFile: 'elementor.php',
			versionConstant: 'ELEMENTOR_VERSION',
			updateReadme: true,
			updateElementorTestedUpTo: false,
		});

		expect(resolvePluginConfig('pro')).toEqual({
			pluginFile: 'elementor-pro.php',
			versionConstant: 'ELEMENTOR_PRO_VERSION',
			updateReadme: false,
			updateElementorTestedUpTo: true,
		});
	});

	it('resolvePluginConfig throws on invalid plugin value "koko"', () => {
		expect(() => resolvePluginConfig('koko')).toThrow(
			'plugin must be "core" or "pro", got "koko"',
		);
	});

	it.each(['', 'Core', 'PRO', 'elementor', 'invalid'])(
		'resolvePluginConfig throws on invalid plugin value "%s"',
		(invalidPlugin) => {
			expect(() => resolvePluginConfig(invalidPlugin)).toThrow(
				'plugin must be "core" or "pro"',
			);
		},
	);
});
