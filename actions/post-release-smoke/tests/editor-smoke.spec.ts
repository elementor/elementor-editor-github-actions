import { expect, test, type Page } from '@playwright/test';

import { timeouts } from '../timeouts';

const adminUser = process.env.WP_USERNAME ?? 'admin';
const adminPassword = process.env.WP_PASSWORD ?? 'password';
const coreVersion = process.env.CORE_VERSION ?? '';
const proVersion = process.env.PRO_VERSION ?? '';
const existingPageId = process.env.EXISTING_PAGE_ID ?? '';

test.describe('Post-release upgrade smoke', () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	test('plugins screen shows the released version(s)', async ({ page }) => {
		await page.goto('/wp-admin/plugins.php');

		await expect(
			page.locator(
				'tr[data-slug="elementor"] .plugin-version-author-uri',
			),
		).toContainText(`Version ${coreVersion}`);

		if (proVersion) {
			await expect(
				page.locator(
					'tr[data-slug="elementor-pro"] .plugin-version-author-uri',
				),
			).toContainText(`Version ${proVersion}`);
		}
	});

	test('existing heading page still renders after upgrade', async ({
		page,
	}) => {
		await page.goto('/upgrade-heading/');
		await expect(page.getByText('Test title')).toBeVisible({
			timeout: timeouts.longAction,
		});
	});

	test('edits the existing heading page in the editor', async ({ page }) => {
		expect(
			existingPageId,
			'EXISTING_PAGE_ID was not resolved after template import',
		).not.toBe('');

		await page.goto(
			`/wp-admin/post.php?post=${existingPageId}&action=elementor`,
		);
		await dismissEditorChrome(page);
		await page
			.locator('#elementor-preview-iframe')
			.waitFor({ state: 'visible', timeout: timeouts.editorLoad });
	});

	test('creates a new Elementor page after upgrade', async ({ page }) => {
		await page.goto('/wp-admin/post-new.php?post_type=page');
		await page.keyboard.press('Escape');
		await page.locator('#elementor-switch-mode-button').click();
		await page.waitForURL(/action=elementor/, {
			timeout: timeouts.longAction,
		});
		await dismissEditorChrome(page);
		await page
			.locator('#elementor-preview-iframe')
			.waitFor({ state: 'visible', timeout: timeouts.editorLoad });
	});
});

async function login(page: Page) {
	await page.goto('/wp-login.php');
	await page.locator('#user_login').fill(adminUser);
	await page.locator('#user_pass').fill(adminPassword);
	await page.locator('#wp-submit').click();
	await page.waitForURL(/wp-admin/, { timeout: timeouts.longAction });
}

async function dismissEditorChrome(page: Page) {
	const closeButton = page.locator('.dialog-close-button').first();

	if (
		await closeButton
			.isVisible({ timeout: timeouts.shortAction })
			.catch(() => false)
	) {
		await closeButton.click();
	}
}
