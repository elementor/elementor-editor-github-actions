import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		env: { HEALER_PRODUCT: 'pro' },
		include: ['tests/**/*.test.js'],
	},
});
