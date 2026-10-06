import type { VersionConstant } from '@elementor/editor-github-actions-utils';

export type Plugin = 'core' | 'pro';

export type PluginConfig = {
	pluginFile: string;
	versionConstant: VersionConstant;
	updateReadme: boolean;
	updateElementorTestedUpTo: boolean;
};

const PLUGIN_CONFIGS: Record<Plugin, PluginConfig> = {
	core: {
		pluginFile: 'elementor.php',
		versionConstant: 'ELEMENTOR_VERSION',
		updateReadme: true,
		updateElementorTestedUpTo: false,
	},
	pro: {
		pluginFile: 'elementor-pro.php',
		versionConstant: 'ELEMENTOR_PRO_VERSION',
		updateReadme: false,
		updateElementorTestedUpTo: true,
	},
};

export function resolvePluginConfig(plugin: string): PluginConfig {
	if (plugin !== 'core' && plugin !== 'pro') {
		throw new Error(`plugin must be "core" or "pro", got "${plugin}"`);
	}
	return PLUGIN_CONFIGS[plugin];
}
