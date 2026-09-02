import { defineConfig } from '@playwright/test';

import { timeouts } from './timeouts';

const baseURL = process.env.WP_BASE_URL ?? 'http://localhost:8889';

export default defineConfig({
	testDir: './tests',
	timeout: timeouts.editorLoad,
	expect: {
		timeout: timeouts.longAction,
	},
	fullyParallel: false,
	retries: 0,
	workers: 1,
	use: {
		baseURL,
		headless: true,
		viewport: { width: 1440, height: 960 },
		trace: 'retain-on-failure',
	},
});
